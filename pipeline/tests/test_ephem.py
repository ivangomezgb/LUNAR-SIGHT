"""Tests for lln.ephem (need the SPICE kernels: python pipeline/scripts/download_kernels.py)."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import ephem  # noqa: E402

pytestmark = pytest.mark.skipif(not (ephem.KERNEL_DIR / "de440s.bsp").exists(),
                                reason="SPICE kernels not downloaded")


def test_moon_me_frame_resolves():
    ephem.load_kernels()
    import spiceypy as sp
    assert sp.namfrm("MOON_ME") == 31001


def test_body_positions_shape_and_distance():
    p = ephem.body_positions("EARTH", ephem.T0_UTC, 48)
    assert p.shape == (48, 3)
    d = np.linalg.norm(p, axis=1)
    assert np.all((d > 356_000) & (d < 407_000))


def test_topo_azel_zenith_and_horizon():
    # a point straight above a site is at el 90; a far point along local north is at el ~0, az 0
    east, north, up = ephem.enu_basis(-85.0, 30.0)
    az, el = ephem.topo_azel(np.array([up * 1e6]), -85.0, 30.0)
    assert el[0] == pytest.approx(90.0, abs=1e-6)
    az, el = ephem.topo_azel(np.array([north * 1e9]), -85.0, 30.0)
    assert az[0] == pytest.approx(0.0, abs=1e-6) or az[0] == pytest.approx(360.0, abs=1e-6)
    assert el[0] == pytest.approx(0.0, abs=1e-3)
    az, _ = ephem.topo_azel(np.array([east * 1e9]), -85.0, 30.0)
    assert az[0] == pytest.approx(90.0, abs=1e-3)


@pytest.fixture(scope="module")
def shackleton():
    return ephem.site_ephem(-89.9, 0.0, 0.0)


def test_site_ephem_contract(shackleton):
    e = shackleton
    assert e["t0_utc"] == "2026-11-01T00:00:00Z" and e["step_h"] == 1 and e["n"] == 19008
    for body in ("sun", "earth"):
        az, el = e[body]["az_cdeg"], e[body]["el_cdeg"]
        assert len(az) == len(el) == 19008
        assert all(isinstance(v, int) for v in az[:100] + el[:100])
        az, el = np.array(az), np.array(el)
        assert az.min() >= 0 and az.max() < 36000
        assert el.min() >= -9000 and el.max() <= 9000


def test_sun_low_at_pole(shackleton):
    el = np.array(shackleton["sun"]["el_cdeg"]) / 100.0
    # at 89.9 S the Sun stays within lunar obliquity (1.54 deg) + 0.1 deg of the horizon
    assert np.abs(el).max() < 2.0
    # and it goes all the way around in azimuth
    az = np.array(shackleton["sun"]["az_cdeg"]) / 100.0
    assert np.histogram(az, bins=12, range=(0, 360))[0].min() > 0


def test_earth_near_horizon_at_pole(shackleton):
    el = np.array(shackleton["earth"]["el_cdeg"]) / 100.0
    assert np.abs(el).max() < 9.0  # libration-limited
