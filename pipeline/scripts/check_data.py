"""Check that the published data in web/public/data matches the contracts.

Run in CI before every deploy (no network, no kernels):

    python pipeline/scripts/check_data.py [--data web/public/data]

Checks: sites.json <-> sites/<id>.json one to one, each site's horizon and ephemerides
(the same checks export.py applies), and, when present, the 3D terrain and panorama
binaries have the byte size their metadata promises. Exits 1 listing every problem.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import export  # noqa: E402

BYTES = {"int16": 2, "uint16": 2, "uint8x2": 2, "float32": 4}


def check_terrain(d: Path, sid: str, problems: list[str]) -> None:
    meta_path = d / "terrain" / f"{sid}.json"
    if not meta_path.exists():
        return
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    for part in ("near", "far"):
        m = meta.get(part)
        if not m:
            problems.append(f"terrain/{sid}.json: missing '{part}'")
            continue
        f = d / "terrain" / m["file"]
        want = m["n"] * m["n"] * BYTES[m["dtype"]]
        if not f.exists() or f.stat().st_size != want:
            problems.append(f"terrain/{m['file']}: expected {want} bytes")


def check_pano(d: Path, sid: str, problems: list[str]) -> None:
    meta_path = d / "pano" / f"{sid}.json"
    if not meta_path.exists():
        return
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    for part in ("dist", "normal"):
        m = meta.get(part)
        if not m:
            problems.append(f"pano/{sid}.json: missing '{part}'")
            continue
        f = d / "pano" / m["file"]
        want = meta["width"] * meta["height"] * BYTES[m["dtype"]]
        if not f.exists() or f.stat().st_size != want:
            problems.append(f"pano/{m['file']}: expected {want} bytes")


def check_illum(d: Path, sid: str, problems: list[str]) -> None:
    meta_path = d / "illum" / f"{sid}.json"
    if not meta_path.exists():
        return
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    g = meta.get("grid", 0)
    f = d / "illum" / meta["light"]["file"]
    if not f.exists() or f.stat().st_size != 2 * g * g:
        problems.append(f"illum/{meta['light']['file']}: expected {2 * g * g} bytes")
    elif max(f.read_bytes()) > 200:
        problems.append(f"illum/{meta['light']['file']}: values above 200 (100 %)")


def check(d: Path) -> list[str]:
    problems: list[str] = []
    index = json.loads((d / "sites.json").read_text(encoding="utf-8"))
    ids = [e["id"] for e in index]
    if len(set(ids)) != len(ids):
        problems.append("sites.json: duplicate ids")
    files = {p.stem for p in (d / "sites").glob("*.json")}
    for sid in sorted(set(ids) - files):
        problems.append(f"sites/{sid}.json missing")
    for sid in sorted(files - set(ids)):
        problems.append(f"sites/{sid}.json is not listed in sites.json")
    for entry in index:
        sid = entry["id"]
        p = d / "sites" / f"{sid}.json"
        if not p.exists():
            continue
        site = json.loads(p.read_text(encoding="utf-8"))
        try:
            if site.get("id") != sid:
                raise ValueError(f"id field is {site.get('id')!r}")
            export._check_horizon(site["horizon"])
            export._check_ephem(site["ephem"])
            if entry.get("has_clones") != (site.get("uncertainty") is not None):
                raise ValueError("has_clones disagrees with uncertainty")
        except (ValueError, KeyError, TypeError) as exc:
            problems.append(f"sites/{sid}.json: {exc}")
        check_terrain(d, sid, problems)
        check_pano(d, sid, problems)
        check_illum(d, sid, problems)
    json.loads((d / "validation.json").read_text(encoding="utf-8"))
    json.loads((d / "basemap.json").read_text(encoding="utf-8"))
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", default=str(export.OUT_DIR))
    a = ap.parse_args(argv)
    problems = check(Path(a.data))
    for p in problems:
        print(f"ERROR {p}")
    print(f"{'FAILED' if problems else 'OK'}: {len(problems)} problem(s) in {a.data}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
