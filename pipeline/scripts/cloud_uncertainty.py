"""Horizon + LOLA-clone uncertainty for ONE site, from a clean machine (GitHub Actions).

    python pipeline/scripts/cloud_uncertainty.py --site connecting-ridge-extension

A fresh runner has no DEM tile cache, so the 2 m horizon is recomputed first (this also fills
the tile cache that lln.uncertainty needs for the far field). The recomputed mask must match the
one already published in web/public/data/sites/<id>.json; otherwise the clone ensemble would
describe a different horizon than the site shows, and the run stops.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

import run_all  # noqa: E402
from lln import export  # noqa: E402

MAX_MASK_DIFF_CDEG = 1  # tolerate a 0.01 deg rounding flip between platforms


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", required=True)
    ap.add_argument("--clones", type=int, default=30, choices=(30, 100))
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)

    sites = [s for s in export.load_sites(export.SITES_YAML) if s["id"] == a.site]
    if not sites:
        print(f"unknown site id: {a.site}", file=sys.stderr)
        return 2
    done = run_all.run_horizons(sites, force=False, heights=(1, 2, 5, 10))
    if a.site not in done:
        print(f"{a.site}: horizon failed", file=sys.stderr)
        return 1

    new = json.loads((export.HORIZON_DIR / f"{a.site}.json").read_text(encoding="utf-8"))["elev_cdeg"]["2"]
    published = json.loads((export.OUT_DIR / "sites" / f"{a.site}.json").read_text(encoding="utf-8"))
    pub = published["horizon"]["elev_cdeg"]["2"]
    if len(new) != len(pub):
        print(f"{a.site}: mask length {len(new)} != published {len(pub)}", file=sys.stderr)
        return 1
    diffs = [abs(x - y) for x, y in zip(new, pub)]
    print(f"{a.site}: recomputed 2 m mask vs published: max diff {max(diffs)} cdeg, "
          f"{sum(d > 0 for d in diffs)}/{len(diffs)} columns differ", flush=True)
    if max(diffs) > MAX_MASK_DIFF_CDEG:
        print(f"{a.site}: recomputed horizon does not match the published one; stopping", file=sys.stderr)
        return 1

    cmd = [sys.executable, "-m", "lln.uncertainty", "--site", a.site,
           "--clones", str(a.clones), "--workers", str(a.workers)]
    return subprocess.run(cmd, cwd=PIPELINE_DIR).returncode


if __name__ == "__main__":
    sys.exit(main())
