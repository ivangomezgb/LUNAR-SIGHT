"""Write the static data package in web/public/data/ (see docs/contracts.md).

  sites.json          SiteIndexEntry[]  (with map_px on basemap.png)
  sites/<id>.json     SiteData, compact JSON, integer centidegrees
  validation.json     copied from pipeline/data/intermediate/validation.json if present
  basemap.png/.json   LOLA hillshade (PGDA 90, 80 m/px) resampled to 2048 px, polar stereo

A site is published only if it has a real horizon intermediate and real ephemerides
(intermediate file, or lln.ephem.site_ephem). Otherwise it is skipped with a warning; no
placeholder data is ever written. All writes are atomic (temp file + os.replace) and the
output is deterministic for given intermediates (generated_utc comes from the horizon
intermediate, not the wall clock).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

from . import dem as demmod

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PIPELINE_DIR.parent
SITES_YAML = PIPELINE_DIR / "config" / "sites.yaml"
INTER_DIR = PIPELINE_DIR / "data" / "intermediate"
HORIZON_DIR = INTER_DIR / "horizon"
UNCERTAINTY_DIR = INTER_DIR / "uncertainty"
EPHEM_DIR = INTER_DIR / "ephem"
OUT_DIR = REPO_DIR / "web" / "public" / "data"

N_AZ = 720
EPHEM_N = 19008
EPHEM_T0 = "2026-11-01T00:00:00Z"

BASEMAP_PX = 2048
BASEMAP_HALF_M = 200000.0  # image covers |x|,|y| <= 200 km (to ~83.4 S at the edge midpoints)


def warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- io helpers

def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def atomic_write_json(path: Path, obj, compact: bool = True) -> None:
    if compact:
        txt = json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    else:
        txt = json.dumps(obj, indent=1, ensure_ascii=False, allow_nan=False)
    atomic_write_bytes(path, (txt + "\n").encode("utf-8"))


def load_sites(path: Path = SITES_YAML) -> list[dict]:
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("sites", [])
    ids = [s["id"] for s in data]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate site ids in sites.yaml")
    return list(data)


# ---------------------------------------------------------------- PNG (deterministic)

def write_png_gray(path: Path, img: np.ndarray) -> None:
    """8-bit grayscale PNG with no timestamp/metadata chunks."""
    img = np.ascontiguousarray(img, dtype=np.uint8)
    h, w = img.shape
    # Paeth filter (type 4) on every row: ~30% smaller than unfiltered for a hillshade
    a = img.astype(np.int16)
    left = np.zeros_like(a)
    left[:, 1:] = a[:, :-1]
    up = np.zeros_like(a)
    up[1:] = a[:-1]
    ul = np.zeros_like(a)
    ul[1:, 1:] = a[:-1, :-1]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    filt = ((a - pred) % 256).astype(np.uint8)
    raw = b"".join(b"\x04" + filt[r].tobytes() for r in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    atomic_write_bytes(path, png)


# ---------------------------------------------------------------- basemap

def basemap_meta() -> dict:
    res = 2 * BASEMAP_HALF_M / BASEMAP_PX
    c = 2 * math.degrees(math.atan(BASEMAP_HALF_M / (2 * demmod.R_MOON_M)))
    return {
        "image": "basemap.png",
        "width_px": BASEMAP_PX,
        "height_px": BASEMAP_PX,
        "crs": demmod.CRS_PROJ4,
        # px, py measured from the image's top-left corner (pixel centres at +0.5)
        "affine": [res, 0.0, -BASEMAP_HALF_M, 0.0, -res, BASEMAP_HALF_M],
        "extent_lat_deg": round(-90.0 + c, 3),
    }


def map_px(meta: dict, lat_deg: float, lon_deg: float) -> list[float]:
    a, b, c, d, e, f = meta["affine"]
    x, y = demmod.latlon_to_xy(lat_deg, lon_deg)
    # b = d = 0 for this north-up grid
    return [round((x - c) / a, 1), round((y - f) / e, 1)]


def build_basemap(out_dir: Path, cache_dir: Path = demmod.RAW_DIR / "basemap") -> dict:
    meta = basemap_meta()
    cache = cache_dir / f"hill_{BASEMAP_PX}_{int(BASEMAP_HALF_M)}.npy"
    if cache.exists():
        hill = np.load(cache)
    else:
        from scipy import ndimage

        src = demmod.DemSource("hill80_80s")
        win = src.read_window(0.0, 0.0, BASEMAP_HALF_M + 4 * src.res)
        z = win.z.astype(np.float64)
        z[z == 0.0] = np.nan  # hillshade nodata is 0
        valid = np.isfinite(z)
        # anti-aliasing low-pass before resampling 80 m -> ~195 m
        sigma = 0.5 * (2 * BASEMAP_HALF_M / BASEMAP_PX) / src.res
        num = ndimage.gaussian_filter(np.where(valid, z, 0.0), sigma)
        den = ndimage.gaussian_filter(valid.astype(np.float64), sigma)
        zf = np.where(den > 0.5, num / np.maximum(den, 1e-12), np.nan)
        res = 2 * BASEMAP_HALF_M / BASEMAP_PX
        centers = -BASEMAP_HALF_M + (np.arange(BASEMAP_PX) + 0.5) * res
        xs, ys = np.meshgrid(centers, -centers)  # row 0 at the top (+y)
        cols, rows = win.xy_to_colrow(xs, ys)
        hill = ndimage.map_coordinates(zf, [rows, cols], order=1, cval=np.nan).astype(np.float32)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.save(cache, hill)
    v = hill[np.isfinite(hill)]
    lo, hi = np.percentile(v, [0.5, 99.5])
    img = np.clip((hill - lo) / (hi - lo), 0, 1)
    img = np.where(np.isfinite(img), np.rint(img * 255), 0).astype(np.uint8)
    write_png_gray(out_dir / "basemap.png", img)
    atomic_write_json(out_dir / "basemap.json", meta, compact=False)
    return meta


# ---------------------------------------------------------------- site data

def _check_ephem(e: dict) -> None:
    if e.get("n") != EPHEM_N or e.get("t0_utc") != EPHEM_T0 or e.get("step_h") != 1:
        raise ValueError(f"ephem header mismatch: n={e.get('n')} t0={e.get('t0_utc')}")
    for body in ("sun", "earth"):
        for k in ("az_cdeg", "el_cdeg"):
            a = e[body][k]
            if len(a) != EPHEM_N or not all(isinstance(v, int) for v in a[:100]):
                raise ValueError(f"ephem {body}.{k} has wrong length/type")


def _check_horizon(h: dict) -> None:
    if h["az_step_deg"] != 0.5 or "2" not in h["elev_cdeg"]:
        raise ValueError("horizon must have az_step 0.5 and key '2'")
    for k, a in h["elev_cdeg"].items():
        if len(a) != N_AZ or not all(isinstance(v, int) for v in a):
            raise ValueError(f"horizon key {k} must be {N_AZ} ints")
        if min(a) <= -9000:
            raise ValueError(f"horizon key {k} has azimuths without any terrain sample")


def _same_point(d: dict, site: dict) -> bool:
    return (abs(d.get("lat_deg", 1e9) - site["lat_deg"]) <= 1e-9
            and abs(d.get("lon_deg", 1e9) - site["lon_deg"]) <= 1e-9)


def site_ephem(site: dict, elev_m: float) -> dict | None:
    """The ephemeris intermediate when it was computed for this exact point, else a fresh
    SPICE computation (e.g. after scripts/refine_sites.py moved the site)."""
    p = EPHEM_DIR / f"{site['id']}.json"
    if p.exists():
        e = json.loads(p.read_text(encoding="utf-8"))
        if _same_point(e, site):
            return e
        warn(f"{site['id']}: ephem intermediate is for other (or untagged) coordinates; recomputing")
    try:
        from lln.ephem import site_ephem as _se  # type: ignore
    except Exception as exc:  # noqa: BLE001
        warn(f"{site['id']}: no ephem intermediate and lln.ephem unavailable ({exc})")
        return None
    return _se(float(site["lat_deg"]), float(site["lon_deg"]), float(elev_m))


def published_uncertainty(out_dir: Path, sid: str, mask_2m) -> dict | None:
    """Keep an already published uncertainty when no local intermediate exists.

    Clone ensembles are often computed elsewhere (GitHub Actions, see
    .github/workflows/uncertainty.yml), so a local export must not erase them. The published
    value is kept only if the site's 2 m mask is unchanged, i.e. it still describes this point.
    """
    path = out_dir / "sites" / f"{sid}.json"
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if old.get("uncertainty") is None:
        return None
    if mask_2m is None or old.get("horizon", {}).get("elev_cdeg", {}).get("2") != mask_2m:
        warn(f"{sid}: horizon changed; published uncertainty dropped (rerun the clones)")
        return None
    return old["uncertainty"]


def site_uncertainty(sid: str) -> dict | None:
    path = UNCERTAINTY_DIR / f"{sid}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        keys = ("illum_pct_p5", "illum_pct_p50", "illum_pct_p95")
        values = [data[k] for k in keys]
        if not all(type(v) in (int, float) and math.isfinite(v) for v in values):
            raise ValueError("percentiles must be finite numbers")
        if not 0 <= values[0] <= values[1] <= values[2] <= 100:
            raise ValueError("percentiles must satisfy 0 <= p5 <= p50 <= p95 <= 100")
        result = {k: round(v, 2) for k, v in zip(keys, values)}
        result.update({k: data[k] for k in ("n_clones", "window", "source")})
        return result
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        warn(f"{sid}: invalid uncertainty ({path}): {exc}")
        return None


def export(sites_yaml: Path = SITES_YAML, out_dir: Path = OUT_DIR, basemap: bool = True) -> dict:
    sites = load_sites(sites_yaml)
    meta = build_basemap(out_dir) if basemap else json.loads(
        (out_dir / "basemap.json").read_text(encoding="utf-8"))
    index, written, skipped = [], [], []
    for s in sites:
        sid = s["id"]
        hp = HORIZON_DIR / f"{sid}.json"
        if not hp.exists():
            warn(f"{sid}: no horizon intermediate ({hp}); site skipped")
            skipped.append(sid)
            continue
        hz = json.loads(hp.read_text(encoding="utf-8"))
        if not _same_point(hz, s):
            warn(f"{sid}: horizon intermediate is for other coordinates; site skipped")
            skipped.append(sid)
            continue
        eph = site_ephem(s, hz["elev_m"])
        if eph is None:
            warn(f"{sid}: no ephemerides; site skipped")
            skipped.append(sid)
            continue
        try:
            _check_horizon(hz)
            _check_ephem(eph)
        except (ValueError, KeyError, TypeError) as exc:
            warn(f"{sid}: invalid intermediate ({exc}); site skipped")
            skipped.append(sid)
            continue
        uncertainty = site_uncertainty(sid)
        if uncertainty is None:
            uncertainty = published_uncertainty(out_dir, sid, hz["elev_cdeg"].get("2"))
        site_data = {
            "id": sid,
            "generated_utc": hz["generated_utc"],
            "frame": "MOON_ME",
            "horizon": {
                "az_step_deg": hz["az_step_deg"],
                "heights_m": hz["heights_m"],
                "elev_cdeg": hz["elev_cdeg"],
                "max_dist_m": hz["max_dist_m"],
            },
            "ephem": {"t0_utc": eph["t0_utc"], "step_h": eph["step_h"], "n": eph["n"],
                      "sun": eph["sun"], "earth": eph["earth"]},
            "uncertainty": uncertainty,
        }
        atomic_write_json(out_dir / "sites" / f"{sid}.json", site_data)
        entry = {
            "id": sid,
            "name": s["name"],
            "lat_deg": s["lat_deg"],
            "lon_deg": s["lon_deg"],
            "elev_m": round(hz["elev_m"], 1),
            "group": s["group"],
            "tags": list(s.get("tags", [])),
            "source_url": s["source_url"],
        }
        if s.get("source_note"):
            entry["source_note"] = " ".join(str(s["source_note"]).split())
        if "ref_lat_deg" in s:  # moved by scripts/refine_sites.py
            entry.update({"ref_lat_deg": s["ref_lat_deg"], "ref_lon_deg": s["ref_lon_deg"],
                          "selection": s["selection"]})
        entry.update({
            "dem_res_m": hz["dem_res_m"],
            "dem_source": hz["dem_source"],
            "has_clones": uncertainty is not None,
            "slope_deg_50m": hz["slope_deg_50m"],
            "map_px": map_px(meta, s["lat_deg"], s["lon_deg"]),
        })
        px = entry["map_px"]
        if not (0 <= px[0] < meta["width_px"] and 0 <= px[1] < meta["height_px"]):
            warn(f"{sid}: outside basemap at {px}")
        index.append(entry)
        written.append(sid)
    atomic_write_json(out_dir / "sites.json", index, compact=False)
    # remove stale per-site files from earlier runs (this module is their only writer)
    keep = {f"{i}.json" for i in written}
    for p in (out_dir / "sites").glob("*.json"):
        if p.name not in keep:
            p.unlink()
    vsrc = INTER_DIR / "validation.json"
    if vsrc.exists():
        json.loads(vsrc.read_text(encoding="utf-8"))  # must parse
        tmp = out_dir / ".validation.json.tmp"
        shutil.copyfile(vsrc, tmp)
        os.replace(tmp, out_dir / "validation.json")
    else:
        warn("no intermediate validation.json; validation.json not published")
    print(f"exported {len(written)} sites ({', '.join(written)}); skipped {skipped}")
    return {"written": written, "skipped": skipped}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Write web/public/data/")
    ap.add_argument("--sites", default=str(SITES_YAML))
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--no-basemap", action="store_true")
    a = ap.parse_args(argv)
    export(Path(a.sites), Path(a.out), basemap=not a.no_basemap)


if __name__ == "__main__":
    main()
