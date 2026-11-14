import math
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
