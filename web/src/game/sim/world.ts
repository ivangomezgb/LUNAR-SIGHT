// The surface simulation: clock + rover + power + what the rover sees of the Sun and Earth.
import { sunFraction } from '../../lib/sunFraction';
import { coverageEndMs, DEFAULT_WARP, type Ephemeris, MAX_DRIVE_WARP, MAX_SCREEN_TURN_DEG_S, type Sky, skyAt } from './clock';
import type { Field } from './field';
import { newPower, type PowerState, stepPower } from './power';
import { type DriveInput, newRover, type RoverState, stepRover } from './rover';
import { RULES } from './rules';
import type { Horizon } from './visibility';

const MAX_SUBSTEP_S = 1; // simulated seconds per physics substep
export const SAFE_WARP = 60;

export interface World {
  tMs: number;
  warp: number;
  paused: boolean;
  rover: RoverState;
  power: PowerState;
  sky: Sky;
  sunHorizon: number; // deg, real horizon towards the Sun from the rover
  earthHorizon: number;
  sunFrac: number; // visible solar disk 0..1 at the rover's panel
  earthUp: boolean;
  ended: '' | 'battery' | 'coverage';
  scans: number; // science scans done
  /** Set when fast time warp was cut back to SAFE_WARP so the player can react. */
  alert: '' | 'sunset' | 'lowBattery';
}

export interface Env {
  field: Field;
  horizon: Horizon;
  ephem: Ephemeris;
}

function observe(env: Env, w: Pick<World, 'tMs' | 'rover'>) {
  const sky = skyAt(env.ephem, w.tMs);
  const sunHorizon = env.horizon.at(w.rover.x, w.rover.y, sky.sunAz);
  const earthHorizon = env.horizon.at(w.rover.x, w.rover.y, sky.earthAz);
  return {
    sky, sunHorizon, earthHorizon,
    sunFrac: sunFraction(sky.sunEl, sunHorizon),
    earthUp: sky.earthEl - earthHorizon >= RULES.comms.earthMarginDeg,
  };
}

export function newWorld(env: Env, tMs: number, rover: RoverState = newRover()): World {
  const base = { tMs, rover, warp: DEFAULT_WARP as number, paused: false, power: newPower(), ended: '' as const, scans: 0, alert: '' as const };
  return { ...base, ...observe(env, base) };
}

/** Advance by `realDt` wall-clock seconds; the simulated time is realDt × warp. */
export function stepWorld(env: Env, w: World, input: DriveInput, realDt: number): World {
  if (w.paused || w.ended) return w;
  // Steering is limited in screen time so the rover stays controllable at any warp.
  const steerScale = Math.min(1, MAX_SCREEN_TURN_DEG_S / (RULES.rover.turnRate * w.warp));
  const drive = w.warp <= MAX_DRIVE_WARP ? { throttle: input.throttle, steer: input.steer * steerScale } : { throttle: 0, steer: 0 };
  let total = Math.min(realDt, 0.25) * w.warp; // a stalled tab must not skip hours
  let { rover, power, tMs } = w;
  const end = coverageEndMs(env.ephem);
  // Sun and Earth visibility is evaluated once per frame (it changes slowly) and held in substeps.
  const seen = observe(env, { tMs, rover });
  while (total > 1e-9) {
    const dt = Math.min(MAX_SUBSTEP_S, total);
    rover = stepRover(env.field, rover, drive, dt);
    power = stepPower(power, seen.sunFrac, seen.earthUp, Math.abs(rover.speed) > 1e-3, dt);
    tMs += dt * 1000;
    total -= dt;
    if (power.dead || tMs >= end) break;
  }
  const next = { ...w, tMs: Math.min(tMs, end), rover, power };
  const after = { ...next, ...observe(env, next), ended: (power.dead ? 'battery' : tMs >= end ? 'coverage' : '') as World['ended'] };
  // Like a game autopilot: fast warp drops back when the Sun sets or the battery runs low.
  if (w.warp > SAFE_WARP) {
    const low = RULES.power.batteryWh * 0.25;
    const alert = w.sunFrac >= 0.01 && after.sunFrac < 0.01 ? 'sunset' : w.power.chargeWh >= low && power.chargeWh < low ? 'lowBattery' : '';
    if (alert) return { ...after, warp: SAFE_WARP, alert };
  }
  return after;
}

/** Why a science scan cannot run right now ('' when it can). */
export function scanBlocker(w: World): '' | 'moving' | 'battery' {
  if (Math.abs(w.rover.speed) > 1e-3) return 'moving';
  if (w.power.chargeWh < RULES.science.scanWh + RULES.power.batteryWh * 0.05) return 'battery';
  return '';
}

/** Run a science scan: costs energy, adds data that must be sent to Earth. */
export function scan(w: World): World {
  if (scanBlocker(w) || w.ended) return w;
  const power = { ...w.power, chargeWh: w.power.chargeWh - RULES.science.scanWh, dataMB: w.power.dataMB + RULES.science.scanMB };
  return { ...w, power, scans: w.scans + 1 };
}
