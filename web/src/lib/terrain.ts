export interface GridSpec { file: string; n: number; res_m: number; dtype: 'int16'; scale_m: number; offset_m: number; source: string }
export interface TerrainMeta { id: string; frame: string; near: GridSpec; far: GridSpec; site_elev_m: number; observer_heights_m: number[] }
export interface PanoMeta { id: string; observer_height_m: number; width: number; height: number; az0_deg: number; el_top_deg: number; el_bottom_deg: number; dist: {file: string; dtype: 'uint16'; unit_m: number; sky: number}; normal: {file: string; dtype: 'uint8x2'; encoding: string}; max_dist_m: number }
export interface TerrainData { meta: TerrainMeta; near: Float32Array; far: Float32Array }
export interface PanoData { meta: PanoMeta; distances: Float32Array; normals: Float32Array }
export interface ViewProps { siteId: string; sunAz: number; sunEl: number; earthAz: number; earthEl: number; horizon: number[]; horizonStep: number }
export const MISSING_3D = '3D data not generated yet for this site';
export function azElToThree(az: number, el: number): [number, number, number] {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
export function decodeInt16(buffer: ArrayBuffer, scale: number, offset: number): Float32Array {
  if (buffer.byteLength % 2) throw new Error('Invalid int16 payload');
  const view = new DataView(buffer);
  return Float32Array.from({ length: buffer.byteLength / 2 }, (_, i) => {
    const v = view.getInt16(i * 2, true); return v === -32768 ? NaN : v * scale + offset;
  });
}
/** Decode octahedral bytes to a unit normal in local east, north, up. */
export function decodeOctahedral(u: number, v: number): [number, number, number] {
  let x = u / 255 * 2 - 1, y = v / 255 * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) { const oldX = x; x = (1 - Math.abs(y)) * (oldX >= 0 ? 1 : -1); y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1); }
  const length = Math.hypot(x, y, z); return [x / length, y / length, z / length];
}
function url(folder: string, file: string) {
  if (!/^[\w.-]+$/.test(file)) throw new Error('Invalid data filename');
  return import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/' + folder + '/' + file;
}
async function read(folder: string, file: string, signal?: AbortSignal) {
  const r = await fetch(url(folder, file), { signal }); if (!r.ok) throw new Error(MISSING_3D); return r;
}
export async function loadTerrain(id: string, progress: (n: number) => void = () => {}, signal?: AbortSignal): Promise<TerrainData> {
  progress(0); const meta: TerrainMeta = await (await read('terrain', id + '.json', signal)).json(); progress(20);
  const grids = await Promise.all([meta.near, meta.far].map(async g => {
    if (!Number.isInteger(g.n) || g.n < 2 || g.n > 4096 || g.dtype !== 'int16' || !(g.res_m > 0) || !(g.scale_m > 0)) throw new Error('Invalid terrain metadata');
    const b = await (await read('terrain', g.file, signal)).arrayBuffer();
    if (b.byteLength !== g.n * g.n * 2) throw new Error('Invalid terrain dimensions');
    return decodeInt16(b, g.scale_m, g.offset_m);
  })); progress(100); return { meta, near: grids[0], far: grids[1] };
}
export async function loadPano(id: string, progress: (n: number) => void = () => {}, signal?: AbortSignal): Promise<PanoData> {
  progress(0); const meta: PanoMeta = await (await read('pano', id + '.json', signal)).json(); progress(20);
  const count = meta.width * meta.height;
  if (!Number.isInteger(count) || count < 1 || count > 16777216 || meta.normal.dtype !== 'uint8x2' || meta.dist.dtype !== 'uint16' || !(meta.dist.unit_m > 0) || !(meta.el_top_deg > meta.el_bottom_deg)) throw new Error('Invalid panorama metadata');
  const [d, n] = await Promise.all([meta.dist.file, meta.normal.file].map(async f => (await read('pano', f, signal)).arrayBuffer()));
  if (d.byteLength !== count * 2 || n.byteLength !== count * 2) throw new Error('Invalid panorama dimensions');
  const view = new DataView(d), bytes = new Uint8Array(n), distances = new Float32Array(count), normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { const raw = view.getUint16(i * 2, true); distances[i] = raw === meta.dist.sky ? 0 : raw * meta.dist.unit_m; if (distances[i]) normals.set(decodeOctahedral(bytes[i * 2], bytes[i * 2 + 1]), i * 3); }
  progress(100); return { meta, distances, normals };
}
