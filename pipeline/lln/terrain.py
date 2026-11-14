"""Exact local ENU terrain. Run from pipeline/: python -m lln.terrain."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from numba import njit
from .dem import DemSource, R_MOON_M, latlon_to_xy
from .horizon import _bilinear

PIPELINE = Path(__file__).resolve().parents[1]
OUTPUT = PIPELINE.parent / 'web/public/data/terrain'

@njit(cache=True)
def tangent_heights(dem, left, top, res, lat, lon, site_elev, n, spacing):
    """Invert tangent projection using the positive sphere root; iterate radial DEM height."""
    sl, cl, so, co = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    out = np.full((n, n), np.nan)
    for j in range(n):
        y = ((n-1)/2-j)*spacing
        for i in range(n):
            x = (i-(n-1)/2)*spacing
            h = site_elev
            for iteration in range(30):
                radial = R_MOON_M+h
                up = math.sqrt(radial*radial-x*x-y*y)
                px = -x*so-y*sl*co+up*cl*co
                py = x*co-y*sl*so+up*cl*so
                pz = y*cl+up*sl
                k = 2*R_MOON_M/(radial-pz)
                z = _bilinear(dem, (k*py-left)/res-.5, (top-k*px)/res-.5)
                if not math.isfinite(z):
                    break
                if abs(z-h) < .0001:
                    radial = R_MOON_M+z
                    up = math.sqrt(radial*radial-x*x-y*y)
                    out[j,i] = z-site_elev-(x*x+y*y)/(radial+up)
                    break
                h = z
    return out

def make_grid(source, lat, lon, elev, n, spacing):
    x,y = latlon_to_xy(lat,lon)
    radius = math.sqrt(2)*(n-1)/2*spacing*1.03+4*source.res
    w = source.read_window(x,y,radius)
    return tangent_heights(w.z,w.left,w.top,w.res,math.radians(lat),math.radians(lon),elev,n,spacing)

def quantize(z, minimum):
    valid = np.isfinite(z)
    if not valid.any():
        raise ValueError('no valid terrain')
    peak = np.max(np.abs(z[valid]))
    scale = next(s for s in (.1,.25,.5,1.,2.,4.,8.) if s >= minimum and peak/s <= 32767)
    values = np.full(z.shape,-32768,dtype='<i2')
    values[valid] = np.rint(z[valid]/scale).astype('<i2')
    return values,scale

def export_site(site, output=OUTPUT):
    sid = site['id']
    h = json.loads((PIPELINE/f'data/intermediate/horizon/{sid}.json').read_text())
    if any(h[c] != site[c] for c in ('lat_deg','lon_deg')):
        raise ValueError(f'{sid}: stale horizon coordinates')
    key = h['scales'][0]['source']
    if key not in ('lola5_87s','lola10_83s'):
        raise ValueError(f'{sid}: no 5/10 m near DEM')
    meta = dict(id=sid,frame='local ENU tangent plane at site, curvature included',
                site_elev_m=h['elev_m'],observer_heights_m=h['heights_m'])
    output.mkdir(parents=True,exist_ok=True)
    for name,key,n,spacing,minimum in (('near',key,1024,10.,.1),('far','lola240_60s',256,400.,1.)):
        source = DemSource(key)
        z = make_grid(source,site['lat_deg'],site['lon_deg'],h['elev_m'],n,spacing)
        if not np.isfinite(z).all():
            raise ValueError(f'{sid} {name}: {np.sum(~np.isfinite(z))} missing/nonconverged nodes')
        values,scale = quantize(z,minimum)
        filename = f'{sid}.{name}.bin'
        (output/filename).write_bytes(values.tobytes())
        meta[name] = dict(file=filename,n=n,res_m=spacing,dtype='int16',scale_m=scale,offset_m=0,source=source.label)
        print(f'{sid} {name}: {z.min():.2f}..{z.max():.2f} m; scale {scale}',flush=True)
    (output/f'{sid}.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    return meta

def main():
    import yaml
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--only')
    args = p.parse_args()
    sites = yaml.safe_load((PIPELINE/'config/sites.yaml').read_text(encoding='utf-8'))['sites']
    ids = {s['id'] for s in sites}
    selected = set(args.only.split(',')) if args.only else ids
    if selected-ids:
        p.error(f'unknown sites: {selected-ids}')
    for s in sites:
        if s['id'] in selected:
            export_site(s)
    files = [p for sid in selected for p in OUTPUT.glob(f'{sid}.*')]
    print(f'{len(selected)} sites; {len(files)} files; {sum(p.stat().st_size for p in files):,} bytes')

if __name__ == '__main__':
    main()
