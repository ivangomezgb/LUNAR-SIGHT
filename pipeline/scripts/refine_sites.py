"""Move each site to the best-lit gentle point near its published reference coordinate.

Region reference points (e.g. the centre of an Artemis III region grid) often fall on steep
slopes or in depressions, where illumination is far below what the region offers. For each site
we scan a 1.8 x 1.8 km grid (300 m step, then 75 m around the best cell) and keep the point with
the highest mean sunlight over 2027 at 2 m height among points with slope <= MAX_SLOPE_DEG.
The reference coordinate is kept in sites.yaml as ref_lat_deg / ref_lon_deg.

    python scripts/refine_sites.py            # all sites except FIXED_IDS
    python scripts/refine_sites.py --only haworth,malapert-massif
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

SITES_YAML = PIPELINE_DIR / "config" / "sites.yaml"
OUT_JSON = PIPELINE_DIR / "data" / "intermediate" / "refine.json"
FIXED_IDS = {"mons-mouton"}  # real landing point (IM-2 Athena): never moved
MAX_SLOPE_DEG = 8.0
WINDOW = ("2027-01-01T00:00:00Z", 8760)
COARSE = (300.0, 3)  # step m, half-width in steps -> +-900 m
FINE = (75.0, 2)  # +-150 m around the best coarse cell


def _evaluate(lat, lon, sources):
    from lln import ephem
    from lln.horizon import site_horizon
    from lln.metrics import compute_metrics

    hz = site_horizon(lat, lon, heights=(2,), sources=sources, log=lambda *a: None)
    site = {"id": "scan", "horizon": {"az_step_deg": hz["az_step_deg"], "heights_m": [2],
                                      "elev_cdeg": hz["elev_cdeg"]},
            "ephem": ephem.site_ephem(lat, lon, hz["elev_m"])}
    m = compute_metrics(site, *WINDOW)
    return m["lightPct"], m["earthPct"], hz["slope_deg_50m"]


def refine(site: dict) -> dict:
    from lln import dem

    sources: dict = {}
    x0, y0 = dem.latlon_to_xy(site["lat_deg"], site["lon_deg"])
    ref = _evaluate(site["lat_deg"], site["lon_deg"], sources)
    best = None  # (light, earth, -dist, x, y, slope)

    def scan(cx, cy, step, half):
        nonlocal best
        for i in range(-half, half + 1):
            for j in range(-half, half + 1):
                x, y = cx + i * step, cy + j * step
                lat, lon = dem.xy_to_latlon(x, y)
                light, earth, slope = _evaluate(lat, lon, sources)
                if slope > MAX_SLOPE_DEG:
                    continue
                cand = (round(light, 2), round(earth, 2), -((x - x0) ** 2 + (y - y0) ** 2), x, y, slope)
                if best is None or cand[:3] > best[:3]:
                    best = cand

    scan(x0, y0, *COARSE)
    if best is None:
        return {"id": site["id"], "moved": False, "reason": f"no point with slope <= {MAX_SLOPE_DEG} deg"}
    scan(best[3], best[4], *FINE)
    lat, lon = dem.xy_to_latlon(best[3], best[4])
    return {"id": site["id"], "moved": True, "lat_deg": round(float(lat), 5), "lon_deg": round(float(lon), 4),
            "dist_m": round((-best[2]) ** 0.5), "light_pct": best[0], "earth_pct": best[1],
            "slope_deg": best[5], "ref_light_pct": round(ref[0], 2), "ref_slope_deg": ref[2]}


def apply_to_yaml(results: list[dict]) -> None:
    """Rewrite lat/lon in place (keeps comments), recording the reference coordinate."""
    text = SITES_YAML.read_text(encoding="utf-8")
    for r in results:
        if not r.get("moved"):
            continue
        block = re.compile(rf"(  - id: {re.escape(r['id'])}\n(?:    .*\n)*?)"
                           r"    lat_deg: (?P<lat>[-\d.]+)\n    lon_deg: (?P<lon>[-\d.]+)\n")
        m = block.search(text)
        if not m:
            raise RuntimeError(f"site {r['id']} not found in sites.yaml")
        if "ref_lat_deg" in text[m.start():m.end() + 200]:
            ref_lat, ref_lon = re.search(r"ref_lat_deg: ([-\d.]+)\n    ref_lon_deg: ([-\d.]+)",
                                         text[m.start():]).groups()
            text = re.sub(rf"(  - id: {re.escape(r['id'])}\n(?:    .*\n)*?)    ref_lat_deg: .*\n    ref_lon_deg: .*\n    selection: .*\n",
                          r"\1", text, count=1)
            m = block.search(text)
        else:
            ref_lat, ref_lon = m["lat"], m["lon"]
        new = (f"{m.group(1)}    lat_deg: {r['lat_deg']}\n    lon_deg: {r['lon_deg']}\n"
               f"    ref_lat_deg: {ref_lat}\n    ref_lon_deg: {ref_lon}\n"
               f"    selection: best-lit point with slope <= {MAX_SLOPE_DEG:g} deg within 1 km of the "
               f"reference ({r['dist_m']} m away; {r['ref_light_pct']}% -> {r['light_pct']}% sunlight in 2027 at 2 m)\n")
        text = text[:m.start()] + new + text[m.end():]
    SITES_YAML.write_text(text, encoding="utf-8")


def main(argv=None) -> None:
    import yaml

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)
    sites = yaml.safe_load(SITES_YAML.read_text(encoding="utf-8"))["sites"]
    only = {s for s in args.only.split(",") if s}
    todo = [s for s in sites if s["id"] not in FIXED_IDS and (not only or s["id"] in only)]
    # scan around the reference point, not around a previous result
    for s in todo:
        if "ref_lat_deg" in s:
            s["lat_deg"], s["lon_deg"] = s["ref_lat_deg"], s["ref_lon_deg"]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(refine, todo))
    for r in results:
        print(json.dumps(r))
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(results, indent=1), encoding="utf-8")
    apply_to_yaml(results)


if __name__ == "__main__":
    main()
