import { describe, expect, it } from 'vitest';
import fixtureText from '../../../../pipeline/tests/fixtures/metrics_case.json?raw';
import { computeMetrics, DEFAULT_ASSUMPTIONS } from '../metrics';
import { DEFAULT_WEIGHTS, rankAlternatives } from '../score';
import type { ReplanInput, SiteData, SiteIndexEntry } from '../types';

const base = JSON.parse(fixtureText).site as SiteData;
const n = 24 * 90;

/** A site whose Sun is up `sunHours` of every 24 h, Earth always up. */
function synthetic(id: string, sunHours: number): SiteData {
  return { ...base, id, ephem: { ...base.ephem, n,
    sun: { az_cdeg: new Array(n).fill(0), el_cdeg: Array.from({ length: n }, (_, i) => (i % 24 < sunHours ? 300 : -300)) },
    earth: { az_cdeg: new Array(n).fill(0), el_cdeg: new Array(n).fill(300) } } };
}

const sites = new Map<string, SiteData>([['bright', synthetic('bright', 20)], ['dim', synthetic('dim', 6)]]);
const index = [...sites.keys()].map((id) => ({ id, slope_deg_50m: 1 }) as SiteIndexEntry);
const t0 = base.ephem.t0_utc;
const input = (originalSiteId: string, siteIds = ['dim', 'bright']): ReplanInput => ({
  originalSiteId, siteIds, originalUtc: t0, delayDays: 10, toleranceDays: 1, missionDays: 7, stepH: 24,
  weights: DEFAULT_WEIGHTS, filters: { minLightPct: 0, minEarthPct: 0, maxSlopeDeg: 10, requireSunAtLanding: false },
});

describe('rankAlternatives baseline', () => {
  it('compares against the chosen original site, not the first candidate', () => {
    const vsDim = rankAlternatives(sites, index, input('dim'), DEFAULT_ASSUMPTIONS);
    const vsBright = rankAlternatives(sites, index, input('bright'), DEFAULT_ASSUMPTIONS);
    const light = (r: typeof vsDim, id: string) => r.find((o) => o.siteId === id)!.reasons.find((x) => x.kind === 'light')!.delta;
    const dimPct = computeMetrics(sites.get('dim')!, t0, 7 * 24, DEFAULT_ASSUMPTIONS).lightPct;
    const brightPct = computeMetrics(sites.get('bright')!, t0, 7 * 24, DEFAULT_ASSUMPTIONS).lightPct;
    expect(light(vsDim, 'bright')).toBeCloseTo(brightPct - dimPct, 6);
    expect(light(vsBright, 'bright')).toBeCloseTo(0, 6);
    expect(light(vsBright, 'dim')).toBeLessThan(0);
  });

  it('uses an original site that is not among the candidates', () => {
    const r = rankAlternatives(sites, index, input('dim', ['bright']), DEFAULT_ASSUMPTIONS);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((o) => o.siteId === 'bright')).toBe(true);
  });

  it('returns no options when the original site is unknown', () => {
    expect(rankAlternatives(sites, index, input('nope'), DEFAULT_ASSUMPTIONS)).toEqual([]);
  });

  it('returns structured reasons', () => {
    const [top] = rankAlternatives(sites, index, input('dim'), DEFAULT_ASSUMPTIONS);
    expect(top.reasons.map((r) => r.kind)).toEqual(['light', 'night', 'earth']);
    const earth = top.reasons[2];
    expect(earth.kind === 'earth' && earth.pct).toBe(100);
  });
});
