import { afterEach, expect, it, vi } from 'vitest';
import { loadBasemap, loadSite, loadSites, loadValidation } from '../data';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('loads under BASE_URL and the configured data directory, caching site requests', async () => {
  vi.stubEnv('BASE_URL', '/navigator/');
  vi.stubEnv('VITE_DATA_DIR', 'datasets');
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const first = loadSite('cache-test');
  expect(loadSite('cache-test')).toBe(first);
  await first;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith('/navigator/datasets/sites/cache-test.json');
  fetcher.mockImplementation(async () => new Response('{}'));
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
