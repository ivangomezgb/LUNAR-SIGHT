"""scripts/check_data.py: the published data passes, and broken copies are caught."""
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_data  # noqa: E402

DATA = ROOT.parent / "web" / "public" / "data"
needs_data = pytest.mark.skipif(not (DATA / "sites.json").exists(), reason="no published data")


@needs_data
def test_published_data_passes():
    assert check_data.check(DATA) == []


@needs_data
def test_detects_missing_and_inconsistent_sites(tmp_path):
    d = tmp_path / "data"
    (d / "sites").mkdir(parents=True)
    for name in ("sites.json", "validation.json", "basemap.json"):
        shutil.copyfile(DATA / name, d / name)
    index = json.loads((d / "sites.json").read_text(encoding="utf-8"))
    first, second = index[0]["id"], index[1]["id"]
    site = json.loads((DATA / "sites" / f"{first}.json").read_text(encoding="utf-8"))
    site["horizon"]["elev_cdeg"]["2"] = site["horizon"]["elev_cdeg"]["2"][:10]
    (d / "sites" / f"{first}.json").write_text(json.dumps(site), encoding="utf-8")
    (d / "sites" / "orphan.json").write_text("{}", encoding="utf-8")
    problems = check_data.check(d)
    assert any(p.startswith(f"sites/{first}.json: horizon key 2") for p in problems)
    assert f"sites/{second}.json missing" in problems
    assert "sites/orphan.json is not listed in sites.json" in problems
