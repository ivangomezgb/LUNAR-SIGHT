import type { Assumptions, Metrics, RankedOption, ReplanInput, SiteData, SiteIndexEntry, Weights } from './types';
import { computeMetrics } from './metrics';

export const DEFAULT_WEIGHTS: Weights = { light: 40, earth: 30, night: 20, landingSun: 10 };
export const MAX_PER_SITE = 3;
export function score(m: Metrics, w: Weights, maxNightH = 336): number {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const total = w.light + w.earth + w.night + w.landingSun;
  if (!(total > 0)) return 0;
  const value = 100 * (w.light * clamp(m.lightPct / 100) + w.earth * clamp(m.earthPct / 100)
    + w.night * (1 - clamp(m.longestNightH / Math.max(maxNightH, Number.EPSILON)))
    + w.landingSun * clamp(m.sunElAtLandingDeg / 3)) / total;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
export function rankAlternatives(sites: Map<string, SiteData>, index: SiteIndexEntry[], input: ReplanInput, a: Assumptions): RankedOption[] {
  if (!(input.stepH > 0) || !Number.isFinite(input.stepH) || input.toleranceDays < 0 || !(input.missionDays > 0)) return [];
  const original = sites.get(input.siteIds[0]);
  if (!original) return [];
  const baseline = computeMetrics(original, input.originalUtc, input.missionDays * 24, a);
  const center = Date.parse(input.originalUtc) + input.delayDays * 86400000;
  const lo = center - input.toleranceDays * 86400000, hi = center + input.toleranceDays * 86400000;
  const slopes = new Map(index.map(s => [s.id, s.slope_deg_50m]));
  const options: RankedOption[] = [];
  const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(Math.round(n))}`;
  for (const siteId of new Set(input.siteIds)) {
    const site = sites.get(siteId), slope = slopes.get(siteId);
    if (!site || slope === undefined || slope > input.filters.maxSlopeDeg) continue;
    const coverageStart = Date.parse(site.ephem.t0_utc), coverageEnd = coverageStart + site.ephem.n * site.ephem.step_h * 3600000;
    for (let time = lo; time <= hi; time += input.stepH * 3600000) {
      if (time < coverageStart || time + input.missionDays * 86400000 > coverageEnd) continue;
      const landingUtc = new Date(time).toISOString();
      const m = computeMetrics(site, landingUtc, input.missionDays * 24, a);
      if (m.lightPct < input.filters.minLightPct || m.earthPct < input.filters.minEarthPct
        || (input.filters.requireSunAtLanding && m.sunElAtLandingDeg <= 0)) continue;
      options.push({ siteId, landingUtc, metrics: m, score: score(m, input.weights), reasons: [
        `${signed(m.lightPct - baseline.lightPct)}% sunlight vs original plan`,
        `${signed(m.longestNightH - baseline.longestNightH)} h longest night vs original plan`,
        `Earth visible ${Math.round(m.earthPct)}% of mission (${signed(m.earthPct - baseline.earthPct)}% vs original plan)`,
      ] });
    }
  }
  options.sort((a, b) => b.score - a.score || (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0)
    || a.landingUtc.localeCompare(b.landingUtc));
  // at most MAX_PER_SITE dates per site, so the top 10 offers real alternatives
  const perSite = new Map<string, number>();
  return options.filter(o => {
    const k = (perSite.get(o.siteId) ?? 0) + 1;
    perSite.set(o.siteId, k);
    return k <= MAX_PER_SITE;
  }).slice(0, 10);
}
