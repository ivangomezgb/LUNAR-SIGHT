import type { Assumptions, SiteData } from '../lib/types';
import { getSeries, hourIndex } from '../lib/metrics';

export type SeriesT = ReturnType<typeof getSeries>;

/** Fall back to the 2 m horizon (or the first available) when a site lacks the selected height. */
export function assumptionsFor(site: SiteData, a: Assumptions): Assumptions {
  const keys = Object.keys(site.horizon.elev_cdeg);
  if (keys.includes(String(a.heightM))) return a;
  const h = keys.includes('2') ? 2 : Number(keys[0] ?? 2);
  return { ...a, heightM: h };
}

export function seriesFor(site: SiteData, a: Assumptions): SeriesT {
  return getSeries(site, assumptionsFor(site, a));
}

export function nHours(site: SiteData): number {
  return site.ephem.n;
}

/** Data coverage [start, end) as epoch ms. */
export function coverage(site: { ephem: { t0_utc: string; n: number; step_h: number } }): [number, number] {
  const t0 = Date.parse(site.ephem.t0_utc);
  return [t0, t0 + site.ephem.n * site.ephem.step_h * 3600_000];
}

export function startIndex(site: SiteData, utc: string | Date): number {
  return hourIndex(site, utc);
}

/** Hours from fractional index `pos` to the first index > pos whose state differs from state at floor(pos). */
export function hoursToChange(isOn: (i: number) => boolean, pos: number, n: number): { on: boolean; hours: number | null } {
  const i0 = Math.floor(pos);
  if (i0 < 0 || i0 >= n) return { on: false, hours: null };
  const on = isOn(i0);
  for (let i = i0 + 1; i < n; i++) {
    if (isOn(i) !== on) return { on, hours: i - pos };
  }
  return { on, hours: null };
}

export function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (((a + d * f) % 360) + 360) % 360;
}
