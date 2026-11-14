"""PGDA 78 full-surface clone illumination; see docs/uncertainty.md for limitations.

Run from repository root: python -m pipeline.lln.uncertainty --clones 30
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import sys
import time
import warnings

import numpy as np
import requests
import rasterio
from rasterio.io import MemoryFile

# Numba's disk cache may refer to the canonical `lln` module name even when the
# root-level CLI was invoked as `pipeline.lln.uncertainty`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from . import dem, ephem, horizon, metrics

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/intermediate/uncertainty'
RAW = ROOT / 'data/raw/pgda78'
PRODUCT = 'https://pgda.gsfc.nasa.gov/products/78'


def session():
    s = requests.Session()
    s.trust_env = False
    return s


def get_range(url, first, last, http=None):
    """Single range only; reject ignored ranges and truncated responses."""
    for attempt in range(4):
        try:
            if http is None:
                with session() as s:
                    return get_range(url, first, last, s)
            else:
                # stream=True: check the status before reading, so a server that ignores
                # Range (200 + whole multi-GB file) is never pulled into memory
                with http.get(url, headers={'Range': f'bytes={first}-{last}'}, timeout=(15, 45),
                              stream=True) as r:
                    r.raise_for_status()
                    if r.status_code != 206:
                        raise ValueError(f'Range ignored: {url}')
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', r.headers.get('Content-Range', ''))
                    if not match or int(match[1]) != first:
                        raise ValueError('Invalid Content-Range')
                    total = int(match[3])
                    end = min(last, total - 1)
                    content = r.content
                    if int(match[2]) != end or len(content) != end - first + 1:
                        raise ValueError('Incomplete range')
                    return content, total
        except (requests.RequestException, ValueError):
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def download(url):
    """Cache complete TIFFs, assembled from checked single-range requests."""
    relative = url.split('/LOLA_5mpp/')[1]
    path = RAW / relative
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.part')
    with session() as http:
        head, total = get_range(url, 0, 65535, http)
        resume = False
        if temporary.exists() and len(head) <= temporary.stat().st_size <= total:
            with temporary.open('rb') as f:
                resume = f.read(len(head)) == head
        with temporary.open('ab' if resume else 'wb') as f:
            if not resume:
                f.write(head)
            start = temporary.stat().st_size if resume else len(head)
            while start < total:
                block, size = get_range(url, start, min(start + 1024**2 - 1, total - 1), http)
                if size != total:
                    raise ValueError('Remote file changed')
                f.write(block)
                start += len(block)
    with rasterio.open(temporary) as ds:
        if ds.count != 1 or ds.res != (5.0, 5.0):
            raise ValueError('Unexpected PGDA raster')
    temporary.replace(path)
    return path


def coverage():
    """Measure every advertised surface extent, without downloading raster pixels."""
    with session() as s:
        response = s.get(PRODUCT, timeout=30)
        response.raise_for_status()
    urls = list(dict.fromkeys(re.findall(r'href=[\"\']?(https://[^\s>\"\']+_surf.tif)', response.text)))
    if not urls:
        raise ValueError('No PGDA surfaces found')

    def header(url):
        data, _ = get_range(url, 0, 65535)
        with MemoryFile(data) as mem:
            with mem.open() as ds:
                return dict(url=url, bounds_m=list(ds.bounds), crs_wkt=ds.crs.to_wkt(), shape=list(ds.shape))

    with ThreadPoolExecutor(6) as pool:
        records = list(pool.map(header, urls))
    sites = ephem.load_sites(ROOT / 'config/sites.yaml')
    results = []
    for site in sites:
        x, y = dem.latlon_to_xy(site['lat_deg'], site['lon_deg'])
        matches = []
        for record in records:
            left, bottom, right, top = record['bounds_m']
            matches.append(dict(dem=record['url'].split('/')[-2],
                                margin_m=round(min(x-left, right-x, y-bottom, top-y), 2)))
        best = max(matches, key=lambda v: v['margin_m'])
        results.append(dict(id=site['id'], x_m=x, y_m=y, best=best, covered=best['margin_m'] >= 3000))
    OUT.mkdir(parents=True, exist_ok=True)
    result = dict(dems=records, sites=results)
    (OUT / 'coverage.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


def clone_surface(base, clone):
    """The *_err.tif files are full surfaces in metres, NOT additive errors."""
    base, clone = np.asarray(base), np.asarray(clone)
    if base.shape != clone.shape:
        raise ValueError('Clone grid differs from base')
    return np.where(np.isfinite(base) & np.isfinite(clone), clone, np.nan)


def percentiles(values):
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or not values.size or not np.all(np.isfinite(values)):
        raise ValueError('Expected nonempty finite clone percentages')
    if np.any((values < 0) | (values > 100)):
        raise ValueError('Percentages outside [0, 100]')
    p = np.percentile(values, [5, 50, 95], method='linear')
    return dict(zip(('illum_pct_p5', 'illum_pct_p50', 'illum_pct_p95'), map(float, p)))


def combine_masks(full, clone_near):
    """Per-azimuth maximum of the retained far mask and a clone near mask."""
    full, clone_near = np.asarray(full), np.asarray(clone_near)
    if full.shape != clone_near.shape or not np.all(np.isfinite(full)) or not np.all(np.isfinite(clone_near)):
        raise ValueError('Invalid horizon masks')
    return np.maximum(full, clone_near)


class CachedDem(dem.DemSource):
    """Read original mosaic tiles without ever modifying another agent's cache."""

    def index(self):
        if self._idx is None:
            self._idx = dem.TiffIndex.load(self.cache_dir / 'index.npz')
        return self._idx

    def _fetch_blocks(self, br, bc0, bc1):
        raise FileNotFoundError(f'Original horizon cache incomplete: {self.key} row {br}, columns {bc0}:{bc1}')


def retained_far(site, full, near_reach):
    """Identify the far contribution to an existing max-only full mask by re-raycasting
    its original cached scales beyond the clone footprint. No DEM download/writes.
    A maximum cannot be inverted algebraically; the original pixels disambiguate it.
    """
    x, y = dem.latlon_to_xy(site['lat_deg'], site['lon_deg'])
    starts = np.asarray(near_reach, dtype=float).copy()
    mask = np.full(starts.shape, -90.)
    for scale in full['scales']:
        source = CachedDem(scale['source'])
        limit = scale['d_max_m']
        if np.all(starts > limit):
            continue
        win = source.read_window(x, y, limit + 4 * source.res)
        part, reach = horizon.scale_mask(win, site['lat_deg'], site['lon_deg'],
                                        dem.R_MOON_M + full['elev_m'] + 2,
                                        starts, limit, full['az_step_deg'])
        mask = np.maximum(mask, part)
        starts = np.maximum(starts, reach)
    if np.min(starts) < full['max_dist_m']:
        raise ValueError('Reconstructed far field has incomplete reach')
    original = np.asarray(full['elev_cdeg']['2']) / 100
    # Both the original and recomputed mask are quantized to the shared contract.
    excess = np.rint(mask * 100) / 100 - original
    if np.max(excess) > .021:
        raise ValueError(f'Cached far terrain disagrees with original mask by {np.max(excess):.3f} deg')
    return np.minimum(original, np.rint(mask * 100) / 100)


def read_window(path, site):
    x, y = dem.latlon_to_xy(site['lat_deg'], site['lon_deg'])
    with rasterio.open(path) as ds:
        from pyproj import CRS
        crs = CRS.from_wkt(ds.crs.to_wkt())
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore', message='You will likely lose important projection information')
            params = crs.to_dict()
        if (params.get('proj') != 'stere' or params.get('lat_0') != -90
                or params.get('lon_0') != 0 or params.get('units') != 'm'
                or params.get('k', params.get('k_0', 1)) != 1
                or params.get('lat_ts', -90) != -90
                or params.get('x_0', 0) != 0 or params.get('y_0', 0) != 0
                or abs(crs.ellipsoid.semi_major_metre - dem.R_MOON_M) > 1e-6
                or crs.ellipsoid.inverse_flattening != 0):
            raise ValueError('Unexpected lunar CRS')
        # Allow stereographic map scale (>1 off the pole) and bilinear edge posts.
        window = rasterio.windows.from_bounds(x-7600, y-7600, x+7600, y+7600, ds.transform)
        window = window.round_offsets().round_lengths().intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))
        transform = ds.window_transform(window)
        z = ds.read(1, window=window, masked=True).filled(np.nan)
    return dem.DemWindow(z, transform.c, transform.f, transform.a, str(path))


def run_site(site, record, n_clones, workers):
    sid = site['id']
    url = record['url']
    prefix = url.removesuffix('_surf.tif')
    folder, name = prefix.rsplit('/', 1)
    base = read_window(download(url), site)
    x, y = dem.latlon_to_xy(site['lat_deg'], site['lon_deg'])
    full = json.loads((ROOT / f'data/intermediate/horizon/{sid}.json').read_text())
    az_step = full['az_step_deg']
    starts = np.full(round(360 / az_step), base.res)

    def near(win):
        z = win.sample(x, y)
        if not np.isfinite(z):
            raise ValueError('Nodata at observer')
        return horizon.scale_mask(win, site['lat_deg'], site['lon_deg'], dem.R_MOON_M + z + 2,
                                  starts, 7500, az_step)

    base_mask, base_reach = near(base)
    e = ephem.site_ephem(site['lat_deg'], site['lon_deg'], full['elev_m'],
                         t0_utc='2027-01-01T00:00:00Z', n_hours=8760)
    original = np.asarray(full['elev_cdeg']['2']) / 100
    far = retained_far(site, full, base_reach)

    def light(mask):
        data = dict(ephem=e, horizon=dict(az_step_deg=az_step, elev_cdeg={'2': np.rint(mask * 100).astype(int).tolist()}))
        return metrics.compute_metrics(data, '2027-01-01T00:00:00Z', 8760)['lightPct']

    # Download concurrently; evaluate sequentially to keep large arrays out of memory.
    urls = [f'{folder}/Clones/{name}_{k:04d}_err.tif' for k in range(1, n_clones + 1)]
    values = []
    with ThreadPoolExecutor(workers) as pool:
        for k, path in enumerate(pool.map(download, urls), 1):
            win = read_window(path, site)
            if (win.left, win.top, win.res) != (base.left, base.top, base.res):
                raise ValueError('Clone transform differs')
            win.z = clone_surface(base.z, win.z)
            mask, reach = near(win)
            if not np.array_equal(reach, base_reach):
                raise ValueError('Clone footprint differs from the base; far mask must be recomputed')
            values.append(light(combine_masks(far, mask)))
            (OUT / f'{sid}.progress.json').write_text(json.dumps(
                dict(id=sid, n_requested=n_clones, n_completed=len(values),
                     clone_light_pct=values, status='complete' if len(values) == n_clones else 'running'),
                indent=2) + '\n', encoding='utf-8')
            print(f'{sid}: clone {k}/{n_clones}: {values[-1]:.6f}%', flush=True)
    source = f'PGDA 78 {record["url"].split("/")[-2]}; full-surface clones 0001-{n_clones:04d}; original far contribution identified from cached horizon scales'
    output = dict(**percentiles(values), n_clones=n_clones, window='2027', source=source)
    (OUT / f'{sid}.json').write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    diagnostic = dict(id=sid, clone_light_pct=values, original_light_pct=light(original),
                      base_combined_light_pct=light(combine_masks(far, base_mask)),
                      base_near_deg=base_mask.tolist(), base_reach_m=base_reach.tolist(),
                      far_deg=far.tolist(), max_base_minus_full_deg=float(np.max(base_mask-original)),
                      method='max(retained_far, clone_near)')
    (OUT / f'{sid}.diagnostics.json').write_text(json.dumps(diagnostic, indent=2) + '\n', encoding='utf-8')
    return output


def update_report(survey):
    """Keep the owned handoff document current during a long resumable batch."""
    path = ROOT.parent / 'docs/uncertainty.md'
    marker = '<!-- UNCERTAINTY RESULTS -->'
    body = path.read_text(encoding='utf-8').split(marker)[0].rstrip()
    rows = [marker, '', '## Measured results', '',
            'This table updates after each completed site. Pending means no complete ensemble output yet.', '',
            '| Site | DEM | Clones | p5 (%) | p50 (%) | p95 (%) |',
            '| --- | --- | ---: | ---: | ---: | ---: |']
    for point in survey['sites']:
        sid = point['id']
        if not point['covered']:
            rows.append(f'| {sid} | Not covered | — | — | — | — |')
            continue
        p = OUT / f'{sid}.json'
        if p.exists():
            result = json.loads(p.read_text(encoding='utf-8'))
            rows.append(f'| {sid} | {point["best"]["dem"]} | {result["n_clones"]} | '
                        f'{result["illum_pct_p5"]:.4f} | {result["illum_pct_p50"]:.4f} | '
                        f'{result["illum_pct_p95"]:.4f} |')
        else:
            rows.append(f'| {sid} | {point["best"]["dem"]} | Pending | — | — | — |')
    path.write_text(body + '\n\n' + '\n'.join(rows) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clones', type=int, default=30, choices=(30, 100))
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--coverage-only', action='store_true')
    parser.add_argument('--site', action='append', help='Restrict to site IDs')
    args = parser.parse_args()
    if args.workers < 1:
        parser.error('--workers must be positive')
    survey = coverage()
    update_report(survey)
    if args.coverage_only:
        return
    by_id = {s['id']: s for s in ephem.load_sites(ROOT / 'config/sites.yaml')}
    for point in survey['sites']:
        if point['covered'] and (not args.site or point['id'] in args.site):
            record = next(d for d in survey['dems'] if d['url'].split('/')[-2] == point['best']['dem'])
            print(f'Starting {point["id"]}', flush=True)
            try:
                run_site(by_id[point['id']], record, args.clones, args.workers)
            except Exception as exc:
                (OUT / f'{point["id"]}.error.json').write_text(json.dumps(
                    dict(id=point['id'], status='failed', error_type=type(exc).__name__, error=str(exc)),
                    indent=2) + '\n', encoding='utf-8')
                raise
            update_report(survey)


if __name__ == '__main__':
    main()
