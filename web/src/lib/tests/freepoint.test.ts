import { describe, expect, it } from 'vitest';
import { computeFreePoint, nearestCurated, pointFromMapPixel, polarXY, sampleGrid, topocentric } from '../freepoint';
import type { FreeAssets, FreeGrid, FreeMeta } from '../freepoint';
import type { Basemap, SiteData, SiteIndexEntry } from '../types';
import { computeMetrics } from '../metrics';

describe('free point geometry', () => {
  it('uses pixel affine coordinates and round trips at the pole and map edge', () => {
    const map: Basemap = { image: '', width_px: 2048, height_px: 2048, crs: '', affine: [195.3125, 0, -200000, 0, -195.3125, 200000], extent_lat_deg: -83.412 };
    expect(pointFromMapPixel(map, 1024, 1024).lat).toBe(-90);
    const p = pointFromMapPixel(map, 1800, 100);
    const xy = polarXY(p.lat, p.lon);
    expect(xy[0]).toBeCloseTo(1800 * 195.3125 - 200000, 6);
    expect(xy[1]).toBeCloseTo(200000 - 100 * 195.3125, 6);
    expect(() => pointFromMapPixel(map, -1, 0)).toThrow();
  });
  it('interpolates metres and refuses missing terrain', () => {
    const g: FreeGrid = { file: '', n: 2, left: 0, top: 2, res_m: 1, scale_m: 1, nodata: -32768 };
    expect(sampleGrid(g, new Int16Array([0, 2, 4, 6]), 1, 1)).toBe(3);
    expect(sampleGrid(g, new Int16Array([0, 2, 4, -32768]), 1, 1)).toBeNaN();
    expect(sampleGrid(g, new Int16Array(4), -1, 1)).toBeNaN();
  });
  it('includes Earth parallax and wraps north', () => {
    const e = topocentric(new Float32Array([1e8, 0, 0, 384400, 0, 0]), { n: 1, step_h: 1, t0_utc: '2027-01-01T00:00:00Z' }, -90, 0, 0);
    expect(e.earth.az_cdeg[0]).toBe(0);
    expect(e.earth.el_cdeg[0]).toBe(-26);
    expect(e.sun.el_cdeg[0]).toBe(0);
  });
  it('finds nearest sites across the longitude seam', () => {
    const sites = [{ id: 'near', lat_deg: -85, lon_deg: 179 }, { id: 'far', lat_deg: -85, lon_deg: 0 }] as SiteIndexEntry[];
    expect(nearestCurated(-85, -179, sites)?.id).toBe('near');
  });
  it('matches the analytic spherical horizon and observer-height ordering', () => {
    const g: FreeGrid = { file: '', n: 12, left: -6000, top: 6000, res_m: 1000, scale_m: 1, nodata: -32768 };
    const meta = { generated_utc: '', n: 1, t0_utc: '2027-01-01T00:00:00Z', step_h: 1,
      grids: [g], bounds_m: [-1000, -1000, 1000, 1000], heights_m: [1, 2, 5, 10], az_step_deg: 90, max_dist_m: 3000 } as FreeMeta;
    const assets = { meta, grids: [new Int16Array(144)], vectors: new Float32Array([1e8, 0, 0, 384400, 0, 0]), accuracy: null };
    const result = computeFreePoint(assets, -90, 0);
    let best = -90;
    for (const d of [1000, 2000, 3000]) best = Math.max(best, Math.atan2(1737400 * Math.cos(d / 1737400) - 1737402, 1737400 * Math.sin(d / 1737400)) * 180 / Math.PI);
    expect(result.site.horizon.elev_cdeg['2']).toEqual(new Array(4).fill(Math.round(best * 100)));
    expect(result.site.horizon.elev_cdeg['10'][0]).toBeLessThanOrEqual(result.site.horizon.elev_cdeg['1'][0]);
    expect(() => computeFreePoint(assets, -80, 0)).toThrow();
    assets.grids[0].fill(-32768);
    expect(() => computeFreePoint(assets, -90, 0)).toThrow('Terrain coverage incomplete');
  });
});

// Dynamic built-in import avoids adding @types/node to the application dependencies.
const fsModule = 'node:fs';
const fs = await import(/* @vite-ignore */ fsModule) as {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, text: string): void;
};
const root = 'public/data/';
const json = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(fs.readFileSync(root + path))) as T;
const hasAssets = fs.existsSync(root + 'free/meta.json');

it.skipIf(!hasAssets)('measures the browser algorithm against all published sites', () => {
  const meta = json<FreeMeta>('free/meta.json');
  const buffer = (path: string) => Uint8Array.from(fs.readFileSync(root + 'free/' + path)).buffer;
  const assets: FreeAssets = { meta, vectors: new Float32Array(buffer(meta.vectors_file)),
    grids: meta.grids.map(g => new Int16Array(buffer(g.file))), accuracy: null };
  // Every corner and edge midpoint must support complete 200 km rays.
  for (const [x, y] of [[-200000, -200000], [-200000, 200000], [200000, -200000], [200000, 200000], [0, 200000], [0, -200000], [200000, 0], [-200000, 0]]) {
    const lat = -90 + 2 * Math.atan(Math.hypot(x, y) / (2 * 1737400)) * 180 / Math.PI;
    const lon = Math.atan2(x, y) * 180 / Math.PI;
    expect(computeFreePoint(assets, lat, lon).site.horizon.max_dist_m).toBe(200000);
  }
  const sites = json<SiteIndexEntry[]>('sites.json');
  const rows = [];
  let ephemMax = 0, maskMax = 0, maskSum = 0, maskCount = 0;
  for (const entry of sites) {
    const reference = json<SiteData>(`sites/${entry.id}.json`);
    const angles = topocentric(assets.vectors, meta, entry.lat_deg, entry.lon_deg, entry.elev_m);
    expect([meta.t0_utc, meta.n, meta.step_h]).toEqual([reference.ephem.t0_utc, reference.ephem.n, reference.ephem.step_h]);
    for (const body of ['sun', 'earth'] as const) for (let i = 0; i < meta.n; i++) {
      const da = Math.abs(((angles[body].az_cdeg[i] - reference.ephem[body].az_cdeg[i] + 54000) % 36000) - 18000) / 100;
      const de = Math.abs(angles[body].el_cdeg[i] - reference.ephem[body].el_cdeg[i]) / 100;
      ephemMax = Math.max(ephemMax, da, de);
    }
    const result = computeFreePoint(assets, entry.lat_deg, entry.lon_deg);
    const errors = result.site.horizon.elev_cdeg['2'].map((v, i) => Math.abs(v - reference.horizon.elev_cdeg['2'][i]) / 100);
    const max = Math.max(...errors), sum = errors.reduce((a, b) => a + b, 0);
    maskMax = Math.max(maskMax, max); maskSum += sum; maskCount += errors.length;
    const actual = computeMetrics(result.site, '2027-01-01T00:00:00Z', 8760);
    const expected = computeMetrics(reference, '2027-01-01T00:00:00Z', 8760);
    rows.push({ id: entry.id, mask_mean_deg: sum / errors.length, mask_max_deg: max,
      sunlight_pct: actual.lightPct, published_sunlight_pct: expected.lightPct,
      sunlight_delta_pp: actual.lightPct - expected.lightPct, runtime_ms: result.elapsedMs });
  }
  expect(sites.length).toBeGreaterThanOrEqual(15);
  expect(ephemMax).toBeLessThanOrEqual(0.01);
  const report = { sites: sites.length, mask_max_deg: maskMax, mask_mean_deg: maskSum / maskCount,
    sunlight_max_pp: Math.max(...rows.map(r => Math.abs(r.sunlight_delta_pp))),
    sunlight_mean_pp: rows.reduce((s, r) => s + Math.abs(r.sunlight_delta_pp), 0) / rows.length,
    ephem_max_deg: ephemMax, runtime_max_ms: Math.max(...rows.map(r => r.runtime_ms)),
    generated_utc: meta.generated_utc, measurement: 'Node running the browser algorithm; not phone timing', rows };
  console.log('Free-point accuracy:', JSON.stringify(report));
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
  if (env.FREEPOINT_MEASURE === '1') fs.writeFileSync(root + 'free/accuracy.json', JSON.stringify(report, null, 2));
}, 60000);
