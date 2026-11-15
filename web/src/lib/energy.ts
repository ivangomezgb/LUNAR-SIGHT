import { DEFAULT_ASSUMPTIONS, getSeries } from './metrics';
import type { Series } from './metrics';
import type { Assumptions, SiteData } from './types';

/** Illustrative engineering assumptions, not a qualified spacecraft design. */
export const SOLAR_CONSTANT_W_M2 = 1361;
export const NO_SUN_FRACTION = 0;
export const INITIAL_SOC_FRACTION = 1;
export const ENERGY_STEP_H = 1;
export const DEFAULT_ENERGY_PARAMETERS = {
  panelMode: 'tracking' as 'tracking' | 'fixed',
  areaM2: 4, efficiency: 0.3, panelAzDeg: 0,
  dayLoadW: 300, nightLoadW: 120, batteryKWh: 15, roundTripEfficiency: 0.9,
};
export type EnergyParameters = typeof DEFAULT_ENERGY_PARAMETERS;
export interface EnergyPoint { elapsedH: number; storedKWh: number }
export interface NightPeriod { startH: number; endH: number }
export interface EnergyResult {
  generatedKWh: number; generatedPerDayKWh: number; meanPowerW: number;
  deficitHours: number; longestNoSunH: number; nightEnergyKWh: number;
  minSocPct: number; survives: boolean; firstDepletionUtc: string | null;
  requiredBatteryKWh: number; marginH: number | null; ratedPowerW: number;
  points: EnergyPoint[]; nights: NightPeriod[]; hours: number;
}

/** Piecewise-constant hourly samples; integrate exact overlaps with [start, end). */
export function simulateEnergy(series: Pick<Series, 'sunFrac' | 'sunAz' | 'sunEl'>,
  seriesStartUtc: string, startUtc: string, missionDays: number,
  p: EnergyParameters = DEFAULT_ENERGY_PARAMETERS): EnergyResult {
  const base = Date.parse(seriesStartUtc), start = Date.parse(startUtc);
  const hours = missionDays * 24, offset = (start - base) / 3600000;
  const n = series.sunFrac.length;
  if (![base, start, hours, ...Object.values(p).filter(v => typeof v === 'number')].every(Number.isFinite)
    || hours <= 0 || offset < 0 || offset + hours > n * ENERGY_STEP_H
    || series.sunAz.length !== n || series.sunEl.length !== n
    || !['tracking', 'fixed'].includes(p.panelMode)
    || p.areaM2 < 0 || p.efficiency < 0 || p.efficiency > 1
    || p.dayLoadW < 0 || p.nightLoadW < 0 || p.batteryKWh < 0
    || p.roundTripEfficiency <= 0 || p.roundTripEfficiency > 1) throw new RangeError('Invalid energy inputs or incomplete coverage');
  const eta = Math.sqrt(p.roundTripEfficiency);
  const ratedPowerW = SOLAR_CONSTANT_W_M2 * p.areaM2 * p.efficiency;
  let stored = p.batteryKWh * INITIAL_SOC_FRACTION, minimum = stored;
  let generatedKWh = 0, deficitHours = 0, longestNoSunH = 0;
  let drawdown = 0, requiredBatteryKWh = 0, firstDepletionUtc: string | null = null;
  const points: EnergyPoint[] = [{ elapsedH: 0, storedKWh: stored }], nights: NightPeriod[] = [];
  for (let elapsed = 0; elapsed < hours;) {
    const index = Math.floor((offset + elapsed) / ENERGY_STEP_H);
    const dt = Math.min(hours - elapsed, (index + 1) * ENERGY_STEP_H - offset - elapsed);
    const fraction = series.sunFrac[index], elevation = series.sunEl[index], azimuth = series.sunAz[index];
    if (![fraction, elevation, azimuth].every(Number.isFinite) || fraction < 0 || fraction > 1
      || Math.abs(elevation) > 90) throw new RangeError('Invalid solar sample');
    const night = fraction <= NO_SUN_FRACTION;
    const incidence = Math.cos(elevation * Math.PI / 180)
      * (p.panelMode === 'fixed' ? Math.cos((azimuth - p.panelAzDeg) * Math.PI / 180) : 1);
    const powerW = ratedPowerW * fraction * Math.max(0, incidence);
    const netKWh = (powerW - (night ? p.nightLoadW : p.dayLoadW)) * dt / 1000;
    const change = netKWh >= 0 ? netKWh * eta : netKWh / eta;
    generatedKWh += powerW * dt / 1000;
    if (netKWh < 0) deficitHours += dt;
    // Maximum drawdown is the exact minimum capacity with an initially full battery,
    // unrestricted charge/discharge power and surplus curtailment at capacity.
    drawdown = Math.max(0, drawdown - change);
    requiredBatteryKWh = Math.max(requiredBatteryKWh, drawdown);
    if (stored + change < 0 && firstDepletionUtc === null) {
      firstDepletionUtc = new Date(start + (elapsed + dt * stored / -change) * 3600000).toISOString();
    }
    stored = Math.max(0, Math.min(p.batteryKWh, stored + change));
    minimum = Math.min(minimum, stored);
    if (night) {
      const previous = nights[nights.length - 1];
      if (previous && previous.endH === elapsed) previous.endH = elapsed + dt;
      else nights.push({ startH: elapsed, endH: elapsed + dt });
      const run = nights[nights.length - 1];
      longestNoSunH = Math.max(longestNoSunH, run.endH - run.startH);
    }
    elapsed += dt;
    points.push({ elapsedH: elapsed, storedKWh: stored });
  }
  return { generatedKWh, generatedPerDayKWh: generatedKWh / missionDays,
    meanPowerW: generatedKWh * 1000 / hours, deficitHours, longestNoSunH,
    nightEnergyKWh: longestNoSunH * p.nightLoadW / 1000 / eta,
    minSocPct: p.batteryKWh > 0 ? minimum / p.batteryKWh * 100 : 0,
    survives: firstDepletionUtc === null, firstDepletionUtc, requiredBatteryKWh,
    marginH: p.nightLoadW > 0 ? (p.batteryKWh - requiredBatteryKWh) * eta * 1000 / p.nightLoadW : null,
    ratedPowerW, points, nights, hours };
}

export function computeEnergy(site: SiteData, utc: string, missionDays: number,
  parameters: EnergyParameters = DEFAULT_ENERGY_PARAMETERS, assumptions: Assumptions = DEFAULT_ASSUMPTIONS): EnergyResult {
  if (site.ephem.step_h !== ENERGY_STEP_H || site.ephem.n !== site.ephem.sun.az_cdeg.length)
    throw new RangeError('Energy model requires hourly data');
  return simulateEnergy(getSeries(site, assumptions), site.ephem.t0_utc, utc, missionDays, parameters);
}
