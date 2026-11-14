"""Run the whole pipeline: horizons -> ephemerides -> validation -> export.

    python pipeline/run_all.py              # cached horizons are reused
    python pipeline/run_all.py --force      # recompute horizons
    python pipeline/run_all.py --only connecting-ridge,mons-mouton
    python pipeline/run_all.py --terrain --pano  # optional products after export
    python pipeline/run_all.py --uncertainty   # slow; downloads data, before export

Horizons run first because lln.ephem reads each site's elevation from
data/intermediate/horizon/<id>.json. DEM blocks are cached under data/raw/ (gitignored).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE_DIR))

from lln import export, horizon  # noqa: E402

IM2_SITE_ID = "mons-mouton"  # Athena (IM-2) landing point; see config/sites.yaml


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_horizons(sites, force: bool, heights) -> list[str]:
    export.HORIZON_DIR.mkdir(parents=True, exist_ok=True)
    sources: dict = {}
    done = []
    for s in sites:
        sid = s["id"]
        p = export.HORIZON_DIR / f"{sid}.json"
        if p.exists() and not force:
            old = json.loads(p.read_text(encoding="utf-8"))
            if (old.get("lat_deg") == s["lat_deg"] and old.get("lon_deg") == s["lon_deg"]
                    and old.get("heights_m") == list(heights)):
                print(f"[horizon] {sid}: cached")
                done.append(sid)
                continue
        t = time.time()
        print(f"[horizon] {sid} ({s['lat_deg']}, {s['lon_deg']})", flush=True)
        try:
            r = horizon.site_horizon(float(s["lat_deg"]), float(s["lon_deg"]), heights=heights,
                                     sources=sources)
        except Exception as exc:  # noqa: BLE001 - keep going, export will skip the site
            export.warn(f"{sid}: horizon failed: {exc}")
            continue
        out = {"id": sid, "lat_deg": s["lat_deg"], "lon_deg": s["lon_deg"],
               "generated_utc": _utc_now(), **r}
        export.atomic_write_json(p, out)
        e2 = r["elev_cdeg"]["2"]
        print(f"[horizon] {sid}: elev {r['elev_m']:.0f} m, slope {r['slope_deg_50m']} deg, "
              f"2 m mask {min(e2) / 100:.2f}..{max(e2) / 100:.2f} deg, "
              f"max_dist {r['max_dist_m'] / 1000:.0f} km, {time.time() - t:.0f} s", flush=True)
        done.append(sid)
    return done


def run_ephem(sites_yaml: Path) -> None:
    if importlib.util.find_spec("lln.ephem") is None:
        export.warn("lln.ephem not present; export will use intermediates or skip sites")
        return
    from lln import ephem

    ephem.main(["--sites", str(sites_yaml)])


def run_validate(im2_id: str) -> None:
    if not (PIPELINE_DIR / "lln" / "validate.py").exists():
        export.warn("lln.validate not present; skipping validation")
        return
    cmd = [sys.executable, "-m", "lln.validate", "--offline", "--im2-horizon", im2_id]
    r = subprocess.run(cmd, cwd=PIPELINE_DIR)
    if r.returncode != 0:
        export.warn(f"validation exited with {r.returncode}; previous validation.json kept")


def run_optional(module: str, only: str = "") -> None:
    name = f"lln.{module}"
    if importlib.util.find_spec(name) is None:
        export.warn(f"{name} not present; skipping {module}")
        return
    cmd = [sys.executable, "-m", name]
    if only:
        cmd += ["--only", only]
    try:
        result = subprocess.run(cmd, cwd=PIPELINE_DIR)
        if result.returncode != 0:
            export.warn(f"{name} exited with {result.returncode}; continuing")
    except Exception as exc:  # optional products must not prevent export
        export.warn(f"{name} failed: {exc}; continuing")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sites", default=str(export.SITES_YAML))
    ap.add_argument("--force", action="store_true", help="recompute cached horizons")
    ap.add_argument("--only", default="", help="comma-separated site ids (horizon step)")
    ap.add_argument("--heights", default="1,2,5,10")
    ap.add_argument("--skip-ephem", action="store_true")
    ap.add_argument("--skip-validate", action="store_true")
    ap.add_argument("--terrain", action="store_true", help="generate terrain after export")
    ap.add_argument("--pano", action="store_true", help="generate panoramas after export")
    ap.add_argument("--uncertainty", action="store_true",
                    help="compute uncertainty before export (slow; downloads data)")
    a = ap.parse_args(argv)
    t0 = time.time()
    sites_yaml = Path(a.sites)
    sites = export.load_sites(sites_yaml)
    if a.only:
        want = set(a.only.split(","))
        sites = [s for s in sites if s["id"] in want]
    heights = tuple(int(h) for h in a.heights.split(","))
    run_horizons(sites, a.force, heights)
    print(f"--- horizons done {time.time() - t0:.0f} s", flush=True)
    if not a.skip_ephem:
        run_ephem(sites_yaml)
        print(f"--- ephem done {time.time() - t0:.0f} s", flush=True)
    if not a.skip_validate:
        run_validate(IM2_SITE_ID)
    if a.uncertainty:
        run_optional("uncertainty", a.only)
    export.export(sites_yaml)
    if a.terrain:
        run_optional("terrain", a.only)
    if a.pano:
        run_optional("pano", a.only)
    print(f"--- total {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
