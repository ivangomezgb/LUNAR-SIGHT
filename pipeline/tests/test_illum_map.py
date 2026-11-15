"""Illumination map: kernels on synthetic grids, and agreement with the published metrics."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import illum_map, metrics  # noqa: E402

R = illum_map.R_MOON_M
DATA = illum_map.DATA


def _sphere(n=201, res=25.0):
    c = (np.arange(n) - (n - 1) / 2) * res
    x, y = np.meshgrid(c, -c)
    return -(x * x + y * y) / (2 * R)


def test_march_sees_the_analytic_dip_on_a_smooth_moon():
    g = _sphere()
    lim = (g.shape[0] - 1) / 2 * 25.0 - 25.0
    dip = -math.degrees(math.acos(R / (R + 2.0)))
    for az in (0.0, 135.0, 270.0):
        assert illum_map._march(g, 25.0, g, 25.0, lim, 0.0, 0.0, 2.0, az) == pytest.approx(dip, abs=0.01)


def test_sun_fraction_and_accumulate():
    assert illum_map._sun_fraction(0.0, 0.0) == pytest.approx(0.5)
    assert illum_map._sun_fraction(1.0, 0.0) == 1.0 and illum_map._sun_fraction(-1.0, 0.0) == 0.0
    hz = np.zeros((2, 180), dtype=np.float32)
    hz[1, :] = 5.0  # second cell sits in a deep pit
    az = np.linspace(0, 359, 100)
    el = np.where(np.arange(100) < 75, 1.0, -1.0)  # Sun up 75 % of the hours
    light, earth = illum_map.accumulate(hz, 2.0, az, el, az, np.full(100, 3.0), 0.5)
    assert light[0] == pytest.approx(0.75) and light[1] == 0.0
    assert earth[0] == 1.0 and earth[1] == 0.0


needs = pytest.mark.skipif(not (DATA / "terrain" / "connecting-ridge.json").exists(), reason="no published terrain")


@needs
def test_site_point_matches_the_published_yearly_metrics():
    light, earth = illum_map.compute("connecting-ridge", points=[(0.0, 0.0)])
    site = json.loads((DATA / "sites" / "connecting-ridge.json").read_text(encoding="utf-8"))
    m = metrics.compute_metrics(site, "2027-01-01T00:00:00Z", 8760)
    assert 100 * light[0] == pytest.approx(m["lightPct"], abs=1.0)
    assert 100 * earth[0] == pytest.approx(m["earthPct"], abs=1.0)
