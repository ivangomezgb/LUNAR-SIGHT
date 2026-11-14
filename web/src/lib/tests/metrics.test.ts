import { describe, expect, it } from 'vitest';
import fixtureText from '../../../../pipeline/tests/fixtures/metrics_case.json?raw';
import { computeMetrics, DEFAULT_ASSUMPTIONS, getSeries, hourIndex } from '../metrics';
import { horizonAt, sunFraction } from '../sunFraction';
import { DEFAULT_WEIGHTS, rankAlternatives, score } from '../score';
import type { SiteData, SiteIndexEntry } from '../types';

const fixture = JSON.parse(fixtureText);
const site = fixture.site as SiteData;

describe('solar disk and horizon', () => {
  it('has the exact disk limits and increases monotonically', () => {
    expect(sunFraction(-0.267, 0)).toBe(0);
    expect(sunFraction(0, 0)).toBe(0.5);
    expect(sunFraction(0.267, 0)).toBe(1);
    let previous = 0;
    for (let x = -1; x <= 1; x += 0.01) {
      const current = sunFraction(x, 0);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
  it('interpolates across north at 359.75 degrees', () => {
    const mask = new Array(720).fill(0); mask[719] = 200;
    expect(horizonAt(mask, 359.75)).toBe(1);
    expect(horizonAt(mask, -0.25)).toBe(1);
    expect(horizonAt(mask, 360)).toBe(0);
  });
});

it('matches the shared Python fixture including streaks', () => {
  const actual = computeMetrics(site, fixture.startUtc, fixture.hours, DEFAULT_ASSUMPTIONS);
  for (const [key, value] of Object.entries(fixture.expected)) {
    const got = actual[key as keyof typeof actual];
    if (typeof value === 'number') expect(Math.abs((got as number) - value)).toBeLessThanOrEqual(key.endsWith('Pct') ? 0.1 : 1e-6);
    else expect(got).toEqual(value);
  }
  expect(getSeries(site, DEFAULT_ASSUMPTIONS)).toBe(getSeries(site, { ...DEFAULT_ASSUMPTIONS }));
  expect(hourIndex(site, '2026-10-31T23:30:00Z')).toBe(-1);
});

it('clamps coverage and leaves unknown events null', () => {
  const m = computeMetrics(site, '2026-11-01T06:00:00Z', 20, DEFAULT_ASSUMPTIONS);
  expect(m.hours).toBe(2);
  expect(m.hoursToSunset).toBeNull();
  expect(m.hoursToEarthset).toBeNull();
  expect(m.nextEarthWindow).toBeNull();
  expect(computeMetrics(site, '2026-10-31T22:00:00Z', 4).hours).toBe(2);
  expect(computeMetrics(site, '2026-11-02T00:00:00Z', 4).hours).toBe(0);
});

it('bounds weighted scores including zero weights', () => {
  const m = computeMetrics(site, fixture.startUtc, 8);
  expect(score(m, DEFAULT_WEIGHTS)).toBeGreaterThanOrEqual(0);
  expect(score(m, DEFAULT_WEIGHTS)).toBeLessThanOrEqual(100);
  expect(score(m, { light: 0, earth: 0, night: 0, landingSun: 0 })).toBe(0);
  expect(score({ ...m, lightPct: 100, earthPct: 100, longestNightH: 0, sunElAtLandingDeg: 3 }, DEFAULT_WEIGHTS)).toBe(100);
});

it('ranks 15 sites over 60 days in under one second with deterministic ties', () => {
  const sites = new Map<string, SiteData>();
  const index: SiteIndexEntry[] = [];
  const n = 19008;
  for (let j = 0; j < 15; j++) {
    const id = `perf-${String(j).padStart(2, '0')}`;
    sites.set(id, { ...site, id, ephem: { ...site.ephem, n,
      sun: { az_cdeg: new Array(n).fill(0), el_cdeg: Array.from({ length: n }, (_, i) => i % 48 < 30 ? 100 : -100) },
      earth: { az_cdeg: new Array(n).fill(0), el_cdeg: Array.from({ length: n }, (_, i) => i % 24 < 20 ? 100 : -100) } } });
    index.push({ id, slope_deg_50m: j === 14 ? 30 : 2 } as SiteIndexEntry);
  }
  const input = { siteIds: [...sites.keys()], originalUtc: fixture.startUtc, delayDays: 30, toleranceDays: 30,
    missionDays: 14, stepH: 6, weights: DEFAULT_WEIGHTS,
    filters: { minLightPct: 0, minEarthPct: 0, maxSlopeDeg: 10, requireSunAtLanding: false } };
  const start = performance.now();
  const result = rankAlternatives(sites, index, input, DEFAULT_ASSUMPTIONS);
  const elapsed = performance.now() - start;
  console.info(`15 sites x 60 days ranking: ${elapsed.toFixed(1)} ms`);
  expect(elapsed).toBeLessThan(1000);
  expect(result).toHaveLength(10);
  expect(result.every(r => r.siteId !== 'perf-14' && r.reasons.length === 3)).toBe(true);
  expect(result).toEqual(rankAlternatives(sites, index, input, DEFAULT_ASSUMPTIONS));
  expect(result[0].siteId).toBe('perf-00');
  const filtered = rankAlternatives(sites, index, { ...input, filters: { ...input.filters, minLightPct: 101 } }, DEFAULT_ASSUMPTIONS);
  expect(filtered).toEqual([]);
});
