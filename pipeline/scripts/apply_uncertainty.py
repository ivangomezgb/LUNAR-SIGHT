"""Copy validated uncertainty results into the published site JSON, touching nothing else.

    python pipeline/scripts/apply_uncertainty.py

Reads pipeline/data/intermediate/uncertainty/<id>.json (validated by export.site_uncertainty)
and sets only the `uncertainty` field of web/public/data/sites/<id>.json. Sites without a new
result keep their current value. Used by the cloud workflow instead of a full export, which
would need every site's ephemeris.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_DIR))

from lln import export  # noqa: E402


def apply(out_dir: Path = export.OUT_DIR) -> list[str]:
    changed, has = [], {}
    for path in sorted((out_dir / "sites").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        result = export.site_uncertainty(data["id"])
        if result is not None and data.get("uncertainty") != result:
            data["uncertainty"] = result
            export.atomic_write_json(path, data)
            changed.append(data["id"])
            print(f"{data['id']}: p5/p50/p95 = {result['illum_pct_p5']}/{result['illum_pct_p50']}/"
                  f"{result['illum_pct_p95']} % ({result['n_clones']} clones)")
        has[data["id"]] = data.get("uncertainty") is not None
    sync_index(out_dir, has)
    return changed


def sync_index(out_dir: Path, has: dict[str, bool]) -> None:
    """Keep sites.json `has_clones` equal to "uncertainty is not None" (checked by check_data.py)."""
    path = out_dir / "sites.json"
    index = json.loads(path.read_text(encoding="utf-8"))
    stale = [e["id"] for e in index if e["id"] in has and e.get("has_clones") != has[e["id"]]]
    if stale:
        for e in index:
            if e["id"] in has:
                e["has_clones"] = has[e["id"]]
        export.atomic_write_json(path, index, compact=False)  # same layout as export.py
        print(f"sites.json: has_clones updated for {', '.join(stale)}")


if __name__ == "__main__":
    print(f"updated {len(apply())} site file(s)")
