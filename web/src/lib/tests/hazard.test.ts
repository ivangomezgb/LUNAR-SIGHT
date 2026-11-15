import { describe, it } from 'vitest';
import { computeHazard, MOON_RADIUS_M, slopeBand } from '../hazard';

function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function close(actual: number | null, expected: number, tolerance = 0.0001) { assert(actual !== null && Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }
function fixture(fn: (x: number, y: number) => number, n = 405) {
  const res = 10, centre = (n - 1) / 2;
  return Float64Array.from({ length: n * n }, (_, i) => {
    const x = (i % n - centre) * res, y = (centre - Math.floor(i / n)) * res;
    return fn(x, y) - (x * x + y * y) / (2 * MOON_RADIUS_M);
  });
}

describe('LOLA slope screening (standalone-compatible assertions)', () => {
  it('removes curvature and recovers a flat plane', () => {
    const r = computeHazard(fixture(() => 0), 405, 10);
    close(r.siteSlopeDeg, 0); close(r.reliefM, 0); close(r.largestRadiusM, 2000);
    assert(r.largestLimited && r.nearest?.distanceM === 0 && r.nearest.bearingDeg === null, 'flat circle');
    assert(r.circles.every(c => c.safePct === 100 && c.unknownPct === 0), 'flat percentages');
  });
  it('recovers a tilted plane in both axes and relief', () => {
    const gx = 0.1, gy = 0.2, expected = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
    const r = computeHazard(fixture((x, y) => gx * x + gy * y), 405, 10);
    close(r.siteSlopeDeg, expected);
    assert(r.circles.every(c => c.safePct === 0 && c.moderatePct === 100), 'tilted percentages');
    assert(r.nearest === null && r.largestRadiusM === 0, 'steep plane has no passing circle');
    close(r.reliefM, 222); // Discrete disk extrema at (230, 440) and its antipode.
  });
  it('resolves cone flanks while documenting symmetric summit cancellation', () => {
    const r = computeHazard(fixture((x, y) => Math.hypot(x, y) * Math.tan(20 * Math.PI / 180)), 405, 10);
    close(r.siteSlopeDeg, 0);
    close(r.slopes[r.siteIndex + 20], 20);
    assert(r.largestRadiusM === 0 && r.nearest === null, 'cone cannot fit 100m disk');
    close(r.reliefM, 500 * Math.tan(20 * Math.PI / 180));
  });
  it('propagates nodata and counts it in denominators', () => {
    const h = fixture(() => 0); h[202 * 405 + 202] = NaN;
    const r = computeHazard(h, 405, 10);
    assert(r.siteSlopeDeg === null && r.largestRadiusM === null, 'unknown site');
    assert(r.circles.every(c => c.known === c.samples - 5 && c.unknownPct > 0 && c.safePct < 100), 'five-point unknown stencil');
    assert(r.nearest !== null && r.nearest.distanceM > 100, 'avoid unknown disk');
    assert(r.reliefKnownPct < 100, 'partial relief coverage');
  });
  it('handles entirely missing terrain', () => {
    const r = computeHazard(fixture(() => NaN), 405, 10);
    assert(r.nearest === null && r.reliefM === null && r.siteSlopeDeg === null, 'missing statistics');
    assert(r.circles.every(c => c.unknownPct === 100 && c.safePct === 0), 'missing is not safe');
  });
  it('uses southeast node on even grids, exact origin circles, and north-first ties', () => {
    const r = computeHazard(fixture(() => 0, 406), 406, 10);
    close(r.westM + r.siteIndex % r.n * 10, 5); close(r.northM - Math.floor(r.siteIndex / r.n) * 10, -5);
    assert(r.nearest?.distanceM === 0, 'exact origin candidate');
    const h = fixture(() => 0); h[202 * 405 + 202] = NaN;
    const missing = computeHazard(h, 405, 10);
    assert(missing.nearest !== null && missing.nearest.northM > 0 && missing.nearest.eastM < 0, 'deterministic north/west tie');
  });
  it('finds an offset passing disk and validates all its sampled nodes', () => {
    const r = computeHazard(fixture((x) => x < 120 ? x * 0.4 : 48), 405, 10);
    assert(r.nearest !== null, 'offset disk exists');
    close(r.nearest!.bearingDeg, 90); close(r.nearest!.distanceM, 230);
    for (let i = 0; i < r.slopes.length; i++) {
      const x = r.westM + i % r.n * r.resM, y = r.northM - Math.floor(i / r.n) * r.resM;
      if (Math.hypot(x - r.nearest!.eastM, y - r.nearest!.northM) <= 100) assert(r.slopes[i] <= 8, 'unsafe node inside selected disk');
    }
  });
  it('keeps exact legend boundaries and rejects invalid or insufficient grids', () => {
    assert([0, 5, 8, 15, 25, 26, NaN].map(slopeBand).join() === '0,0,1,2,3,4,5', 'legend boundaries');
    for (const [n, res] of [[2, 10], [405, 0], [405, NaN], [3, 10]]) {
      let threw = false; try { computeHazard(new Float32Array(n * n), n, res); } catch { threw = true; }
      assert(threw, 'invalid input accepted');
    }
  });
});
