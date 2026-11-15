// Illumination map (docs/contracts-3d.md): yearly % of sunlight and Earth visibility per ~80 m
// cell around a site, from the published terrain with the game's own horizon model.

export interface IllumMeta {
  id: string;
  grid: number;
  cell_m: number;
  half_m: number;
  window: string;
  observer_height_m: number;
  light: { file: string; offset: number; dtype: 'uint8'; scale_pct: number };
  earth: { file: string; offset: number; dtype: 'uint8'; scale_pct: number };
  earth_margin_deg: number;
  source: string;
}

export interface IllumMap {
  meta: IllumMeta;
  light: Float32Array; // 0..1, row 0 = north
  earth: Float32Array; // 0..1
}

const base = () => import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/illum/';

/** The site's illumination map, or null when it has not been generated. */
export async function loadIllum(id: string, signal?: AbortSignal): Promise<IllumMap | null> {
  const r = await fetch(base() + encodeURIComponent(id) + '.json', { signal });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Unable to load illumination map: ${r.status}`);
  const meta = (await r.json()) as IllumMeta;
  const g = meta.grid;
  if (!Number.isInteger(g) || g < 2 || g > 1024 || !(meta.half_m > 0) || !/^[\w.-]+$/.test(meta.light.file)) throw new Error('Invalid illumination map');
  const b = await fetch(base() + meta.light.file, { signal });
  if (!b.ok) throw new Error(`Unable to load illumination map: ${b.status}`);
  const bytes = new Uint8Array(await b.arrayBuffer());
  if (bytes.length !== 2 * g * g) throw new Error('Invalid illumination map size');
  const decode = (off: number, scale: number) => Float32Array.from(bytes.subarray(off, off + g * g), (v) => (v * scale) / 100);
  return { meta, light: decode(meta.light.offset, meta.light.scale_pct), earth: decode(meta.earth.offset, meta.earth.scale_pct) };
}

/** Bilinear value of a layer at (x east, y north) metres; NaN outside the map. */
export function illumAt(m: IllumMap, layer: 'light' | 'earth', x: number, y: number): number {
  const g = m.meta.grid, cell = m.meta.cell_m, h = m.meta.half_m;
  const c = (x + h) / cell - 0.5, r = (h - y) / cell - 0.5;
  if (c < -0.5 || r < -0.5 || c > g - 0.5 || r > g - 0.5) return NaN;
  const cc = Math.max(0, Math.min(g - 1.0001, c)), rr = Math.max(0, Math.min(g - 1.0001, r));
  const c0 = Math.floor(cc), r0 = Math.floor(rr), fc = cc - c0, fr = rr - r0, a = m[layer], i = r0 * g + c0;
  return a[i] * (1 - fc) * (1 - fr) + a[i + 1] * fc * (1 - fr) + a[i + g] * (1 - fc) * fr + a[i + g + 1] * fc * fr;
}
