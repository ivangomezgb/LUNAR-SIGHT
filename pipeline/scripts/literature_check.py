"""Compare our illumination with the published LOLA long-term averages (Mazarico et al. 2011).

    python pipeline/scripts/literature_check.py        # needs web/public/data/psr/psr.json (python -m lln.psr)

Mazarico's AVGVISIB products give, per 60/120 m pixel, the fraction of hourly time steps with ANY part of
the Sun's (or Earth's) disc above the local horizon, over a lunar nutation cycle (~18.6 years), computed
from LOLA topography (observer height not stated in the product label). Our headline "sunlight" is a
different quantity (mean visible fraction of the disc), so here we compute ours with the SAME definition
from the published site files, at each available observer height, over our whole ephemeris window
(2026-11-01 .. 2028-12-31, hourly) and over 2027 alone, and write web/public/data/literature.json.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from lln import dem, export, psr  # noqa: E402

SUN_RADIUS_DEG = 0.267
EARTH_RADIUS_DEG = 0.95   # ~1.9 deg apparent diameter from the Moon (mean distance)


def mask_at(mask_cdeg: np.ndarray, step_deg: float, az_deg: np.ndarray) -> np.ndarray:
    """Linear interpolation of a circular horizon mask (deg) at azimuths az_deg."""
    m = np.asarray(mask_cdeg, dtype=float) / 100.0
    pos = (np.asarray(az_deg) % 360.0) / step_deg
    i0 = np.floor(pos).astype(int) % m.size
    f = pos - np.floor(pos)
    return m[i0] * (1 - f) + m[(i0 + 1) % m.size] * f


def any_disc_pct(az: np.ndarray, el: np.ndarray, mask_cdeg, step: float, radius: float, sel=None) -> float:
    vis = (el + radius) > mask_at(mask_cdeg, step, az)
    if sel is not None:
        vis = vis[sel]
    return float(vis.mean() * 100)


def site_values(site: dict) -> dict:
    eph = site["ephem"]
    n = eph["n"]
    t0 = datetime.fromisoformat(eph["t0_utc"].replace("Z", "+00:00"))
    years = np.array([(t0.timestamp() + 3600 * eph["step_h"] * i) for i in range(n)])
    y2027 = (years >= datetime(2027, 1, 1, tzinfo=timezone.utc).timestamp()) & \
            (years < datetime(2028, 1, 1, tzinfo=timezone.utc).timestamp())
    s_az, s_el = np.asarray(eph["sun"]["az_cdeg"]) / 100, np.asarray(eph["sun"]["el_cdeg"]) / 100
    e_az, e_el = np.asarray(eph["earth"]["az_cdeg"]) / 100, np.asarray(eph["earth"]["el_cdeg"]) / 100
    step = site["horizon"]["az_step_deg"]
    out = {}
    for h, mask in site["horizon"]["elev_cdeg"].items():
        out[h] = {"sun_any_pct_full": round(any_disc_pct(s_az, s_el, mask, step, SUN_RADIUS_DEG), 2),
                  "sun_any_pct_2027": round(any_disc_pct(s_az, s_el, mask, step, SUN_RADIUS_DEG, y2027), 2),
                  "earth_any_pct_full": round(any_disc_pct(e_az, e_el, mask, step, EARTH_RADIUS_DEG), 2)}
    return out


def published_neighbourhood(site: dict) -> dict:
    """Max and min of the published Sun visibility within +-1 pixel (+-60 or +-120 m): on peaks and ridges the
    value changes by tens of points within one pixel, and our sites were moved to the best-lit 5 m point."""
    x, y = dem.latlon_to_xy(float(site["lat_deg"]), float(site["lon_deg"]))
    p = psr.product_for(x, y)
    a, r0, c0 = psr.window(p, "sun", x, y, 3 * p.res_m)
    rr, cc = psr.xy_to_rc(p, x, y)
    ir, ic = round(rr - r0), round(cc - c0)
    block = a[ir - 1:ir + 2, ic - 1:ic + 2] * 0.00004 * 100
    return {"radius_m": p.res_m, "min_pct": round(float(block.min()), 2), "max_pct": round(float(block.max()), 2)}


def main() -> None:
    psr = json.loads((export.OUT_DIR / "psr" / "psr.json").read_text(encoding="utf-8"))
    index = json.loads((export.OUT_DIR / "sites.json").read_text(encoding="utf-8"))
    rows = []
    for e in index:
        sid = e["id"]
        pub = psr["sites"].get(sid)
        if not pub:
            continue
        site = json.loads((export.OUT_DIR / "sites" / f"{sid}.json").read_text(encoding="utf-8"))
        ours = site_values(site)
        hood = published_neighbourhood(e)
        rows.append({"id": sid, "name": e["name"], "lat_deg": e["lat_deg"], "lon_deg": e["lon_deg"],
                     "published_product": pub["product"].replace("LPSR", "AVGVISIB"),
                     "published_resolution_m": pub["resolution_m"],
                     "published_sun_any_pct": pub["avg_sun_any_disc_pct"],
                     "published_earth_any_pct": pub["avg_earth_any_disc_pct"],
                     "published_sun_neighbourhood": hood,
                     "ours_in_neighbourhood_1m": hood["min_pct"] - 1 <= ours["1"]["sun_any_pct_full"] <= hood["max_pct"] + 1,
                     "ours": ours})
    def diffs(key, h):
        return np.array([r["ours"][h][key] - r[f"published_{'sun' if 'sun' in key else 'earth'}_any_pct"] for r in rows])
    summary = {}
    for h in ("1", "2", "5", "10"):
        for key in ("sun_any_pct_full", "earth_any_pct_full"):
            d = diffs(key, h)
            summary[f"{key}@{h}m"] = {"mean_diff_pp": round(float(d.mean()), 2), "median_abs_diff_pp": round(float(np.median(np.abs(d))), 2),
                                      "max_abs_diff_pp": round(float(np.abs(d).max()), 2),
                                      "corr": round(float(np.corrcoef([r["ours"][h][key] for r in rows],
                                                                      [r[f"published_{'sun' if 'sun' in key else 'earth'}_any_pct"] for r in rows])[0, 1]), 3)}
    summary["sun_within_published_pixel_neighbourhood_1m"] = f"{sum(r['ours_in_neighbourhood_1m'] for r in rows)}/{len(rows)}"
    data = {"generated_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "reference": {"citation": psr["citation"], "source": psr["source"], "files": psr["files"],
                          "definition": "% of hourly steps with any part of the disc above the local horizon, "
                                        "over a lunar nutation cycle (~18.6 years); observer height not stated.",
                          "read": "2026-11-15"},
            "ours_definition": "Same definition from our horizon masks (heights 1/2/5/10 m), Sun radius "
                               f"{SUN_RADIUS_DEG} deg, Earth radius {EARTH_RADIUS_DEG} deg, over 2026-11-01..2028-12-31 "
                               "(full) and 2027.",
            "rows": rows, "summary": summary}
    export.atomic_write_json(export.OUT_DIR / "literature.json", data, compact=False)
    print(f"{'site':28} {'pub sun':>8} {'ours1m':>7} {'ours2m':>7} {'o2m2027':>8} | {'pub E':>6} {'ours1m':>7}")
    for r in rows:
        o = r["ours"]
        print(f"{r['id']:28} {r['published_sun_any_pct']:8.1f} {o['1']['sun_any_pct_full']:7.1f} {o['2']['sun_any_pct_full']:7.1f} "
              f"{o['2']['sun_any_pct_2027']:8.1f} | {r['published_earth_any_pct']:6.1f} {o['1']['earth_any_pct_full']:7.1f}")
    for k, v in summary.items():
        print(k, v)


if __name__ == "__main__":
    main()
