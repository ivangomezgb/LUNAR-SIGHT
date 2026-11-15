import type { Series } from './metrics';

/** Planning heuristics, not flight-safety limits; see docs/assumptions.md. */
export const HIGH_MARGIN_DEG = 0.5;
export const MEDIUM_MARGIN_DEG = 1;
export const HIGH_SUNLIGHT_H = 48;
export const MEDIUM_SUNLIGHT_H = 96;
export const SUNSET_LOOKAHEAD_H = 24;
export const RISK_MASK_HEIGHT_M = 2;
export const DEFAULT_LANDER_HEIGHT_M = 4;

export interface LandingLightRisk {
  marginDeg: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  shadowAzimuthDeg: number;
  sunlightRemainingH: number | null;
  earthLossH: number | null;
  observedAheadH: number;
  obstacleShadowM: number | null;
  landerShadowM: number | null;
  landerHeightM: number;
  elevationRateDegH: number | null;
  sunsetWithin24H: boolean | null;
  level: 'low' | 'medium' | 'high';
  coverageLimited: boolean;
}

/** Geometric centre-ray shadow on a horizontal plane; null at/below horizontal. */
export function shadowLength(heightM: number, elevationDeg: number): number | null {
  if (!Number.isFinite(heightM) || heightM <= 0 || !Number.isFinite(elevationDeg)
    || elevationDeg < -90 || elevationDeg > 90) throw new RangeError('Invalid shadow geometry');
  if (elevationDeg <= 0) return null;
  return elevationDeg === 90 ? 0 : heightM / Math.tan(elevationDeg * Math.PI / 180);
}

/** Supply getSeries(site, {...assumptions, heightM: 2}); no interpolation of events. */
export function computeLandingRisk(series: Series, landingIndex: number, stepH = 1,
  landerHeightM = DEFAULT_LANDER_HEIGHT_M): LandingLightRisk {
  const n = series.sunFrac.length;
  if (!Number.isInteger(landingIndex) || landingIndex < 0 || landingIndex >= n
    || !Number.isFinite(stepH) || stepH <= 0
    || [series.sunEl, series.sunAz, series.earthVis, series.horizonSunEl,
      series.earthAz, series.earthEl, series.horizonEarthEl].some(a => a.length !== n)) throw new RangeError('Invalid landing sample or series');
  const i = landingIndex;
  const sunElevationDeg = series.sunEl[i];
  const marginDeg = sunElevationDeg - series.horizonSunEl[i];
  const sunAzimuthDeg = ((series.sunAz[i] % 360) + 360) % 360;
  if (![marginDeg, sunAzimuthDeg].every(Number.isFinite)) throw new RangeError('Invalid landing angles');
  let sunlightRemainingH: number | null = null;
  let earthLossH: number | null = null;
  let sunset = false;
  for (let j = i; j < n; j++) {
    if (!Number.isFinite(series.sunFrac[j]) || !Number.isFinite(series.earthVis[j])) {
      throw new RangeError('Invalid visibility sample');
    }
    const elapsed = (j - i) * stepH;
    if (sunlightRemainingH === null && series.sunFrac[j] <= 0) sunlightRemainingH = elapsed;
    if (earthLossH === null && !series.earthVis[j]) earthLossH = elapsed;
    if (j > i && elapsed <= SUNSET_LOOKAHEAD_H && series.sunFrac[j - 1] > 0 && series.sunFrac[j] <= 0) sunset = true;
  }
  const observedAheadH = (n - 1 - i) * stepH;
  const coverageLimited = sunlightRemainingH === null && observedAheadH < MEDIUM_SUNLIGHT_H;
  const high = marginDeg < HIGH_MARGIN_DEG || (sunlightRemainingH !== null && sunlightRemainingH < HIGH_SUNLIGHT_H);
  const medium = marginDeg < MEDIUM_MARGIN_DEG || (sunlightRemainingH !== null && sunlightRemainingH < MEDIUM_SUNLIGHT_H) || coverageLimited;
  const left = Math.max(0, i - 1), right = Math.min(n - 1, i + 1);
  const elevationRateDegH = right === left ? null : (series.sunEl[right] - series.sunEl[left]) / ((right - left) * stepH);
  if (elevationRateDegH !== null && !Number.isFinite(elevationRateDegH)) throw new RangeError('Invalid adjacent elevation');
  return {
    marginDeg, sunElevationDeg, sunAzimuthDeg, shadowAzimuthDeg: (sunAzimuthDeg + 180) % 360,
    sunlightRemainingH, earthLossH, observedAheadH,
    obstacleShadowM: shadowLength(1, sunElevationDeg), landerShadowM: shadowLength(landerHeightM, sunElevationDeg),
    landerHeightM, elevationRateDegH,
    sunsetWithin24H: sunset ? true : observedAheadH >= SUNSET_LOOKAHEAD_H ? false : null,
    level: high ? 'high' : medium ? 'medium' : 'low', coverageLimited,
  };
}
