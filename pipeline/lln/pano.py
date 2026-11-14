"""Real LOLA immersive panoramas. Run from pipeline: python -m lln.pano."""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import time

import numpy as np
from numba import njit
from . import dem
from . import horizon

WIDTH, HEIGHT = 1536, 400  # 15 * 2048 * 400 * 4 exceeds the 40 MB budget.
TOP, BOTTOM = 15.0, -20.0
DATA = Path(__file__).resolve().parents[2] / 'web/public/data'


@njit(cache=True)
def _sample(z, left, top, res, u, R):
    k = 2 * R / (1 - u[2])
    c, r = (k * u[1] - left) / res - .5, (top - k * u[0]) / res - .5
    return horizon._bilinear(z, c, r)


@njit(cache=True)
def _point(s, u0, direction, R):
    return math.cos(s / R) * u0 + math.sin(s / R) * direction


@njit(cache=True)
def _angle(s, z, left, top, res, u0, direction, R, robs):
    u = _point(s, u0, direction, R)
    rt = R + _sample(z, left, top, res, u, R)
    return math.atan2(rt * math.cos(s / R) - robs, rt * math.sin(s / R))


@njit(cache=True)
def _normal(z, left, top, res, u, R, east, north, up):
    k = 2 * R / (1 - u[2])
    c, r = (k * u[1] - left) / res - .5, (top - k * u[0]) / res - .5
    ci, ri = int(math.floor(c)), int(math.floor(r))
    fc, fr = c-ci, r-ri
    gx = ((z[ri,ci+1]-z[ri,ci])*(1-fr) + (z[ri+1,ci+1]-z[ri+1,ci])*fr)/res
    gy = -((z[ri+1,ci]-z[ri,ci])*(1-fc) + (z[ri+1,ci+1]-z[ri,ci+1])*fc)/res
    rt = R + horizon._bilinear(z, c, r)
    # Differential of south-polar stereographic coordinates, projected onto sphere.
    g = np.array([gy*k, gx*k, (gx*u[1]+gy*u[0])*k/(1-u[2])])
    g = (g - np.dot(g,u)*u) / rt
    n = u - g
    n = np.array([np.dot(n,east), np.dot(n,north), np.dot(n,up)])
    n /= np.abs(n).sum()
    if n[2] < 0:
        x, y = n[0], n[1]
        n[0] = (1-abs(y)) * (1 if x >= 0 else -1)
        n[1] = (1-abs(x)) * (1 if y >= 0 else -1)
    return np.uint8(round((n[0]*.5+.5)*255)), np.uint8(round((n[1]*.5+.5)*255))


@njit(cache=True)
def march_scale(z, left, top, res, lat, lon, robs, starts, dmax, distances,
                normals, R=dem.R_MOON_M, el_top=TOP, el_bottom=BOTTOM):
    """One great-circle march per column; fill rows at their first profile crossing.

    Distances are Euclidean observer-to-hit ranges, not surface arc distances.
    Starts/reach implement horizon.py's per-column multiscale nodata fallback.
    """
    height, width = distances.shape
    up = np.array([math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat)])
    east = np.array([-math.sin(lon), math.cos(lon), 0.])
    north = np.array([-math.sin(lat)*math.cos(lon), -math.sin(lat)*math.sin(lon), math.cos(lat)])
    reach = starts.copy()
    for c in range(width):
        az = (c+.5)*2*math.pi/width
        direction = math.cos(az)*north + math.sin(az)*east
        row = height-1
        while row >= 0 and distances[row,c] > 0:
            row -= 1
        s = starts[c]
        previous = s
        first = True
        while s <= dmax:
            angle = _angle(s,z,left,top,res,up,direction,R,robs)
            if not math.isfinite(angle):
                break
            while row >= 0:
                target = math.radians(el_top-(row+.5)*(el_top-el_bottom)/height)
                if angle < target:
                    break
                lo, hi = previous, s
                if first:
                    lo = max(.0001, s - res)
                # Refine in the same DEM; no interpolation across scale seams.
                alo = _angle(lo,z,left,top,res,up,direction,R,robs)
                if math.isfinite(alo) and alo < target:
                    for _ in range(22):
                        mid = (lo+hi)*.5
                        if _angle(mid,z,left,top,res,up,direction,R,robs) >= target:
                            hi = mid
                        else:
                            lo = mid
                hit = hi
                u = _point(hit,up,direction,R)
                rt = R + _sample(z,left,top,res,u,R)
                horizontal = rt*math.sin(hit/R)
                vertical = rt*math.cos(hit/R)-robs
                distances[row,c] = math.hypot(horizontal,vertical)
                a,b = _normal(z,left,top,res,u,R,east,north,up)
                normals[row,c,0], normals[row,c,1] = a,b
                row -= 1
                while row >= 0 and distances[row,c] > 0:
                    row -= 1
            previous = s
            reach[c] = s
            first = False
            if s == dmax:
                reach[c] = dmax
                break
            s = min(dmax, s + min(res, max(.25, s*.02)))
    return reach


def boundary_report(distances, site):
    """Report raw agreement and agreement restricted to the image's elevation range.

    All-terrain/all-sky columns only constrain the horizon to an interval. Keep
    the raw comparison too: clipping must not hide an unmet full-mask criterion.
    """
    h,w = distances.shape
    hit = distances > 0
    first = np.argmax(hit, axis=0)
    boundary = TOP-first*(TOP-BOTTOM)/h
    boundary[~hit.any(axis=0)] = BOTTOM
    mask = np.asarray(site['horizon']['elev_cdeg']['2'])/100
    step = site['horizon']['az_step_deg']
    expected = np.interp((np.arange(w)+.5)*360/w,
                         np.arange(len(mask)+1)*step, np.r_[mask,mask[0]])
    clipped = (expected > TOP) | (expected < BOTTOM)
    error = np.abs(boundary-np.clip(expected, BOTTOM, TOP))
    return {'clipped_columns': int(clipped.sum()),
            'unclipped_within_0_2_deg_pct': float(np.mean(np.abs(boundary-expected) <= .2)*100), 'within_0_2_deg_pct': float(np.mean(error <= .2)*100),
            'max_error_deg': float(error.max()), 'p99_error_deg': float(np.quantile(error,.99))}


def render_site(site, sources=None, width=WIDTH, height=HEIGHT, log=print):
    sources = {} if sources is None else sources
    def source(key):
        if key not in sources:
            sources[key] = dem.DemSource(key)
        return sources[key]
    lat,lon = site['lat_deg'],site['lon_deg']
    x,y = dem.latlon_to_xy(lat,lon)
    near = None
    for key in horizon.NEAR_KEYS:
        src = source(key)
        if src.contains_xy(x,y,horizon.NEAR_DMAX+2*src.res):
            win = src.read_window(x,y,horizon.NEAR_DMAX+4*src.res)
            if math.isfinite(win.sample(x,y)):
                near = src,win
                break
    if near is None:
        raise RuntimeError(f"No DEM covers {site['id']}")
    src,win = near
    robs = dem.R_MOON_M + win.sample(x,y) + 2
    plan = [(src.key,horizon.NEAR_DMAX)]
    if src.key != horizon.MID[0]:
        plan.append(horizon.MID)
    else:
        plan = [horizon.MID]
    plan.append(horizon.FAR)
    distances = np.zeros((height,width),np.float64)
    normals = np.zeros((height,width,2),np.uint8)
    reach = np.full(width,.001)
    for i,(key,dmax) in enumerate(plan):
        src = source(key)
        if i or dmax != horizon.NEAR_DMAX:
            win = src.read_window(x,y,dmax+4*src.res)
        log(f"  {key} to {dmax/1000:g} km")
        reach = np.maximum(reach,march_scale(np.ascontiguousarray(win.z),win.left,win.top,win.res,
                            math.radians(lat),math.radians(lon),robs,reach,dmax,distances,normals))
        del win
    if reach.min() < horizon.FAR[1]:
        raise RuntimeError(f"Incomplete DEM coverage: {reach.min():.1f} m")
    return distances,normals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='+', help='Site IDs (space or comma separated)')
    args = parser.parse_args()
    sites = json.loads((DATA/'sites.json').read_text())
    if args.only:
        ids = {v for item in args.only for v in item.split(',')}
        unknown = ids - {s['id'] for s in sites}
        if unknown:
            parser.error(f'Unknown sites: {sorted(unknown)}')
        sites = [s for s in sites if s['id'] in ids]
    out = DATA/'pano'
    out.mkdir(exist_ok=True)
    sources = {}
    total = time.perf_counter()
    for site in sites:
        start = time.perf_counter()
        sid = site['id']
        print(sid,flush=True)
        distances,normals = render_site(site,sources)
        encoded = np.where(distances>0,np.maximum(1,np.rint(distances/4)),0)
        if encoded.max() > 65535:
            raise ValueError('Hit range exceeds uint16 representation')
        encoded.astype('<u2').tofile(out/f'{sid}.dist.bin')
        normals.tofile(out/f'{sid}.normal.bin')
        report = boundary_report(distances,json.loads((DATA/'sites'/f'{sid}.json').read_text()))
        metadata = {'id':sid,'observer_height_m':2,'width':WIDTH,'height':HEIGHT,
                    'az0_deg':0,'el_top_deg':TOP,'el_bottom_deg':BOTTOM,
                    'dist':{'file':f'{sid}.dist.bin','dtype':'uint16','unit_m':4,'sky':0},
                    'normal':{'file':f'{sid}.normal.bin','dtype':'uint8x2','encoding':'octahedral, local ENU'},
                    'max_dist_m':200000,'validation':report,'runtime_s':round(time.perf_counter()-start,3)}
        (out/f'{sid}.json').write_text(json.dumps(metadata,indent=2)+'\n')
        print(f"  {metadata['runtime_s']:.2f}s; {report}",flush=True)
    size = sum(p.stat().st_size for p in out.iterdir() if p.is_file())
    print(f'Total: {time.perf_counter()-total:.2f}s, {size} bytes',flush=True)


if __name__ == '__main__':
    main()
