"""Synthetic-DEM checks of the horizon kernel (fixtures live only here)."""
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import dem, horizon  # noqa: E402

R = horizon.R_MOON
LAT, LON = -88.0, 30.0


def _grid(half_m, res, fill=0.0):
    x0, y0 = dem.latlon_to_xy(LAT, LON)
    n = int(2 * half_m / res)
    z = np.full((n, n), fill, dtype=np.float32)
    left, top = x0 - n * res / 2, y0 + n * res / 2
    rows, cols = np.mgrid[0:n, 0:n]
    xs = left + (cols + 0.5) * res
    ys = top - (rows + 0.5) * res
    return dem.DemWindow(z=z, left=left, top=top, res=res, source="synthetic"), xs - x0, ys - y0


def _run(w, h, d_max, step=None, d_start=None):
    n_az = 720
    ds = np.full(n_az, w.res) if d_start is None else d_start
    return horizon.scale_mask(w, LAT, LON, R + w.sample(*dem.latlon_to_xy(LAT, LON)) + h,
                              ds, d_max, 0.5, step)


def test_smooth_moon_2m():
    w, _, _ = _grid(4000.0, 10.0)
    el, reach = _run(w, 2.0, 3800.0)
    exact = -math.degrees(math.acos(R / (R + 2.0)))      # tangent ray, needs d >= sqrt(2hR)
    assert abs(exact - (-math.degrees(math.sqrt(2 * 2.0 / R)))) < 1e-4
    assert abs(exact + 0.087) < 0.001
    assert np.all(np.abs(el - exact) < 0.01)
    assert np.all(np.abs(el - exact) < 0.001)
    assert np.all(reach == 3800.0)


def test_smooth_moon_short_range_is_analytic():
    """With d_max below sqrt(2hR) = 2636 m the horizon is the last sample, not -sqrt(2h/R)."""
    w, _, _ = _grid(1500.0, 5.0)
    d = 1000.0
    el, _ = _run(w, 2.0, d, step=5.0)
    th = d / R
    expected = math.degrees(math.atan2(R * math.cos(th) - (R + 2.0), R * math.sin(th)))
    assert np.all(np.abs(el - expected) < 1e-3)


def test_wall_ring():
    H, h, D = 80.0, 2.0, 1500.0
    w, dx, dy = _grid(2000.0, 2.0)
    r = np.hypot(dx, dy)
    w.z[(r >= D) & (r < D + 60.0)] = H
    el, _ = _run(w, h, 1900.0, step=1.0)
    expected = math.degrees(math.atan((H - h - D * D / (2 * R)) / D))
    assert np.all(np.abs(el - expected) < 0.02), (el.min(), el.max(), expected)


def test_wall_azimuth_orientation():
    """A block due east of the site must appear at azimuth 90 deg (index 180), north at 0."""
    w, dx, dy = _grid(2000.0, 4.0)
    n = dem.north_xy(LAT, LON)
    e = np.array([n[1], -n[0]])
    along_e = dx * e[0] + dy * e[1]
    across_e = dx * n[0] + dy * n[1]
    w.z[(along_e > 1000) & (along_e < 1100) & (np.abs(across_e) < 50)] = 100.0
    along_n, across_n = across_e, along_e
    w.z[(along_n > 1000) & (along_n < 1100) & (np.abs(across_n) < 50)] = 200.0
    el, _ = _run(w, 2.0, 1900.0, step=2.0)
    assert el[180] > 5.0 and el[0] > 10.0
    assert el[360] < 0.0 and el[540] < 0.0
    # angular width of the 100 m wide block at 1000 m: about +-2.9 deg
    lit = np.where(el > 1.0)[0]
    assert set(range(175, 186)).issubset(lit)
    assert not set(range(195, 345)).intersection(lit)


def test_edge_and_nodata_are_recorded():
    w, dx, dy = _grid(1000.0, 5.0)
    el, reach = _run(w, 2.0, 7500.0)
    assert reach.max() < 1000.0 * math.sqrt(2) + 10 and reach.min() > 900.0
    # nodata hole due north at 300 m: those rays stop there
    n = dem.north_xy(LAT, LON)
    along = dx * n[0] + dy * n[1]
    across = dx * n[1] - dy * n[0]
    w.z[(along > 300) & (along < 400) & (np.abs(across) < 30)] = np.nan
    el, reach = _run(w, 2.0, 7500.0)
    assert reach[0] < 300.0
    assert reach[180] > 900.0


def test_next_scale_starts_where_previous_stopped():
    w, _, _ = _grid(2000.0, 10.0)
    start = np.full(720, 500.0)
    start[0] = 1950.0                  # beyond d_max of this scale
    el, reach = _run(w, 2.0, 1800.0, d_start=start)
    assert reach[0] == 1800.0          # nothing to do -> complete
    assert el[0] == -90.0              # but contributes no sample
    assert np.all(reach[1:] == 1800.0)


@pytest.mark.parametrize("d,bound", [(7500.0, 1e-5), (60000.0, 3e-4), (200000.0, 4e-3)])
def test_parabolic_error_documented(d, bound):
    """Exact sphere vs parabolic drop d^2/2R for a target at height 0, observer at 2 m.
    Measured: ~1e-6 deg at 7.5 km, ~2e-4 deg at 60 km, 0.0036 deg at 200 km. The kernel uses
    the exact form anyway."""
    th = d / R
    exact = math.atan2(R * math.cos(th) - (R + 2.0), R * math.sin(th))
    parab = math.atan((-2.0 - d * d / (2 * R)) / d)
    assert abs(math.degrees(exact - parab)) < bound
