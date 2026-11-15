import { afterEach, expect, it, vi } from 'vitest';
import fixtureText from '../../../../pipeline/tests/fixtures/metrics_case.json?raw';
import { checkSiteData, loadBasemap, loadSite, loadSites, loadValidation } from '../data';

const site = JSON.parse(fixtureText).site;
const siteJson = (id: string) => JSON.stringify({ ...site, id });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('loads under BASE_URL and the configured data directory, caching site requests', async () => {
  vi.stubEnv('BASE_URL', '/navigator/');
  vi.stubEnv('VITE_DATA_DIR', 'datasets');
  const fetcher = vi.fn().mockResolvedValue(new Response(siteJson('cache-test')));
  vi.stubGlobal('fetch', fetcher);
  const first = loadSite('cache-test');
  expect(loadSite('cache-test')).toBe(first);
  await first;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/navigator/datasets/sites/cache-test.json');
  fetcher.mockImplementation(async () => new Response('[]'));
  await loadSites();
  await loadBasemap();
  expect(fetcher).toHaveBeenCalledWith('/navigator/datasets/sites.json');
  expect(fetcher).toHaveBeenCalledWith('/navigator/datasets/basemap.json');
});

it('treats a missing or malformed validation file as unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  expect(await loadValidation()).toBeNull();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
  expect(await loadValidation()).toBeNull();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
  await expect(loadValidation()).rejects.toThrow('500');
});

it('rejects site files that break the contract with a readable message', async () => {
  expect(checkSiteData({ ...site, id: 'ok' }, 'ok').id).toBe('ok');
  expect(() => checkSiteData({ ...site, id: 'other' }, 'ok')).toThrow('Invalid data for ok: id is "other"');
  const short = { ...site, id: 'ok', ephem: { ...site.ephem, sun: { ...site.ephem.sun, el_cdeg: [1] } } };
  expect(() => checkSiteData(short, 'ok')).toThrow('ephem sun.el_cdeg');
  const noMask = { ...site, id: 'ok', horizon: { ...site.horizon, elev_cdeg: {} } };
  expect(() => checkSiteData(noMask, 'ok')).toThrow('no heights');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(loadSite('broken')).rejects.toThrow('Invalid data for broken');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  await expect(loadSites()).rejects.toThrow('Invalid sites.json');
});

import { illumAt, loadIllum } from '../illum';
it('decodes an illumination map and samples it bilinearly', async () => {
  const g = 4, meta = { id: 's', grid: g, cell_m: 10, half_m: 20, window: '2027', observer_height_m: 2,
    light: { file: 's.bin', offset: 0, dtype: 'uint8', scale_pct: 0.5 }, earth: { file: 's.bin', offset: g * g, dtype: 'uint8', scale_pct: 0.5 },
    earth_margin_deg: 0.5, source: 'test' };
  const bytes = new Uint8Array(2 * g * g); bytes.fill(200, 0, g * g); bytes[0] = 0; bytes.fill(100, g * g);
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (String(u).endsWith('.json') ? new Response(JSON.stringify(meta)) : new Response(bytes))));
  const m = (await loadIllum('s'))!;
  expect(m.light[0]).toBe(0);
  expect(m.light[5]).toBe(1);
  expect(m.earth[3]).toBeCloseTo(0.5, 6);
  expect(illumAt(m, 'light', -15, 15)).toBeCloseTo(0, 6); // centre of the north-west cell
  expect(illumAt(m, 'light', 5, -5)).toBeCloseTo(1, 6);
  expect(illumAt(m, 'earth', 0, 0)).toBeCloseTo(0.5, 6);
  expect(illumAt(m, 'light', 100, 0)).toBeNaN();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  expect(await loadIllum('none')).toBeNull();
});
