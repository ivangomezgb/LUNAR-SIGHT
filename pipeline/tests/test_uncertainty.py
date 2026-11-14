"""Synthetic fixtures stay in tests; PGDA clones are complete surfaces."""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lln import dem, horizon, uncertainty


def test_linear_percentiles_and_order_independence():
    expected = dict(illum_pct_p5=5.0, illum_pct_p50=50.0, illum_pct_p95=95.0)
    assert uncertainty.percentiles([100, 0, 50]) == expected
    assert uncertainty.percentiles([0, 50, 100]) == expected
    assert uncertainty.percentiles([12])['illum_pct_p95'] == 12


@pytest.mark.parametrize('values', [[], [np.nan], [np.inf], [-1], [101], [[20]]])
def test_invalid_percentiles(values):
    with pytest.raises(ValueError):
        uncertainty.percentiles(values)


def test_clone_is_full_surface_and_nodata_is_preserved():
    base = np.array([[100., 101.], [np.nan, 102.]])
    clone = np.array([[100.3, 100.8], [100., np.nan]])
    np.testing.assert_allclose(uncertainty.clone_surface(base, clone),
                               [[100.3, 100.8], [np.nan, np.nan]], equal_nan=True)
    with pytest.raises(ValueError):
        uncertainty.clone_surface(base, clone[:1])


def test_far_mask_preserves_distant_obstructions():
    np.testing.assert_array_equal(uncertainty.combine_masks([3., 1., 2.], [1., 4., -1.]), [3., 4., 2.])
    with pytest.raises(ValueError):
        uncertainty.combine_masks([1., 2.], [1.])


def test_replayed_far_removes_original_near_obstruction(monkeypatch):
    class Source:
        res = 5

        def __init__(self, key):
            self.key = key

        def read_window(self, *args):
            return self.key

    calls = []

    def scale(win, lat, lon, radius, starts, limit, az_step):
        calls.append(starts.copy())
        return (np.array([-1., 1.]) if win == 'near' else np.array([-2., .5]),
                np.full(2, limit))

    monkeypatch.setattr(uncertainty, 'CachedDem', Source)
    monkeypatch.setattr(uncertainty.horizon, 'scale_mask', scale)
    full = dict(scales=[dict(source='near', d_max_m=10), dict(source='far', d_max_m=20)],
                elev_m=100, max_dist_m=20, az_step_deg=180, elev_cdeg={'2': [300, 200]})
    far = uncertainty.retained_far(dict(lat_deg=-89., lon_deg=0.), full, np.full(2, 5.))
    np.testing.assert_array_equal(far, [-1., 1.])
    np.testing.assert_array_equal(calls, [[5., 5.], [10., 10.]])
    # A lowered clone can now lower the old near obstruction, while the far ridge remains.
    np.testing.assert_array_equal(uncertainty.combine_masks(far, [-2., .5]), [-1., 1.])


def test_clone_observer_moves_with_terrain_and_ridge_changes_horizon():
    lat, lon = -89., 0.
    x, y = dem.latlon_to_xy(lat, lon)
    z = np.full((100, 100), 100.)
    win = dem.DemWindow(z, x-500, y+500, 10., 'synthetic test')
    starts = np.full(36, 10.)

    def mask(surface):
        w = dem.DemWindow(surface, win.left, win.top, win.res, win.source)
        return horizon.scale_mask(w, lat, lon, dem.R_MOON_M+w.sample(x,y)+2,
                                  starts, 400, 10)[0]

    base_mask = mask(z)
    translated = uncertainty.clone_surface(z, z+1.)
    # A uniform vertical shift must move the observer too; no spurious metre-high wall.
    np.testing.assert_allclose(mask(translated), base_mask, atol=1e-5)
    ridge = z.copy()
    ridge[20:25, :] += 20.
    assert mask(uncertainty.clone_surface(z, ridge))[0] > base_mask[0] + 1
