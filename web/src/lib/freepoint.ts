import type { Basemap, SiteData, SiteIndexEntry } from './types';

export const MOON_RADIUS_M = 1737400;
const RAD = Math.PI / 180;
export interface FreeGrid { file: string; n: number; left: number; top: number; res_m: number; scale_m: number; nodata: number }
export interface FreeMeta {
  version: number; generated_utc: string; frame: 'MOON_ME'; radius_m: number;
  t0_utc: string; step_h: number; n: number; vectors_file: string;
  grids: FreeGrid[]; az_step_deg: number; max_dist_m: number; heights_m: number[];
  bounds_m: [number, number, number, number]; payload_bytes: number;
}
export interface FreeAccuracy {
  generated_utc: string;
  sites: number; mask_max_deg: number; mask_mean_deg: number;
  sunlight_max_pp: number; sunlight_mean_pp: number; ephem_max_deg: number;
  runtime_max_ms: number;
}
export interface FreeAssets { meta: FreeMeta; grids: Int16Array[]; vectors: Float32Array; accuracy: FreeAccuracy | null }
export interface FreeResult { site: SiteData; elevationM: number; accuracy: FreeAccuracy | null; elapsedMs: number }

export function polarXY(lat: number, lon: number): [number, number] {
  const rho = 2 * MOON_RADIUS_M * Math.tan((90 + lat) * RAD / 2);
  return [rho * Math.sin(lon * RAD), rho * Math.cos(lon * RAD)];
}
export function pointFromMapPixel(map: Basemap, px: number, py: number): { lat: number; lon: number } {
  if (!Number.isFinite(px + py) || px < 0 || py < 0 || px > map.width_px || py > map.height_px) throw new Error('Point outside basemap');
  const [a, b, c, d, e, f] = map.affine;
  const x = a * px + b * py + c, y = d * px + e * py + f;
  return { lat: -90 + 2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M)) / RAD, lon: Math.atan2(x, y) / RAD };
}
export function nearestCurated(lat: number, lon: number, sites: SiteIndexEntry[]): SiteIndexEntry | undefined {
  const dot = (s: SiteIndexEntry) => Math.sin(lat * RAD) * Math.sin(s.lat_deg * RAD)
    + Math.cos(lat * RAD) * Math.cos(s.lat_deg * RAD) * Math.cos((lon - s.lon_deg) * RAD);
  return sites.reduce<SiteIndexEntry | undefined>((best, s) => !best || dot(s) > dot(best) ? s : best, undefined);
}
export function sampleGrid(g: FreeGrid, z: Int16Array, x: number, y: number): number {
  const c = (x - g.left) / g.res_m - 0.5, r = (g.top - y) / g.res_m - 0.5;
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0;
  if (c0 < 0 || r0 < 0 || c0 + 1 >= g.n || r0 + 1 >= g.n) return NaN;
  const i = r0 * g.n + c0, q = [z[i], z[i + 1], z[i + g.n], z[i + g.n + 1]];
  if (q.some(v => v === g.nodata || v === undefined)) return NaN;
  return (q[0] * (1 - fc) * (1 - fr) + q[1] * fc * (1 - fr) + q[2] * (1 - fc) * fr + q[3] * fc * fr) * g.scale_m;
}
function basis(lat: number, lon: number) {
  const sl = Math.sin(lat * RAD), cl = Math.cos(lat * RAD), so = Math.sin(lon * RAD), co = Math.cos(lon * RAD);
  return { up: [cl * co, cl * so, sl], east: [-so, co, 0], north: [-sl * co, -sl * so, cl] };
}
/** Same LT+S Moon-centred approximation as ephem.py, including observer parallax. */
export function topocentric(vectors: Float32Array, meta: Pick<FreeMeta, 'n' | 't0_utc' | 'step_h'>, lat: number, lon: number, elevationM: number): SiteData['ephem'] {
  const { up, east, north } = basis(lat, lon), radius = (MOON_RADIUS_M + elevationM) / 1000;
  const result: SiteData['ephem'] = { n: meta.n, t0_utc: meta.t0_utc, step_h: meta.step_h,
    sun: { az_cdeg: [], el_cdeg: [] }, earth: { az_cdeg: [], el_cdeg: [] } };
  for (let i = 0; i < meta.n; i++) for (let b = 0; b < 2; b++) {
    const k = i * 6 + b * 3;
    const x = vectors[k] - radius * up[0], y = vectors[k + 1] - radius * up[1], z = vectors[k + 2] - radius * up[2];
    const e = x * east[0] + y * east[1], n = x * north[0] + y * north[1] + z * north[2], u = x * up[0] + y * up[1] + z * up[2];
    const body = b ? result.earth : result.sun;
    body.az_cdeg.push(((Math.round(Math.atan2(e, n) / RAD * 100) % 36000) + 36000) % 36000);
    body.el_cdeg.push(Math.round(Math.atan2(u, Math.hypot(e, n)) / RAD * 100) + 0);
  }
  return result;
}

export function computeFreePoint(assets: FreeAssets, lat: number, lon: number, progress: (fraction: number) => void = () => {}): FreeResult {
  const start = performance.now(), { meta, grids } = assets;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat >= 0 || lon < -180 || lon > 180) throw new Error('Point outside basemap');
  const [x, y] = polarXY(lat, lon), [xmin, ymin, xmax, ymax] = meta.bounds_m;
  if (x < xmin - 1e-6 || y < ymin - 1e-6 || x > xmax + 1e-6 || y > ymax + 1e-6) throw new Error('Point outside basemap');
  const elevationM = sampleGrid(meta.grids[0], grids[0], x, y);
  if (!Number.isFinite(elevationM)) throw new Error('Terrain coverage incomplete');
  const { up, east, north } = basis(lat, lon), count = Math.round(360 / meta.az_step_deg);
  const masks = meta.heights_m.map(() => new Array<number>(count));
  // All distances in metres, same great-circle projection and exact curvature as horizon.py.
  const step = meta.grids[0].res_m;
  const distances: [number, number][] = [];
  for (let d = step; d < meta.max_dist_m; d += step) distances.push([Math.cos(d / MOON_RADIUS_M), Math.sin(d / MOON_RADIUS_M)]);
  distances.push([Math.cos(meta.max_dist_m / MOON_RADIUS_M), Math.sin(meta.max_dist_m / MOON_RADIUS_M)]);
  for (let a = 0; a < count; a++) {
    const az = a * meta.az_step_deg * RAD, ca = Math.cos(az), sa = Math.sin(az);
    const dx = ca * north[0] + sa * east[0], dy = ca * north[1] + sa * east[1], dz = ca * north[2];
    const best = meta.heights_m.map(() => -Infinity);
    for (const [ct, st] of distances) {
      const ux = ct * up[0] + st * dx, uy = ct * up[1] + st * dy, uz = ct * up[2] + st * dz;
      const k = 2 * MOON_RADIUS_M / (1 - uz), tx = k * uy, ty = k * ux;
      let height = NaN;
      for (let g = 0; g < grids.length && !Number.isFinite(height); g++) height = sampleGrid(meta.grids[g], grids[g], tx, ty);
      if (!Number.isFinite(height)) throw new Error('Terrain coverage incomplete');
      const rt = MOON_RADIUS_M + height, horizontal = rt * st;
      for (let h = 0; h < best.length; h++) {
        const slope = (rt * ct - (MOON_RADIUS_M + elevationM + meta.heights_m[h])) / horizontal;
        if (slope > best[h]) best[h] = slope;
      }
    }
    for (let h = 0; h < best.length; h++) masks[h][a] = Math.round(Math.atan(best[h]) / RAD * 100);
    if (a % 24 === 0) progress(a / count);
  }
  const site: SiteData = { id: `free:${lat}:${lon}`, generated_utc: meta.generated_utc, frame: 'MOON_ME', uncertainty: null,
    horizon: { az_step_deg: meta.az_step_deg, heights_m: meta.heights_m,
      max_dist_m: meta.max_dist_m, elev_cdeg: Object.fromEntries(meta.heights_m.map((h, i) => [String(h), masks[i]])) },
    ephem: topocentric(assets.vectors, meta, lat, lon, elevationM) };
  progress(1);
  return { site, elevationM, accuracy: assets.accuracy, elapsedMs: performance.now() - start };
}

export async function loadFreeAssets(base: string): Promise<FreeAssets> {
  const read = async (file: string) => {
    const r = await fetch(base + file);
    if (!r.ok) throw new Error('Free-coordinate data unavailable');
    return r;
  };
  const meta = await (await read('meta.json')).json() as FreeMeta;
  if (meta.version !== 1 || meta.frame !== 'MOON_ME' || meta.radius_m !== MOON_RADIUS_M || meta.n < 1
    || meta.payload_bytes > 12000000 || meta.grids.length !== 2 || meta.az_step_deg !== 0.5
    || meta.max_dist_m !== 200000 || meta.heights_m.join(',') !== '1,2,5,10') throw new Error('Invalid free-coordinate data');
  const buffers = await Promise.all([...meta.grids.map(g => g.file), meta.vectors_file].map(async f => (await read(f)).arrayBuffer()));
  const grids = meta.grids.map((g, i) => {
    if (buffers[i].byteLength !== g.n * g.n * 2) throw new Error('Invalid free-coordinate data');
    return new Int16Array(buffers[i]);
  });
  const vectorBuffer = buffers[buffers.length - 1];
  if (vectorBuffer.byteLength !== meta.n * 24) throw new Error('Invalid free-coordinate data');
  const vectors = new Float32Array(vectorBuffer);
  let accuracy: FreeAccuracy | null = null;
  try {
    const r = await fetch(base + 'accuracy.json');
    if (r.ok) {
      const report = await r.json() as FreeAccuracy;
      if (report.generated_utc === meta.generated_utc && report.sites === 15
        && [report.mask_max_deg, report.mask_mean_deg, report.sunlight_max_pp, report.sunlight_mean_pp].every(Number.isFinite)) accuracy = report;
    }
  } catch { /* Missing accuracy must be shown as unmeasured, never as zero error. */ }
  return { meta, grids, vectors, accuracy };
}
