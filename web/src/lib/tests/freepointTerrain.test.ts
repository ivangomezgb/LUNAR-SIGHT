import { describe, expect, it } from 'vitest';
import { buildPatch, localToPolar, tangentHeight } from '../freepointTerrain';
import { MOON_RADIUS_M, polarXY } from '../freepoint';
import type { FreeAssets, FreeGrid } from '../freepoint';

function fixture() {
  const grid: FreeGrid = { file: 'fixture', n: 9, left: -4500, top: 4500, res_m: 1000, scale_m: 1, nodata: -32768 };
  return { meta: { grids: [grid] } as FreeAssets['meta'], grids: [new Int16Array(81)] };
}
describe('free-point local terrain', () => {
  it('includes spherical curvature relative to the chosen ground elevation', () => {
    expect(tangentHeight(0, 0, 123, 123)).toBe(0);
    expect(tangentHeight(1000, 0, 0, 0)).toBeCloseTo(-1000000 / (2 * MOON_RADIUS_M), 6);
    expect(tangentHeight(30000, 40000, 0, 0)).toBeLessThan(-719);
  });
  it.each([0, 45, 90, -90, 180])('rotates east and north correctly at longitude %s', lon => {
    const [x, y] = polarXY(-89, lon), a = lon * Math.PI / 180;
    const east = localToPolar(-89, lon, 10, 0), north = localToPolar(-89, lon, 0, 10);
    expect((east[0] - x) / 10).toBeCloseTo(Math.cos(a), 3);
    expect((east[1] - y) / 10).toBeCloseTo(-Math.sin(a), 3);
    expect((north[0] - x) / 10).toBeCloseTo(Math.sin(a), 3);
    expect((north[1] - y) / 10).toBeCloseTo(Math.cos(a), 3);
  });
  it('puts north at negative Three z with upward-facing triangles', () => {
    const patch = buildPatch(fixture(), -90, 0, 0, 1000, 2, 0);
    expect(patch.positions[2]).toBe(-1000);
    expect(patch.positions[13]).toBe(0);
    expect(patch.normals[13]).toBeGreaterThan(.99);
    expect(patch.missing).toBe(false);
  });
  it('omits nodata triangles instead of inventing a flat surface', () => {
    const assets = fixture(); assets.grids[0].fill(-32768);
    const patch = buildPatch(assets, -90, 0, 0, 1000, 2, 0);
    expect(patch.indices.length).toBe(0); expect(patch.missing).toBe(true);
    expect(Array.from(patch.positions).every(Number.isFinite)).toBe(true);
  });
  it('clips edges and removes the far patch central footprint', () => {
    const patch = buildPatch(fixture(), -90, 0, 0, 6000, 12, 0, 1000);
    expect(patch.missing).toBe(true);
    expect(patch.indices.length).toBeGreaterThan(0);
    for (let i = 0; i < patch.indices.length; i += 3) {
      const tri = Array.from(patch.indices.slice(i, i + 3));
      const x = tri.reduce((s, k) => s + patch.positions[k * 3], 0) / 3;
      const z = tri.reduce((s, k) => s + patch.positions[k * 3 + 2], 0) / 3;
      expect(Math.abs(x) >= 1000 || Math.abs(z) >= 1000).toBe(true);
    }
  });
});
