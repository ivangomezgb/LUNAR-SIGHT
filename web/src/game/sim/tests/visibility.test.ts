import { describe, expect, it } from 'vitest';
import { gridHeight, heightAt, makeField, makeGrid, slopeDeg } from '../field';
import { makeHorizon, marchHorizon } from '../visibility';
import { hasRealData, loadRealSite } from './realData';

describe('height field', () => {
  // plane z = 0.1 x + 0.05 y on a 5 x 5 grid of 10 m
  const n = 5, res = 10;
  const z = Float32Array.from({ length: n * n }, (_, k) => {
    const col = k % n, row = Math.floor(k / n);
    const x = (col - 2) * res, y = (2 - row) * res;
    return 0.1 * x + 0.05 * y;
  });
  const g = makeGrid({ n, res_m: res }, z);
  it('interpolates a plane exactly, north up', () => {
    expect(gridHeight(g, 0, 0)).toBeCloseTo(0, 6);
    expect(gridHeight(g, 7, -3)).toBeCloseTo(0.1 * 7 - 0.05 * 3, 6);
    expect(gridHeight(g, 0, 20)).toBeCloseTo(1, 6); // row 0 is the north edge
    expect(gridHeight(g, 25, 0)).toBeNaN();
  });
  it('measures the slope of the plane', () => {
    const big = makeGrid({ n: 41, res_m: 10 }, Float32Array.from({ length: 41 * 41 }, (_, k) => 0.1 * ((k % 41) - 20) * 10));
    const f = { near: big, far: big };
    expect(heightAt(f, 15, 15)).toBeCloseTo(1.5, 4);
    expect(slopeDeg(f, 0, 0)).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 4);
  });
});

describe('horizon from any point', () => {
  it('sees a flat curved Moon horizon at the analytic dip', () => {
    // sphere of radius R in the site tangent frame: z = -d^2 / 2R
    const n = 401, res = 25, R = 1737400;
    const z = Float32Array.from({ length: n * n }, (_, k) => {
      const x = ((k % n) - 200) * res, y = (200 - Math.floor(k / n)) * res;
      return -(x * x + y * y) / (2 * R);
    });
    const g = makeGrid({ n, res_m: res }, z);
    const f = { near: g, far: g };
    const dip = -(Math.acos(R / (R + 2)) * 180) / Math.PI; // -0.087 deg for a 2 m eye
    for (const az of [0, 90, 200]) expect(marchHorizon(f, 0, 0, 2, az)).toBeCloseTo(dip, 2);
    // the same dip from an off-centre point: the local vertical is tilted correctly
    expect(marchHorizon(f, 1500, -800, 2, 45)).toBeCloseTo(dip, 2);
  });

  const sites = ['connecting-ridge', 'peak-near-shackleton', 'malapert-massif'].filter(hasRealData);
  it.each(sites)('reproduces the published 2 m mask at %s', (id) => {
    const { site, terrain } = loadRealSite(id);
    const field = makeField(terrain);
    const mask = site.horizon.elev_cdeg['2'];
    const hz = makeHorizon(field, mask, site.horizon.az_step_deg, 2);
    const err = mask.map((m, i) => Math.abs(hz.at(0, 0, i * site.horizon.az_step_deg) - m / 100)).sort((a, b) => a - b);
    const p95 = err[Math.floor(err.length * 0.95)], max = err[err.length - 1];
    console.info(`${id}: horizon vs published mask p50 ${err[err.length >> 1].toFixed(3)} p95 ${p95.toFixed(3)} max ${max.toFixed(3)} deg; far-only azimuths ${hz.farOnly.filter(Number.isFinite).length}`);
    expect(p95).toBeLessThanOrEqual(0.1);
    expect(max).toBeLessThanOrEqual(0.2);
  });
});
