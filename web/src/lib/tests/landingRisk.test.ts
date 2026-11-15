import { describe, expect, it } from 'vitest';
import type { Series } from '../metrics';
import { getSeries } from '../metrics';
import type { SiteData } from '../types';
import { computeLandingRisk, shadowLength } from '../landingRisk';
import { sunFraction } from '../sunFraction';

function series(elevations: number[], earth?: number[], horizon = 0): Series {
  const n = elevations.length;
  return { sunEl: Float32Array.from(elevations), sunAz: new Float32Array(n).fill(350),
    sunFrac: Float32Array.from(elevations, e => sunFraction(e, horizon)),
    earthVis: Uint8Array.from(earth ?? new Array(n).fill(1)),
    earthAz: new Float32Array(n), earthEl: new Float32Array(n),
    horizonSunEl: new Float32Array(n).fill(horizon), horizonEarthEl: new Float32Array(n) };
}

describe('landing light risk', () => {
  it('accepts the prepared getSeries result with internal n+1 cache arrays', () => {
    const site: SiteData = { id: 'risk-fixture', generated_utc: '2027-01-01T00:00:00Z', frame: 'MOON_ME',
      horizon: { az_step_deg: 90, heights_m: [2], elev_cdeg: { '2': [0, 0, 0, 0] }, max_dist_m: 100 },
      ephem: { t0_utc: '2027-01-01T00:00:00Z', step_h: 1, n: 3,
        sun: { az_cdeg: [0, 0, 0], el_cdeg: [100, -10, -30] },
        earth: { az_cdeg: [0, 0, 0], el_cdeg: [100, 100, 0] } }, uncertainty: null };
    expect(computeLandingRisk(getSeries(site), 0)).toMatchObject({ sunlightRemainingH: 2, earthLossH: 2 });
  });
  it('counts partial disk light until fully hidden, not the half-disk day threshold', () => {
    const r = computeLandingRisk(series([1, 0.2, -0.1, -0.3]), 0);
    expect(r.sunlightRemainingH).toBe(3);
    expect(r.sunsetWithin24H).toBe(true);
    expect(r.elevationRateDegH).toBeCloseTo(-0.8);
    expect(r.level).toBe('high');
  });
  it('handles sunrise, existing darkness and a later sunset within 24 hours', () => {
    const s = series([-1, -0.1, 1, -1]);
    expect(computeLandingRisk(s, 0).sunlightRemainingH).toBe(0);
    expect(computeLandingRisk(s, 0).sunsetWithin24H).toBe(true);
    expect(computeLandingRisk(s, 1).elevationRateDegH).toBe(1);
    expect(computeLandingRisk(s, 1).sunlightRemainingH).toBe(2);
  });
  it('reports always-lit coverage as censored, never infinite', () => {
    const r = computeLandingRisk(series(new Array(101).fill(2)), 0);
    expect(r.sunlightRemainingH).toBeNull();
    expect(r.earthLossH).toBeNull();
    expect(r.observedAheadH).toBe(100);
    expect(r.level).toBe('low');
    expect(r.sunsetWithin24H).toBe(false);
    expect(computeLandingRisk(series([2]), 0)).toMatchObject({ level: 'medium', coverageLimited: true,
      sunsetWithin24H: null, elevationRateDegH: null });
  });
  it('counts Earth loss independently, including already hidden and non-hourly steps', () => {
    const s = series([2, 2, 2], [1, 1, 0]);
    expect(computeLandingRisk(s, 0, 2).earthLossH).toBe(4);
    expect(computeLandingRisk(s, 2).earthLossH).toBe(0);
  });
  it('uses terrain margin for risk and horizontal elevation for shadow geometry', () => {
    const r = computeLandingRisk(series(new Array(101).fill(45), undefined, 44.75), 0, 1, 6);
    expect(r.marginDeg).toBe(0.25);
    expect(r.level).toBe('high');
    expect(r.obstacleShadowM).toBeCloseTo(1);
    expect(r.landerShadowM).toBeCloseTo(6);
    expect(r.shadowAzimuthDeg).toBe(170);
    expect(shadowLength(4, 0)).toBeNull();
    expect(shadowLength(4, -1)).toBeNull();
    expect(shadowLength(4, 90)).toBe(0);
  });
  it('applies strict threshold boundaries', () => {
    const at = (margin: number, hours: number) => computeLandingRisk(series([...new Array(hours).fill(margin), -1]), 0);
    expect(at(0.5, 48).level).toBe('medium');
    expect(at(1, 96).level).toBe('low');
    expect(at(1, 47).level).toBe('high');
    expect(at(1, 95).level).toBe('medium');
  });
  it('includes the 24-hour boundary and detects insufficient coverage', () => {
    expect(computeLandingRisk(series([...new Array(24).fill(2), -1]), 0).sunsetWithin24H).toBe(true);
    expect(computeLandingRisk(series([...new Array(25).fill(2), -1]), 0).sunsetWithin24H).toBe(false);
    expect(computeLandingRisk(series(new Array(24).fill(2)), 0).sunsetWithin24H).toBeNull();
  });
  it('uses central differences internally and one-sided differences at boundaries', () => {
    const s = series([1, 2, 5]);
    expect(computeLandingRisk(s, 1, 2).elevationRateDegH).toBe(1);
    expect(computeLandingRisk(s, 2, 2).elevationRateDegH).toBe(1.5);
  });
  it('rejects invalid samples, heights and step sizes', () => {
    for (const index of [-1, 0.5, 2, NaN]) expect(() => computeLandingRisk(series([1, 2]), index)).toThrow();
    expect(() => computeLandingRisk(series([]), 0)).toThrow();
    expect(() => computeLandingRisk(series([1]), 0, 0)).toThrow();
    expect(() => computeLandingRisk(series([NaN]), 0)).toThrow();
    expect(() => shadowLength(0, 2)).toThrow();
    expect(() => shadowLength(4, 91)).toThrow();
  });
});
