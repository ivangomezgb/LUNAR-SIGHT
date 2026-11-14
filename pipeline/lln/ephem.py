"""Sun and Earth ephemerides with SPICE, and local azimuth / elevation per site.

Approach (development-plan P4):
  1. Once per run: apparent (LT+S) positions of SUN and EARTH relative to the Moon's
     centre, in the MOON_ME frame (DE440 ME, via moon_pa_de440_200625.bpc +
     moon_de440_250416.tf), hourly from T0_UTC for N_HOURS.
  2. Per site: subtract the site vector (sphere R = 1737.4 km + elevation) and project on
     the local east/north/up basis. Azimuth from north, clockwise; elevation from the plane
     perpendicular to the sphere normal (same reference surface Horizons uses for the Moon:
     a 1737.4 km sphere, so geodetic == planetocentric).

CLI (run from pipeline/):
    python -m lln.ephem --sites config/sites.yaml
writes data/intermediate/ephem/<id>.json (the `ephem` object of SiteData).
"""
from __future__ import annotations

import argparse
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import spiceypy as sp

PIPELINE_DIR = Path(__file__).resolve().parents[1]
KERNEL_DIR = PIPELINE_DIR / "kernels"
META_KERNEL = KERNEL_DIR / "lln.tm"
EPHEM_DIR = PIPELINE_DIR / "data" / "intermediate" / "ephem"

R_KM = 1737.4  # LOLA reference sphere; DEM elevations are relative to it
FRAME = "MOON_ME"
ABCORR = "LT+S"
T0_UTC = "2026-11-01T00:00:00Z"
STEP_H = 1
N_HOURS = 19008  # to 2029-01-01T00:00:00Z exclusive
BODIES = {"sun": "SUN", "earth": "EARTH"}

_loaded = False


def load_kernels() -> None:
    """furnsh kernels/lln.tm once (chdir into kernels/ so PATH_VALUES='.' resolves)."""
    global _loaded
    if _loaded:
        return
    if not META_KERNEL.exists():
        raise FileNotFoundError(
            f"{META_KERNEL} missing - run: python pipeline/scripts/download_kernels.py"
        )
    cwd = os.getcwd()
    try:
        os.chdir(KERNEL_DIR)
        sp.furnsh(META_KERNEL.name)
    finally:
        os.chdir(cwd)
    if sp.namfrm(FRAME) == 0:
        raise RuntimeError("frame MOON_ME not defined by the loaded kernels")
    _loaded = True


def _utc_to_et(t_utc: str) -> float:
    load_kernels()
    return sp.str2et(t_utc.replace("Z", ""))


def body_positions(body: str, t0_utc: str = T0_UTC, n_hours: int = N_HOURS,
                   step_h: float = STEP_H) -> np.ndarray:
    """Apparent position (km, MOON_ME, LT+S) of `body` seen from the Moon's centre.

    Returns an (n_hours, 3) array; sample i is at t0 + i*step_h hours.
    """
    et0 = _utc_to_et(t0_utc)
    ets = et0 + 3600.0 * step_h * np.arange(n_hours)
    pos, _ = sp.spkpos(body, ets, FRAME, ABCORR, "MOON")
    return np.atleast_2d(np.asarray(pos, dtype=np.float64))


def positions_at(body: str, t_utc_list: list[str]) -> np.ndarray:
    """Same as body_positions but at arbitrary UTC instants."""
    ets = np.array([_utc_to_et(t) for t in t_utc_list])
    pos, _ = sp.spkpos(body, ets, FRAME, ABCORR, "MOON")
    return np.atleast_2d(np.asarray(pos, dtype=np.float64))


def enu_basis(lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.cross(up, east)
    return east, north, up


def topo_azel(pos_km: np.ndarray, lat_deg: float, lon_deg: float,
              h_m: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Azimuth [0,360) and elevation (deg) of positions `pos_km` (n,3, MOON_ME, from Moon
    centre) seen from a site at planetocentric lat/lon (east+) and height h_m above the
    1737.4 km sphere."""
    pos_km = np.atleast_2d(pos_km)
    east, north, up = enu_basis(lat_deg, lon_deg)
    v = pos_km - (R_KM + h_m / 1000.0) * up
    v = v / np.linalg.norm(v, axis=1)[:, None]
    el = np.degrees(np.arcsin(np.clip(v @ up, -1.0, 1.0)))
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360.0
    return az, el


@lru_cache(maxsize=4)
def _cached_positions(body: str, t0_utc: str, n_hours: int) -> np.ndarray:
    return body_positions(body, t0_utc, n_hours)


def to_cdeg(az: np.ndarray, el: np.ndarray) -> tuple[list[int], list[int]]:
    az_c = np.rint(np.asarray(az) * 100.0).astype(np.int64) % 36000
    el_c = np.rint(np.asarray(el) * 100.0).astype(np.int64)
    return az_c.tolist(), el_c.tolist()


def site_ephem(lat_deg: float, lon_deg: float, elev_m: float = 0.0,
               t0_utc: str = T0_UTC, n_hours: int = N_HOURS) -> dict:
    """The `ephem` object of SiteData for one site (integer centidegree arrays)."""
    out = {"t0_utc": t0_utc, "step_h": STEP_H, "n": n_hours}
    for key, body in BODIES.items():
        az, el = topo_azel(_cached_positions(body, t0_utc, n_hours), lat_deg, lon_deg, elev_m)
        az_c, el_c = to_cdeg(az, el)
        out[key] = {"az_cdeg": az_c, "el_cdeg": el_c}
    return out


def load_sites(path: Path) -> list[dict]:
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("sites", data)
    return list(data)


def site_elev_m(site: dict) -> float:
    """Elevation relative to the 1737.4 km sphere: sites.yaml value, else the horizon
    intermediate written by the DEM step, else 0 (effect on Sun/Earth az/el < 0.001 deg)."""
    if site.get("elev_m") is not None:
        return float(site["elev_m"])
    hz = PIPELINE_DIR / "data" / "intermediate" / "horizon" / f"{site['id']}.json"
    if hz.exists():
        try:
            v = json.loads(hz.read_text(encoding="utf-8")).get("elev_m")
            if v is not None:
                return float(v)
        except (ValueError, OSError):
            pass
    return 0.0


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Write data/intermediate/ephem/<id>.json")
    ap.add_argument("--sites", default="config/sites.yaml")
    ap.add_argument("--out", default=str(EPHEM_DIR))
    a = ap.parse_args(argv)
    sites_path = Path(a.sites)
    if not sites_path.is_absolute():
        sites_path = (Path.cwd() / sites_path) if sites_path.exists() else PIPELINE_DIR / sites_path
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for s in load_sites(sites_path):
        e = site_ephem(float(s["lat_deg"]), float(s["lon_deg"]), site_elev_m(s))
        # tag the point so export.py can tell a stale file after a site moves
        e = {"lat_deg": s["lat_deg"], "lon_deg": s["lon_deg"], **e}
        (out_dir / f"{s['id']}.json").write_text(json.dumps(e, separators=(",", ":")),
                                                 encoding="utf-8")
        el = np.array(e["sun"]["el_cdeg"]) / 100
        print(f"{s['id']:<24} sun el {el.min():6.2f}..{el.max():5.2f} deg")


if __name__ == "__main__":
    main()
