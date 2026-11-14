import math
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import dem  # noqa: E402

R = dem.R_MOON_M
POINTS = [(-89.9, 0.0), (-89.45, -137.5), (-87.0, 60.0), (-84.7906, 29.1957), (-80.5, 170.0),
          (-85.3, -179.9), (-88.0, 90.0)]


def _haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@pytest.mark.parametrize("lat,lon", POINTS)
def test_roundtrip_below_1m(lat, lon):
    x, y = dem.latlon_to_xy(lat, lon)
    lat2, lon2 = dem.xy_to_latlon(x, y)
    assert _haversine_m(lat, lon, lat2, lon2) < 1.0


@pytest.mark.parametrize("lat,lon", POINTS)
def test_analytic_projection_matches_pyproj(lat, lon):
    """The numba kernel uses x = 2R u_y/(1-u_z), y = 2R u_x/(1-u_z)."""
    p, l = math.radians(lat), math.radians(lon)
    ux, uy, uz = math.cos(p) * math.cos(l), math.cos(p) * math.sin(l), math.sin(p)
    x, y = dem.latlon_to_xy(lat, lon)
    assert abs(2 * R * uy / (1 - uz) - x) < 1e-3
    assert abs(2 * R * ux / (1 - uz) - y) < 1e-3


def test_north_vector():
    # lon 0: north (away from the pole) is +y; lon 90E: +x
    assert np.allclose(dem.north_xy(-85.0, 0.0), [0, 1], atol=1e-6)
    assert np.allclose(dem.north_xy(-85.0, 90.0), [1, 0], atol=1e-6)
    n = dem.north_xy(-87.3, -40.0)
    assert abs(np.linalg.norm(n) - 1) < 1e-12
    # east = north rotated 90 deg clockwise; moving east must increase longitude
    e = np.array([n[1], -n[0]])
    x, y = dem.latlon_to_xy(-87.3, -40.0)
    _, lon2 = dem.xy_to_latlon(x + 10 * e[0], y + 10 * e[1])
    assert lon2 > -40.0


def _plane_window(gx, gy, res=5.0, n=41):
    rows, cols = np.mgrid[0:n, 0:n]
    xs = (cols + 0.5) * res
    ys = -(rows + 0.5) * res
    z = (gx * xs + gy * ys).astype(np.float32)
    return dem.DemWindow(z=z, left=0.0, top=0.0, res=res, source="test")


def test_slope_of_plane():
    w = _plane_window(math.tan(math.radians(10.0)), 0.0)
    assert abs(dem.slope_deg(w, 100.0, -100.0) - 10.0) < 1e-6
    g = math.tan(math.radians(3.0)) / math.sqrt(2)
    w = _plane_window(g, -g)
    assert abs(dem.slope_deg(w, 102.0, -98.0) - 3.0) < 1e-6
    w20 = _plane_window(math.tan(math.radians(5.0)), 0.0, res=20.0)
    assert abs(dem.slope_deg(w20, 400.0, -400.0) - 5.0) < 1e-6


def test_window_sample_bilinear_and_nan():
    w = _plane_window(1.0, 0.0)
    assert abs(w.sample(52.5, -50.0) - 52.5) < 1e-4
    assert math.isnan(w.sample(-10.0, -10.0))
    w.z[5, 5] = np.nan
    assert math.isnan(w.sample(27.5, -27.5))


def test_sources_declare_units():
    # 87S pixels are metres despite its km GMT range tag (checked against the 20 m mosaic)
    for k in ("lola5_87s", "lola10_83s", "lola20_80s", "lola240_60s"):
        assert dem.SOURCES[k]["unit_to_m"] == 1.0


def test_decode_float_predictor_tile():
    """Round-trip a tile through TIFF float predictor 3 + deflate encoding."""
    import zlib
    rng = np.random.default_rng(0)
    th, tw = 8, 16
    a = rng.normal(1500, 300, (th, tw)).astype("<f4")
    planes = a.view(np.uint8).reshape(th, tw, 4)[:, :, ::-1].transpose(0, 2, 1).reshape(th, tw * 4)
    diff = np.diff(planes.astype(np.int16), axis=1, prepend=0).astype(np.uint8)
    idx = dem.TiffIndex(tw, th, tw, th, [0], [0], 0, 0, 5, 8, 3, 32, 3, True)
    out = dem.decode_tile(zlib.compress(diff.tobytes()), idx)
    assert np.array_equal(out, a)


def _fake_source(tmp_path, tile=4):
    src = dem.DemSource("lola20_80s", cache_dir=tmp_path)
    src._idx = dem.TiffIndex(tile, tile, tile, tile, [0], [0], 0.0, 0.0, 20.0,
                             1, 1, 32, 3, True)
    return src, tile


def test_tmp_paths_are_unique_per_call(tmp_path):
    p = tmp_path / "r0_c0.npy"
    a, b = dem._tmp_path(p), dem._tmp_path(p)
    assert a != b and a.parent == p.parent and a.suffix == ".npy" and str(os.getpid()) in a.name


def test_corrupt_cached_block_is_refetched(tmp_path, monkeypatch):
    src, tile = _fake_source(tmp_path)
    src.cache_dir.mkdir(parents=True)
    path = src._block_path(0, 0)
    path.write_bytes(b"\x93NUMPY truncated")
    calls = []

    def fetch(br, bc0, bc1):
        calls.append((br, bc0, bc1))
        np.save(path, np.full((tile, tile), 7.0, dtype=np.float32))

    monkeypatch.setattr(src, "_fetch_blocks", fetch)
    blk = src._load_block(0, 0)
    assert calls == [(0, 0, 0)] and float(blk[0, 0]) == 7.0


def test_wrong_shape_block_raises_after_one_refetch(tmp_path, monkeypatch):
    src, _ = _fake_source(tmp_path)
    src.cache_dir.mkdir(parents=True)
    path = src._block_path(0, 0)
    bad = lambda *a: np.save(path, np.zeros((2, 2), dtype=np.float32))  # noqa: E731
    bad()
    monkeypatch.setattr(src, "_fetch_blocks", bad)
    with pytest.raises(ValueError, match="corrupt after re-fetch"):
        src._load_block(0, 0)


@pytest.mark.parametrize("code,tries", [(404, 1), (403, 3)])
def test_http_range_retries_only_transient_errors(monkeypatch, code, tries):
    import urllib.error
    import urllib.request
    calls, sleeps = [], []

    def boom(req, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(req.full_url, code, "x", {}, None)

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr(dem.time, "sleep", sleeps.append)
    with pytest.raises(IOError):
        dem.http_range("https://example.org/f.tif", 0, 4, retries=3)
    assert len(calls) == tries and len(sleeps) == tries - 1
