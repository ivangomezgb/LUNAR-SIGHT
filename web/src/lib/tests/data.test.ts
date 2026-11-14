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
