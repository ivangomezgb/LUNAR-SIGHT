// Real LOLA terrain around a site as a continuous height field (docs/contracts-3d.md).
// Frame: site local tangent plane, x = east, y = north, z = up (m); curvature is baked into z.
// No three.js here: the simulation is plain TypeScript and unit tested.
import type { GridSpec } from '../../lib/types';

export const R_MOON_M = 1737400;

export interface Grid {
  n: number;
  res: number;
  z: Float32Array; // row-major, row 0 = north edge; NaN = nodata
  half: number; // distance from the centre to the outermost node, m
}

export interface Field {
  near: Grid;
  far: Grid;
}

export function makeGrid(spec: Pick<GridSpec, 'n' | 'res_m'>, z: Float32Array): Grid {
  if (z.length !== spec.n * spec.n) throw new Error('Grid size does not match its heights');
  return { n: spec.n, res: spec.res_m, z, half: ((spec.n - 1) / 2) * spec.res_m };
}

export function makeField(data: { meta: { near: GridSpec; far: GridSpec }; near: Float32Array; far: Float32Array }): Field {
  return { near: makeGrid(data.meta.near, data.near), far: makeGrid(data.meta.far, data.far) };
}

/** Bilinear height of one grid at (x, y); NaN outside the grid or next to nodata. */
export function gridHeight(g: Grid, x: number, y: number): number {
  const c = x / g.res + (g.n - 1) / 2;
  const r = (g.n - 1) / 2 - y / g.res;
  const c0 = Math.floor(c), r0 = Math.floor(r);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= g.n || r0 + 1 >= g.n) {
    // exactly on the last row/column: fall back to the node itself
    if (c0 >= 0 && r0 >= 0 && c0 < g.n && r0 < g.n && c === c0 && r === r0) return g.z[r0 * g.n + c0];
    return NaN;
  }
  const fc = c - c0, fr = r - r0, i = r0 * g.n + c0;
  return g.z[i] * (1 - fc) * (1 - fr) + g.z[i + 1] * fc * (1 - fr)
    + g.z[i + g.n] * (1 - fc) * fr + g.z[i + g.n + 1] * fc * fr;
}

/** Inside the fine grid (with one cell of margin for interpolation and gradients). */
export function inNear(f: Field, x: number, y: number): boolean {
  const m = f.near.half - f.near.res;
  return Math.abs(x) <= m && Math.abs(y) <= m;
}

/** Terrain height at (x, y): 10 m grid near the site, 400 m grid beyond. */
export function heightAt(f: Field, x: number, y: number): number {
  return inNear(f, x, y) ? gridHeight(f.near, x, y) : gridHeight(f.far, x, y);
}

/** Unit surface normal (east, north, up) from central differences over one grid cell. */
export function normalAt(f: Field, x: number, y: number): [number, number, number] {
  const d = inNear(f, x, y) ? f.near.res : f.far.res;
  const dzdx = (heightAt(f, x + d, y) - heightAt(f, x - d, y)) / (2 * d);
  const dzdy = (heightAt(f, x, y + d) - heightAt(f, x, y - d)) / (2 * d);
  const len = Math.hypot(dzdx, dzdy, 1);
  return [-dzdx / len, -dzdy / len, 1 / len];
}

/** Slope in degrees at (x, y), NaN where the terrain is unknown. */
export function slopeDeg(f: Field, x: number, y: number): number {
  const [, , up] = normalAt(f, x, y);
  return (Math.acos(Math.min(1, up)) * 180) / Math.PI;
}
