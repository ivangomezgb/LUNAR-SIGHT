"""Geometry, binary contract, and real-data horizon regression checks."""
import json
import math
import numpy as np
import pytest
from lln.dem import R_MOON_M, DemSource, latlon_to_xy
from lln.horizon import scale_mask
from lln.terrain import OUTPUT, PIPELINE, tangent_heights, quantize

@pytest.mark.parametrize('lat,lon', [(-90,0),(-85,37),(-88,-137)])
def test_flat_sphere(lat,lon):
    n, spacing, elev = 256,400.,1947.27
    z = tangent_heights(np.full((400,400),elev),-800000.,800000.,4000.,
                        math.radians(lat),math.radians(lon),elev,n,spacing)
    x = (np.arange(n)-(n-1)/2)*spacing
    d2 = x[:,None]**2+x[None,:]**2
    expected = np.sqrt((R_MOON_M+elev)**2-d2)-(R_MOON_M+elev)
    assert np.isfinite(z).all()
    assert np.max(np.abs(z-expected)) < .05


def test_quantization():
    z = np.array([[-4000., 11.23, np.nan]])
    a,s = quantize(z,.1)
    assert s == .25
    assert a.dtype.str == '<i2'
    assert a[0,2] == -32768
    assert np.max(np.abs(a[0,:2]*s-z[0,:2])) <= s/2


def node_horizon(meta):
    """Sample each azimuth at its intersections with grid rows and columns.

    Heights between nodes use bilinear interpolation. This avoids an angular
    sector artificially raising a narrow ridge's horizon in adjacent azimuths.
    The near square replaces the overlapping far surface.
    """
    result = np.full(72,-90.)
    for name in ('near','far'):
        g = meta[name]
        raw = np.fromfile(OUTPUT/g['file'],dtype='<i2').reshape(g['n'],g['n'])
        assert not np.any(raw == -32768)
        z = raw*g['scale_m']+g['offset_m']
        extent = (g['n']-1)/2*g['res_m']
        axis = (np.arange(g['n'])-(g['n']-1)/2)*g['res_m']
        near_extent = (meta['near']['n']-1)/2*meta['near']['res_m']
        for k in range(72):
            az = math.radians(k*5)
            dx,dy = math.sin(az),math.cos(az)
            distances = np.concatenate([axis/v for v in (dx,dy) if abs(v)>1e-10])
            distances = distances[(distances>0)&(distances<=51000)]
            x,y = distances*dx,distances*dy
            valid = (np.abs(x)<extent)&(np.abs(y)<extent)
            if name == 'far':
                valid &= (np.abs(x)>near_extent)|(np.abs(y)>near_extent)
            distances,x,y = distances[valid],x[valid],y[valid]
            c,r = (x+extent)/g['res_m'],(extent-y)/g['res_m']
            c0,r0 = np.floor(c).astype(int),np.floor(r).astype(int)
            fc,fr = c-c0,r-r0
            heights = (z[r0,c0]*(1-fc)*(1-fr)+z[r0,c0+1]*fc*(1-fr)
                       +z[r0+1,c0]*(1-fc)*fr+z[r0+1,c0+1]*fc*fr)
            if len(heights):
                result[k] = max(result[k],np.degrees(np.arctan2(heights-2,distances)).max())
    return result


def real_horizon_stats(sid):
    meta = json.loads((OUTPUT/f'{sid}.json').read_text())
    h = json.loads((PIPELINE/f'data/intermediate/horizon/{sid}.json').read_text())
    # Repeat the ORIGINAL multiscale plan, truncated at 51 km. Equality
    # identifies directions whose published horizon is set within that range.
    start = np.full(72,h['dem_res_m'])
    mask = np.full(72,-90.)
    x,y = latlon_to_xy(h['lat_deg'],h['lon_deg'])
    for scale in h['scales']:
        source = DemSource(scale['source'])
        limit = min(51000.,scale['d_max_m'])
        w = source.read_window(x,y,limit+4*source.res)
        el,reach = scale_mask(w,h['lat_deg'],h['lon_deg'],R_MOON_M+h['elev_m']+2,
                              start,limit,az_step=5)
        mask = np.maximum(mask,el)
        start = np.maximum(start,reach)
        if limit == 51000:
            break
    reference = np.array(h['elev_cdeg']['2'])[::10]/100
    eligible = np.abs(mask-reference) <= .0051
    errors = np.abs(node_horizon(meta)-reference)
    selected = errors[eligible]
    return dict(site=sid,n=int(eligible.sum()),mean_deg=float(selected.mean()),
                max_deg=float(selected.max()),over_05=int(np.sum(selected>.5)))

@pytest.mark.parametrize('sid',['connecting-ridge','de-gerlache-rim-1','peak-near-shackleton'])
def test_real_horizon(sid):
    if not (OUTPUT/f'{sid}.json').exists():
        pytest.skip('generate real terrain first: python -m lln.terrain')
    if not (PIPELINE/f'data/intermediate/horizon/{sid}.json').exists():
        pytest.skip('needs the horizon intermediate (gitignored): python run_all.py')
    stats = real_horizon_stats(sid)
    print(stats)
    assert stats['n'] > 0
    assert stats['max_deg'] <= .5, stats
