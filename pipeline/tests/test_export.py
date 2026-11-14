"""export.py against synthetic intermediates in a tmp dir (never web/public/data)."""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import export  # noqa: E402

SITES_YAML = Path(__file__).resolve().parents[1] / "config" / "sites.yaml"


def _horizon(sid, lat, lon):
    return {"id": sid, "lat_deg": lat, "lon_deg": lon, "generated_utc": "2026-11-14T00:00:00Z",
            "az_step_deg": 0.5, "heights_m": [2],
            "elev_cdeg": {"2": [int(50 * np.sin(i / 40)) for i in range(720)]},
            "max_dist_m": 200000.0, "slope_deg_50m": 3.21, "dem_res_m": 5.0,
            "dem_source": "synthetic", "elev_m": 1234.56}


def _ephem():
    n = export.EPHEM_N
    a = [i % 36000 for i in range(n)]
    e = [(i % 300) - 150 for i in range(n)]
    return {"t0_utc": export.EPHEM_T0, "step_h": 1, "n": n,
            "sun": {"az_cdeg": a, "el_cdeg": e}, "earth": {"az_cdeg": a, "el_cdeg": e}}


@pytest.fixture
def env(tmp_path, monkeypatch):
    sites = tmp_path / "sites.yaml"
    sites.write_text(
        "sites:\n"
        "  - {id: aa, name: A, lat_deg: -89.5, lon_deg: -150.0, group: artemis, tags: [x],"
        " source_url: 'https://example.org', source_note: 'n'}\n"
        "  - {id: bb, name: B, lat_deg: -85.0, lon_deg: 30.0, group: clps, tags: [],"
        " source_url: 'https://example.org'}\n"
        "  - {id: cc, name: C, lat_deg: -86.0, lon_deg: 0.0, group: science, tags: [],"
        " source_url: 'https://example.org'}\n", encoding="utf-8")
    inter = tmp_path / "inter"
    (inter / "horizon").mkdir(parents=True)
    (inter / "ephem").mkdir()
    for sid, lat, lon in (("aa", -89.5, -150.0), ("bb", -85.0, 30.0)):
        (inter / "horizon" / f"{sid}.json").write_text(json.dumps(_horizon(sid, lat, lon)))
    (inter / "ephem" / "aa.json").write_text(json.dumps(_ephem()))
    (inter / "validation.json").write_text('{"rows": []}')
    out = tmp_path / "out"
    (out / "sites").mkdir(parents=True)
    (out / "sites" / "stale.json").write_text("{}")
    export.atomic_write_json(out / "basemap.json", export.basemap_meta(), compact=False)
    monkeypatch.setattr(export, "INTER_DIR", inter)
    monkeypatch.setattr(export, "HORIZON_DIR", inter / "horizon")
    monkeypatch.setattr(export, "EPHEM_DIR", inter / "ephem")
    # no real ephemerides in tests: sites without an ephem intermediate must be skipped
    monkeypatch.setattr(export, "site_ephem",
                        lambda s, e: json.loads((inter / "ephem" / f"{s['id']}.json").read_text())
                        if (inter / "ephem" / f"{s['id']}.json").exists() else None)
    return sites, out


def test_export_writes_contract_and_skips_incomplete(env):
    sites, out = env
    res = export.export(sites, out, basemap=False)
    assert res["written"] == ["aa"] and res["skipped"] == ["bb", "cc"]
    idx = json.loads((out / "sites.json").read_text())
    assert [e["id"] for e in idx] == ["aa"]
    e = idx[0]
    for k in ("id", "name", "lat_deg", "lon_deg", "elev_m", "group", "tags", "source_url",
              "dem_res_m", "dem_source", "has_clones", "slope_deg_50m", "map_px"):
        assert k in e
    assert e["has_clones"] is False and len(e["map_px"]) == 2
    d = json.loads((out / "sites" / "aa.json").read_text())
    assert d["frame"] == "MOON_ME" and d["uncertainty"] is None
    assert len(d["horizon"]["elev_cdeg"]["2"]) == 720
    assert all(isinstance(v, int) for v in d["horizon"]["elev_cdeg"]["2"])
    assert len(d["ephem"]["sun"]["az_cdeg"]) == export.EPHEM_N
    assert not (out / "sites" / "stale.json").exists()
    assert not (out / "sites" / "bb.json").exists()
    assert json.loads((out / "validation.json").read_text()) == {"rows": []}
    assert " " not in (out / "sites" / "aa.json").read_text()[:200]  # compact


def test_export_is_deterministic(env):
    sites, out = env
    export.export(sites, out, basemap=False)
    a = {p.name: p.read_bytes() for p in out.rglob("*.json")}
    export.export(sites, out, basemap=False)
    b = {p.name: p.read_bytes() for p in out.rglob("*.json")}
    assert a == b
    assert not list(out.rglob("*.tmp"))


def test_map_px_inverse_of_affine():
    meta = export.basemap_meta()
    px = export.map_px(meta, -90.0, 0.0)
    assert px == [meta["width_px"] / 2, meta["height_px"] / 2]
    # 0 E points down the image (+y map is up, so lon 0 is towards the top), 90 E to the right
    x0, y0 = export.map_px(meta, -85.0, 0.0)
    assert abs(x0 - 1024) < 0.1 and y0 < 1024
    x1, y1 = export.map_px(meta, -85.0, 90.0)
    assert x1 > 1024 and abs(y1 - 1024) < 0.1
    assert -84.0 < meta["extent_lat_deg"] < -83.0


def test_png_writer(tmp_path):
    img = (np.arange(64 * 32) % 256).astype(np.uint8).reshape(32, 64)
    p = tmp_path / "x.png"
    export.write_png_gray(p, img)
    b = p.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n"
    try:
        from PIL import Image
    except ImportError:
        return
    assert np.array_equal(np.asarray(Image.open(p)), img)


def test_reject_bad_horizon():
    h = _horizon("aa", -89.5, -150.0)
    h["elev_cdeg"]["2"] = h["elev_cdeg"]["2"][:719]
    with pytest.raises(ValueError):
        export._check_horizon(h)
    h = _horizon("aa", -89.5, -150.0)
    h["elev_cdeg"]["2"][3] = -9000
    with pytest.raises(ValueError):
        export._check_horizon(h)


@pytest.mark.skipif(not SITES_YAML.exists(), reason="sites.yaml not written yet")
def test_sites_yaml_is_well_formed():
    sites = export.load_sites(SITES_YAML)
    assert 10 <= len(sites) <= 15
    for s in sites:
        assert s["id"] == s["id"].lower() and " " not in s["id"] and "_" not in s["id"]
        assert -90 <= s["lat_deg"] <= -80 and -180 <= s["lon_deg"] <= 180
        assert s["source_url"].startswith("https://") and s.get("source_note")
        assert s["group"] and isinstance(s["tags"], list)
