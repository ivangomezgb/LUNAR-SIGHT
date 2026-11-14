"""Offline tests for the Horizons parser and helpers (fixtures are real Horizons responses)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import validate  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


def test_parse_sun_fixture():
    rows = validate.parse_horizons_azel((FIX / "horizons_sun_shackleton.txt").read_text())
    assert rows == [
        {"t_utc": "2026-11-01T00:00:00Z", "az": 285.128280462, "el": 1.482653360},
        {"t_utc": "2027-06-15T12:00:00Z", "az": 46.036972679, "el": -1.120321992},
    ]


def test_parse_earth_fixture():
    rows = validate.parse_horizons_azel((FIX / "horizons_earth_mons_mouton.txt").read_text())
    assert len(rows) == 10
    assert [r["t_utc"] for r in rows] == validate.VALIDATION_TIMES
    assert all(0 <= r["az"] < 360 and -90 <= r["el"] <= 90 for r in rows)


def test_fixture_is_airless():
    assert "Atmos refraction: NO (AIRLESS)" in (FIX / "horizons_sun_shackleton.txt").read_text()


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        validate.parse_horizons_azel("No ephemeris for target")


@pytest.mark.parametrize("a,b,d", [(359.9, 0.1, -0.2), (0.1, 359.9, 0.2), (10, 350, 20), (180, 0, 180)])
def test_circ_diff(a, b, d):
    assert validate.circ_diff_deg(a, b) == pytest.approx(d)


def test_horizon_at_and_sun_fraction():
    mask = [0] * 720
    mask[1] = 100  # 1 deg at az 0.5
    assert validate.horizon_at(mask, 0.25) == pytest.approx(0.5)
    assert validate.horizon_at(mask, 359.75) == pytest.approx(0.0)
    assert validate.sun_fraction(0.0, 0.0) == pytest.approx(0.5)
    assert validate.sun_fraction(1.0, 0.0) == 1.0
    assert validate.sun_fraction(-1.0, 0.0) == 0.0


@pytest.mark.skipif(not (validate.ephem.KERNEL_DIR / "de440s.bsp").exists(), reason="no kernels")
def test_ours_matches_fixture():
    for r in validate.parse_horizons_azel((FIX / "horizons_sun_shackleton.txt").read_text()):
        az, el = validate.ours_azel("sun", -89.9, 0.0, 0.0, [r["t_utc"]])
        assert abs(validate.circ_diff_deg(az[0], r["az"])) < 1e-4
        assert abs(el[0] - r["el"]) < 1e-4


@pytest.mark.skipif(not (validate.ephem.KERNEL_DIR / "de440s.bsp").exists(), reason="no kernels")
def test_im2_case_with_mask():
    flat = validate.im2_case()
    assert flat["horizon_el_at_sun_az_deg"] is None and flat["sun_fraction"] is None
    assert -90 <= flat["sun_el_deg"] <= 90 and 0 <= flat["sun_az_deg"] < 360
    masked = validate.im2_case(horizon_mask_cdeg=[0] * 720)
    assert masked["horizon_el_at_sun_az_deg"] == 0.0
    assert masked["horizon_az_step_deg"] == 0.5 and len(masked["horizon_elev_cdeg"]) == 720
