import { loadFreeAssets, sampleGrid, polarXY, MOON_RADIUS_M as R } from './freepoint';
import type { FreeAssets } from './freepoint';

export interface TerrainPatch { positions: Float32Array; indices: Uint32Array; normals: Float32Array; missing: boolean }
export interface FreeTerrain { near: TerrainPatch; far: TerrainPatch }
const rad = Math.PI / 180;
/** Exact inverse tangent-plane projection onto a spherical surface. ENU metres. */
export function localToPolar(lat: number, lon: number, east: number, north: number, height = 0): [number, number] {
  if (!east && !north) return polarXY(lat, lon);
  const sl = Math.sin(lat * rad), cl = Math.cos(lat * rad), so = Math.sin(lon * rad), co = Math.cos(lon * rad);
  const radius = R + height, up = Math.sqrt(radius * radius - east * east - north * north);
  const x = (up * cl * co - east * so - north * sl * co) / radius;
  const y = (up * cl * so + east * co - north * sl * so) / radius;
  const z = (up * sl + north * cl) / radius;
  return [2 * R * y / (1 - z), 2 * R * x / (1 - z)];
}
export function tangentHeight(east: number, north: number, height: number, origin: number) {
  return Math.sqrt((R + height) ** 2 - east ** 2 - north ** 2) - R - origin;
}
/** Pure builder. Invalid vertices never enter triangles. Far cells share the near boundary. */
export function buildPatch(assets: Pick<FreeAssets, 'meta' | 'grids'>, lat: number, lon: number, elevation: number,
  extent: number, segments: number, gridIndex: number, hole = 0): TerrainPatch {
  const n = segments + 1, positions = new Float32Array(n * n * 3), valid = new Uint8Array(n * n);
  const indices: number[] = []; let missing = false;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -extent + i * 2 * extent / segments, y = extent - j * 2 * extent / segments, k = j * n + i;
    let [px, py] = localToPolar(lat, lon, x, y, elevation);
    let h = sampleGrid(assets.meta.grids[gridIndex], assets.grids[gridIndex], px, py);
    // One refinement accounts for terrain radius in the tangent-plane inverse.
    if (Number.isFinite(h)) {
      [px, py] = localToPolar(lat, lon, x, y, h);
      h = sampleGrid(assets.meta.grids[gridIndex], assets.grids[gridIndex], px, py);
    }
    // Match the inner DEM along the shared edge; blend over the first far cell.
    // Both endpoints are measured samples, not generated relief.
    if (hole && Math.max(Math.abs(x), Math.abs(y)) <= hole + 1000) {
      const [ix, iy] = localToPolar(lat, lon, x, y, elevation);
      const initial = sampleGrid(assets.meta.grids[0], assets.grids[0], ix, iy);
      const [rx, ry] = localToPolar(lat, lon, x, y, initial);
      const inner = sampleGrid(assets.meta.grids[0], assets.grids[0], rx, ry);
      const weight = Math.max(0, Math.min(1, (Math.max(Math.abs(x), Math.abs(y)) - hole) / 1000));
      if (Number.isFinite(inner) && Number.isFinite(h)) h = inner * (1 - weight) + h * weight;
    }
    valid[k] = Number(Number.isFinite(h));
    if (!valid[k] && (Math.abs(x) >= hole || Math.abs(y) >= hole)) missing = true;
    positions.set([x, valid[k] ? tangentHeight(x, y, h, elevation) : 0, -y], k * 3);
  }
  for (let j = 0; j < segments; j++) for (let i = 0; i < segments; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (hole && positions[a * 3] >= -hole && positions[d * 3] <= hole && positions[a * 3 + 2] >= -hole && positions[d * 3 + 2] <= hole) continue;
    for (const tri of [[a, c, b], [b, c, d]]) if (tri.every(k => valid[k])) indices.push(...tri);
  }
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(k => k * 3);
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    for (const k of [a, b, c]) { normals[k] += uy * vz - uz * vy; normals[k + 1] += uz * vx - ux * vz; normals[k + 2] += ux * vy - uy * vx; }
  }
  for (let k = 0; k < normals.length; k += 3) {
    const length = Math.hypot(normals[k], normals[k + 1], normals[k + 2]) || 1;
    normals[k] /= length; normals[k + 1] /= length; normals[k + 2] /= length;
  }
  return { positions, indices: Uint32Array.from(indices), normals, missing };
}
export function buildFreeTerrain(assets: FreeAssets, lat: number, lon: number, elevation: number): FreeTerrain {
  // 250 m near sampling; 1 km far sampling. Exact shared boundary at 25 km.
  return { near: buildPatch(assets, lat, lon, elevation, 25000, 200, 0),
    far: buildPatch(assets, lat, lon, elevation, 150000, 300, 1, 25000) };
}
let cachedAssets: Promise<FreeAssets> | undefined;
export function loadFreeTerrainAssets(base: string) {
  return cachedAssets ??= loadFreeAssets(base).catch(error => { cachedAssets = undefined; throw error; });
}
// This same module is a Vite module worker, avoiding another owned source file.
if (typeof self !== 'undefined' && typeof document === 'undefined' && 'postMessage' in self) {
  self.onmessage = (event: MessageEvent<{ assets: FreeAssets; lat: number; lon: number; elevation: number }>) => {
    try {
      const p = event.data, terrain = buildFreeTerrain(p.assets, p.lat, p.lon, p.elevation);
      self.postMessage({ terrain }, { transfer: [terrain.near, terrain.far].flatMap(patch => [patch.positions.buffer, patch.indices.buffer, patch.normals.buffer]) });
    } catch { self.postMessage({ error: 'Terrain coverage incomplete' }); }
  };
}
