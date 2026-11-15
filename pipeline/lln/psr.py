"""Permanently shadowed regions (PSRs) and long-term illumination around each site, from the
official LOLA polar illumination products (Mazarico et al. 2011, Icarus 211, 1066-1081;
products listed on https://pgda.gsfc.nasa.gov/products/69, files on
http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/).

    python -m lln.psr                 # from pipeline/: all sites -> web/public/data/psr/psr.json
    python -m lln.psr --only haworth

Products (PDS3 IMG, int16 LSB, polar stereographic on a 1737.4 km sphere, true scale at the pole):
  LPSR_85S_060M     permanent shadow flag (DN +20000 -> 1, -20000 -> 0), 60 m/px, to ~85 S at the edges
  AVGVISIB_85S_060M average fraction of hourly time steps with ANY part of the solar disc visible
                    (DN * 0.00004), over a lunar nutation cycle (~18.6 years, 1 h step)
  ..._EARTH         same for the Earth disc
  and the 75S_120M versions (120 m/px) for sites outside the 85S map (Peak near Cabeus B).
Only the rows around each site are fetched with HTTP range requests and cached under
pipeline/data/raw/pgda69/.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
from scipy import ndimage

from . import dem, export

BASE = "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/"
RAW = export.PIPELINE_DIR / "data" / "raw" / "pgda69"
OUT = export.OUT_DIR / "psr"
WINDOW_M = 30_000      # search radius for the nearest PSR
OVERLAY_M = 10_000     # half-size of the per-site overlay raster
RINGS_KM = (5, 10, 20)
CITATION = ("Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011). Illumination "
            "conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066-1081, "
            "doi:10.1016/j.icarus.2010.10.030. LOLA products V1.05 (2016-09), LRO-L-LOLA-4-GDR-V1.0.")


@dataclass(frozen=True)
class Product:
    stem: str          # e.g. "85S_060M_201608"
    n: int             # lines = samples
    res_m: float
    offset_px: float   # LINE/SAMPLE_PROJECTION_OFFSET from the PDS label

    @property
    def half_m(self) -> float:
        return self.offset_px * self.res_m

    def url(self, kind: str) -> str:
        suffix = "_EARTH" if kind == "earth" else ""
        prefix = "LPSR" if kind == "psr" else "AVGVISIB"
        return f"{BASE}{prefix}_{self.stem}{suffix}.IMG"


P85 = Product("85S_060M_201608", 5058, 60.0, 2528.5)
P75 = Product("75S_120M_201608", 7624, 120.0, 3811.5)


def xy_to_rc(p: Product, x: float, y: float) -> tuple[float, float]:
    """Map metres -> fractional (row, col), 0-based, pixel centres at integers.
    PDS label convention: x = (sample - S0 - 1) * scale, y = (1 - line + L0) * scale, 1-based."""
    return p.offset_px - y / p.res_m, x / p.res_m + p.offset_px


def rc_to_xy(p: Product, r, c):
    return (np.asarray(c) - p.offset_px) * p.res_m, (p.offset_px - np.asarray(r)) * p.res_m


def fetch_rows(p: Product, kind: str, r0: int, r1: int) -> np.ndarray:
    """Rows r0..r1 inclusive (int16 DN), cached per product/kind/row range."""
    r0, r1 = max(0, r0), min(p.n - 1, r1)
    RAW.mkdir(parents=True, exist_ok=True)
    cache = RAW / f"{kind}_{p.stem}_{r0}_{r1}.npy"
    if cache.exists():
        return np.load(cache)
    rb = p.n * 2
    resp = requests.get(p.url(kind), headers={"Range": f"bytes={r0 * rb}-{(r1 + 1) * rb - 1}"}, timeout=(15, 120))
    resp.raise_for_status()
    if resp.status_code != 206 or len(resp.content) != (r1 - r0 + 1) * rb:
        raise ValueError(f"range request failed for {p.url(kind)}")
    rows = np.frombuffer(resp.content, dtype="<i2").reshape(r1 - r0 + 1, p.n).copy()
    np.save(cache, rows)
    return rows


def window(p: Product, kind: str, x: float, y: float, half_m: float):
    """Square window around (x, y): (array, row0, col0)."""
    r, c = xy_to_rc(p, x, y)
    h = int(math.ceil(half_m / p.res_m))
    r0, r1 = int(round(r)) - h, int(round(r)) + h
    c0, c1 = max(0, int(round(c)) - h), min(p.n - 1, int(round(c)) + h)
    rows = fetch_rows(p, kind, r0, r1)
    return rows[:, c0:c1 + 1], max(0, r0), c0


def product_for(x: float, y: float) -> Product:
    margin = WINDOW_M + 2_000
    return P85 if max(abs(x), abs(y)) + margin <= P85.half_m else P75


def bilinear(a: np.ndarray, r: float, c: float) -> float:
    r0, c0 = int(math.floor(r)), int(math.floor(c))
    fr, fc = r - r0, c - c0
    q = a[r0:r0 + 2, c0:c0 + 2].astype(float)
    return float(q[0, 0] * (1 - fr) * (1 - fc) + q[0, 1] * (1 - fr) * fc + q[1, 0] * fr * (1 - fc) + q[1, 1] * fr * fc)


def bearing_deg(lat: float, lon: float, dx: float, dy: float) -> float:
    """Azimuth (deg from local north, clockwise) of a map displacement (dx, dy) at the site."""
    nx, ny = dem.north_xy(lat, lon)
    ex, ey = ny, -nx  # east = north rotated 90 deg clockwise in the map plane
    return math.degrees(math.atan2(dx * ex + dy * ey, dx * nx + dy * ny)) % 360


def pack_bits(mask: np.ndarray) -> str:
    return base64.b64encode(np.packbits(mask.astype(np.uint8), axis=None).tobytes()).decode("ascii")


def site_psr(site: dict) -> dict:
    lat, lon = float(site["lat_deg"]), float(site["lon_deg"])
    x, y = dem.latlon_to_xy(lat, lon)
    p = product_for(x, y)
    psr_dn, r0, c0 = window(p, "psr", x, y, WINDOW_M)
    psr = psr_dn > 0
    rr, cc = xy_to_rc(p, x, y)
    lr, lc = rr - r0, cc - c0
    rows, cols = np.indices(psr.shape)
    dist = np.hypot((rows - lr) * p.res_m, (cols - lc) * p.res_m)
    px_km2 = (p.res_m / 1000) ** 2
    out = {"product": f"LPSR_{p.stem}", "resolution_m": p.res_m, "search_radius_km": WINDOW_M / 1000,
           "psr_area_km2_within": {f"{k}": round(float(psr[dist <= k * 1000].sum() * px_km2), 3) for k in RINGS_KM}}
    if psr.any():
        k = int(np.argmin(np.where(psr, dist, np.inf)))
        kr, kc = divmod(k, psr.shape[1])
        labels, _ = ndimage.label(psr, structure=np.ones((3, 3)))
        comp = labels == labels[kr, kc]
        touches_edge = bool(comp[0].any() or comp[-1].any() or comp[:, 0].any() or comp[:, -1].any())
        dx, dy = (kc - lc) * p.res_m, (lr - kr) * p.res_m
        out["nearest"] = {"distance_km": round(float(dist[kr, kc]) / 1000, 3),
                          "bearing_deg": round(bearing_deg(lat, lon, dx, dy), 1),
                          "area_km2": round(float(comp.sum() * px_km2), 3),
                          "area_is_lower_bound": touches_edge}
    else:
        out["nearest"] = None
    # Long-term average visibility at the site (bilinear on the product grid).
    sun_dn, s0, t0 = window(p, "sun", x, y, 3 * p.res_m)
    earth_dn, e0, f0 = window(p, "earth", x, y, 3 * p.res_m)
    out["avg_sun_any_disc_pct"] = round(bilinear(sun_dn, rr - s0, cc - t0) * 0.00004 * 100, 2)
    out["avg_earth_any_disc_pct"] = round(bilinear(earth_dn, rr - e0, cc - f0) * 0.00004 * 100, 2)
    # Overlay: PSR flags within +-OVERLAY_M, rows north->south, cols west->east in map axes.
    h = int(round(OVERLAY_M / p.res_m))
    ir, ic = int(round(lr)), int(round(lc))
    sub = psr[max(0, ir - h):ir + h + 1, max(0, ic - h):ic + h + 1]
    out["overlay"] = {"n_rows": int(sub.shape[0]), "n_cols": int(sub.shape[1]), "res_m": p.res_m,
                      "site_row": ir - max(0, ir - h), "site_col": ic - max(0, ic - h),
                      "north_deg_from_up": round(math.degrees(math.atan2(*dem.north_xy(lat, lon))), 2),
                      "bits": pack_bits(sub)}
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    sites = export.load_sites(export.SITES_YAML)
    if a.only:
        sites = [s for s in sites if s["id"] in set(a.only.split(","))]
    path = OUT / "psr.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data.update({"source": "https://pgda.gsfc.nasa.gov/products/69", "files": BASE, "citation": CITATION,
                 "definition": "PSR: never illuminated by any part of the solar disc over a lunar nutation cycle "
                               "(~18.6 years, 1 h step), from LOLA topography.",
                 "avg_definition": "Average fraction of hourly time steps with any part of the disc visible, same span."})
    data.setdefault("sites", {})
    for s in sites:
        r = site_psr(s)
        data["sites"][s["id"]] = r
        n = r["nearest"]
        print(f"{s['id']:28} {r['product']:22} nearest PSR "
              f"{(str(n['distance_km']) + ' km @ ' + str(n['bearing_deg']) + ' deg, ' + str(n['area_km2']) + ' km2') if n else 'none within 30 km'}"
              f" | Mazarico sun {r['avg_sun_any_disc_pct']}% earth {r['avg_earth_any_disc_pct']}%", flush=True)
    export.atomic_write_json(path, data)


if __name__ == "__main__":
    main()
