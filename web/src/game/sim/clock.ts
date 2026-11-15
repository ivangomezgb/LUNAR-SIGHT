// Mission clock: simulated UTC time, time warp, and the real Sun/Earth directions at that time
// (hourly SPICE ephemerides of the site, interpolated in between).
import { lerpAngle } from '../../components/series';

export const WARPS = [1, 10, 60, 600, 3600] as const;
/** Driving is only allowed up to this warp (like parking the rover before a long time skip). */
export const MAX_DRIVE_WARP = 60;

export interface Ephemeris {
  t0Ms: number;
  stepH: number;
  n: number;
  sunAz: ArrayLike<number>;
  sunEl: ArrayLike<number>;
  earthAz: ArrayLike<number>;
  earthEl: ArrayLike<number>;
}

export interface Sky {
  sunAz: number;
  sunEl: number;
  earthAz: number;
  earthEl: number;
}

/** Fractional ephemeris index of a time, clamped to the published coverage. */
export function ephemIndex(e: Ephemeris, tMs: number): number {
  const i = (tMs - e.t0Ms) / (e.stepH * 3600000);
  return Math.max(0, Math.min(e.n - 1, i));
}

export function skyAt(e: Ephemeris, tMs: number): Sky {
  const x = ephemIndex(e, tMs);
  const i = Math.min(e.n - 2, Math.floor(x)), f = x - i;
  const lin = (a: ArrayLike<number>) => a[i] + (a[i + 1] - a[i]) * f;
  return {
    sunAz: lerpAngle(e.sunAz[i], e.sunAz[i + 1], f),
    sunEl: lin(e.sunEl),
    earthAz: lerpAngle(e.earthAz[i], e.earthAz[i + 1], f),
    earthEl: lin(e.earthEl),
  };
}

/** Last instant with ephemerides. */
export function coverageEndMs(e: Ephemeris): number {
  return e.t0Ms + (e.n - 1) * e.stepH * 3600000;
}
