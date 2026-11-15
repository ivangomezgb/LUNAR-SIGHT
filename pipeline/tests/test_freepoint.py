"""Synthetic fixtures are confined to this test module."""
import json

import numpy as np
import pytest

from lln import dem, ephem
from lln.freepoint import OUT, quantize, reduce_max


def test_quantization_and_nodata():
    z = np.array([[1.2, -3.7], [np.nan, 12000]])
    q = quantize(z)
    assert q.dtype == np.dtype('<i2')
    assert q.tolist() == [[1, -4], [-32768, 12000]]
    with pytest.raises(ValueError):
        quantize(np.array([12001]))


def test_far_grid_keeps_peaks_and_missing_data():
    z = np.arange(16, dtype=float).reshape(4, 4)
    assert reduce_max(z, 2).tolist() == [[5, 7], [13, 15]]
    z[0, 0] = np.nan
    assert np.isnan(reduce_max(z, 2)[0, 0])
    with pytest.raises(ValueError):
        reduce_max(z, 3)


@pytest.mark.skipif(not (OUT / 'meta.json').exists(), reason='Free assets not generated')
def test_real_asset_contract_and_projection():
    meta = json.loads((OUT / 'meta.json').read_text())
    total = 0
    for g in meta['grids']:
        q = np.fromfile(OUT / g['file'], dtype='<i2')
        assert len(q) == g['n'] ** 2
        assert not np.any(q == -32768)
        total += q.nbytes
    vectors = np.fromfile(OUT / meta['vectors_file'], dtype='<f4')
    assert len(vectors) == meta['n'] * 6
    assert np.isfinite(vectors).all()
    assert total + vectors.nbytes == meta['payload_bytes'] <= 12_000_000
    for lat, lon in [(-90, 0), (-84, 45), (-85, -130)]:
        rho = 2 * dem.R_MOON_M * np.tan(np.radians(90 + lat) / 2)
        assert dem.latlon_to_xy(lat, lon) == pytest.approx(
            (rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))), abs=1e-7)


@pytest.mark.skipif(not (OUT / 'meta.json').exists(), reason='Free assets not generated')
def test_float32_vectors_match_published_sites():
    meta = json.loads((OUT / 'meta.json').read_text())
    pos = np.fromfile(OUT / 'vectors.bin', dtype='<f4').reshape(-1, 2, 3)
    data = OUT.parent
    sites = json.loads((data / 'sites.json').read_text(encoding='utf-8'))
    for s in sites:
        published = json.loads((data / 'sites' / f"{s['id']}.json").read_text())
        assert published['ephem']['n'] == meta['n']
        for b, body in enumerate(['sun', 'earth']):
            az, el = ephem.topo_azel(pos[:, b].astype(float), s['lat_deg'], s['lon_deg'], s['elev_m'])
            azc, elc = ephem.to_cdeg(az, el)
            da = (np.array(azc) - published['ephem'][body]['az_cdeg'] + 18000) % 36000 - 18000
            de = np.array(elc) - published['ephem'][body]['el_cdeg']
            assert np.max(np.abs(da)) <= 1
            assert np.max(np.abs(de)) <= 1
