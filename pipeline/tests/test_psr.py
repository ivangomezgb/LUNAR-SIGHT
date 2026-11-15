"""Geometry helpers of the PSR / long-term illumination reader (no network)."""
import base64
import math

import numpy as np

from lln import psr


def test_pixel_mapping_round_trip_and_pds_convention():
    p = psr.P85
    # Map origin (the pole) sits between the two central pixels: offset 2528.5 -> 0-based 2528.5.
    assert psr.xy_to_rc(p, 0.0, 0.0) == (2528.5, 2528.5)
    r, c = psr.xy_to_rc(p, 1200.0, -600.0)
    x, y = psr.rc_to_xy(p, r, c)
    assert math.isclose(float(x), 1200.0) and math.isclose(float(y), -600.0)
    assert r > 2528.5 and c > 2528.5  # south of the pole in map y = larger row; east = larger column


def test_product_choice_by_distance_from_pole():
    assert psr.product_for(10_000, 10_000) is psr.P85
    assert psr.product_for(0, -200_000) is psr.P75   # outside the 85S map: Cabeus B is ~192 km out


def test_bearing_toward_the_pole_is_south():
    # At 89 S on lon 0 the site is at map y = +30 km: towards the pole (-y) is south, away (+y) is north.
    assert math.isclose(psr.bearing_deg(-89.0, 0.0, 0.0, -30_000.0), 180.0, abs_tol=0.5)
    assert psr.bearing_deg(-89.0, 0.0, 0.0, 30_000.0) % 360 < 0.5 or psr.bearing_deg(-89.0, 0.0, 0.0, 30_000.0) > 359.5


def test_pack_bits_is_reversible():
    mask = np.zeros((3, 5), bool)
    mask[1, 2] = mask[2, 4] = True
    raw = np.frombuffer(base64.b64decode(psr.pack_bits(mask)), np.uint8)
    assert np.array_equal(np.unpackbits(raw)[:15].reshape(3, 5).astype(bool), mask)
