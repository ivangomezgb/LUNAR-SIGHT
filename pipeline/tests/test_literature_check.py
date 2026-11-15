"""Definitions used to compare with the published LOLA average-visibility maps."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import literature_check as lc  # noqa: E402


def test_mask_interpolation_is_circular():
    mask = np.array([0, 100, 200, 300])  # cdeg every 90 deg
    assert np.allclose(lc.mask_at(mask, 90.0, np.array([0, 45, 315, 360])), [0, 0.5, 1.5, 0])


def test_any_part_of_disc_counts_partial_visibility():
    mask = np.zeros(4)                    # flat 0 deg horizon
    az = np.zeros(3)
    el = np.array([-0.3, -0.2, 0.1])      # centre below, limb above, fully above
    assert lc.any_disc_pct(az, el, mask, 90.0, lc.SUN_RADIUS_DEG) == 2 / 3 * 100


def test_selection_restricts_the_window():
    mask = np.zeros(4)
    az, el = np.zeros(4), np.array([1.0, 1.0, -1.0, -1.0])
    assert lc.any_disc_pct(az, el, mask, 90.0, 0.267, np.array([True, True, False, False])) == 100.0
