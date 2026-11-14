import type { Assumptions, Metrics, SiteData } from './types';
import { horizonAt, sunFraction } from './sunFraction';

export const DEFAULT_ASSUMPTIONS: Assumptions = { heightM: 2, dayFraction: 0.5, earthMarginDeg: 0.5 };
export interface Series {
  sunFrac: Float32Array; earthVis: Uint8Array;
  sunAz: Float32Array; sunEl: Float32Array; earthAz: Float32Array; earthEl: Float32Array;
  horizonSunEl: Float32Array; horizonEarthEl: Float32Array;
}
interface Prepared extends Series {
  lightSum: Float64Array; earthSum: Uint32Array;
  dayEnd: Int32Array; earthEnd: Int32Array; nextDark: Int32Array;
  nextEarthHidden: Int32Array; nextEarthVisible: Int32Array;
}
const decoded = new WeakMap<SiteData, Pick<Series, 'sunAz' | 'sunEl' | 'earthAz' | 'earthEl'>>();
const cache = new Map<string, { site: SiteData; series: Prepared }>();
export function hourIndex(site: SiteData, utc: string | Date): number {
  return Math.floor((new Date(utc).getTime() - Date.parse(site.ephem.t0_utc)) / (3600000 * site.ephem.step_h));
}
export function timeAtIndex(site: SiteData, i: number): Date {
  return new Date(Date.parse(site.ephem.t0_utc) + i * site.ephem.step_h * 3600000);
}
export function getSeries(site: SiteData, a: Assumptions = DEFAULT_ASSUMPTIONS): Series {
  const key = JSON.stringify([site.id, a.heightM, a.dayFraction, a.earthMarginDeg]);
  const hit = cache.get(key);
  if (hit?.site === site) return hit.series;
  const mask = site.horizon.elev_cdeg[String(a.heightM)];
  if (!mask) throw new Error(`No horizon at height ${a.heightM} m for ${site.id}`);
  let angles = decoded.get(site);
  if (!angles) {
    const decode = (values: number[]) => Float32Array.from(values, v => v / 100);
    angles = { sunAz: decode(site.ephem.sun.az_cdeg), sunEl: decode(site.ephem.sun.el_cdeg),
      earthAz: decode(site.ephem.earth.az_cdeg), earthEl: decode(site.ephem.earth.el_cdeg) };
    decoded.set(site, angles);
  }
  const n = site.ephem.n;
  const s: Prepared = { ...angles, sunFrac: new Float32Array(n), earthVis: new Uint8Array(n),
    horizonSunEl: new Float32Array(n), horizonEarthEl: new Float32Array(n),
    lightSum: new Float64Array(n + 1), earthSum: new Uint32Array(n + 1),
    dayEnd: new Int32Array(n), earthEnd: new Int32Array(n), nextDark: new Int32Array(n + 1),
    nextEarthHidden: new Int32Array(n + 1), nextEarthVisible: new Int32Array(n + 1) };
  for (let i = 0; i < n; i++) {
    s.horizonSunEl[i] = horizonAt(mask, s.sunAz[i], site.horizon.az_step_deg);
    s.horizonEarthEl[i] = horizonAt(mask, s.earthAz[i], site.horizon.az_step_deg);
    s.sunFrac[i] = sunFraction(s.sunEl[i], s.horizonSunEl[i]);
    s.earthVis[i] = Number(s.earthEl[i] - s.horizonEarthEl[i] >= a.earthMarginDeg);
    s.lightSum[i + 1] = s.lightSum[i] + s.sunFrac[i];
    s.earthSum[i + 1] = s.earthSum[i] + s.earthVis[i];
  }
  s.nextDark[n] = s.nextEarthHidden[n] = s.nextEarthVisible[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    const day = s.sunFrac[i] >= a.dayFraction;
    s.dayEnd[i] = i + 1 < n && day === (s.sunFrac[i + 1] >= a.dayFraction) ? s.dayEnd[i + 1] : i + 1;
    s.earthEnd[i] = i + 1 < n && s.earthVis[i] === s.earthVis[i + 1] ? s.earthEnd[i + 1] : i + 1;
    s.nextDark[i] = day ? s.nextDark[i + 1] : i;
    s.nextEarthHidden[i] = s.earthVis[i] ? s.nextEarthHidden[i + 1] : i;
    s.nextEarthVisible[i] = s.earthVis[i] ? i : s.nextEarthVisible[i + 1];
  }
  cache.set(key, { site, series: s });
  return s;
}

// Windows use the containing hourly sample; their end is exclusive.
export function computeMetrics(site: SiteData, startUtc: string | Date, hours: number, a: Assumptions = DEFAULT_ASSUMPTIONS): Metrics {
  if (!Number.isFinite(hours) || hours < 0 || !Number.isFinite(new Date(startUtc).getTime())) throw new Error('Invalid metric window');
  const s = getSeries(site, a) as Prepared, n = site.ephem.n, step = site.ephem.step_h;
  const requested = hourIndex(site, startUtc);
  const start = Math.max(0, Math.min(n, requested));
  const end = Math.max(start, Math.min(n, Math.ceil(requested + hours / step)));
  let longestDayH = 0, longestNightH = 0;
  for (let i = start; i < end;) {
    const next = Math.min(end, s.dayEnd[i]), length = (next - i) * step;
    if (s.sunFrac[i] >= a.dayFraction) longestDayH = Math.max(longestDayH, length);
    else longestNightH = Math.max(longestNightH, length);
    i = next;
  }
  const count = end - start;
  const until = (indices: Int32Array) => start < n && indices[start] < n ? (indices[start] - start) * step : null;
  const visible = s.nextEarthVisible[start];
  return {
    startUtc: timeAtIndex(site, start).toISOString(), hours: count * step,
    lightPct: count ? 100 * (s.lightSum[end] - s.lightSum[start]) / count : 0,
    earthPct: count ? 100 * (s.earthSum[end] - s.earthSum[start]) / count : 0,
    longestDayH, longestNightH, hoursToSunset: until(s.nextDark), hoursToEarthset: until(s.nextEarthHidden),
    // A run still open at coverage end has an unknown duration.
    nextEarthWindow: visible < n && s.earthEnd[visible] < n ? {
      startUtc: timeAtIndex(site, visible).toISOString(), durationH: (s.earthEnd[visible] - visible) * step,
    } : null,
    sunElAtLandingDeg: start < n ? s.sunEl[start] - s.horizonSunEl[start] : 0,
  };
}
