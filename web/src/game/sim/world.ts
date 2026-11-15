// The surface simulation: clock + rover dynamics + thermal + power + what the rover sees of the
// Sun and Earth.
import { sunFraction } from '../../lib/sunFraction';
import { coverageEndMs, DEFAULT_WARP, type Ephemeris, MAX_DRIVE_WARP, MAX_SCREEN_TURN_DEG_S, type Sky, skyAt } from './clock';
import { type Field, normalAt } from './field';
import { newPower, panelW, type PowerState, stepPower, sunVector } from './power';
import { type DriveInput, newRover, type RoverState, stepRover } from './rover';
import { RULES } from './rules';
import { newThermal, stepThermal, type ThermalState } from './thermal';
import type { Horizon } from './visibility';

const MOVING_STEP_S = 0.1; // physics step while the rover moves or is commanded
const PARKED_STEP_S = 1; // while parked (thermal and power only)
export const SAFE_WARP = 60;

export interface World {
  tMs: number;
  warp: number;
  paused: boolean;
  rover: RoverState;
  power: PowerState;
  thermal: ThermalState;
  sky: Sky;
  sunHorizon: number; // deg, real horizon towards the Sun from the rover
  earthHorizon: number;
  sunFrac: number; // visible solar disk 0..1 at the rover's panel
  earthUp: boolean;
  panelW: number; // array output now (W)
  loadW: number; // power drawn now (W)
  overheated: boolean; // drives stopped to cool down
  ended: '' | 'frozen' | 'coverage';
  scans: number; // science scans done
  /** Set when fast time warp was cut back to SAFE_WARP so the player can react. */
  alert: '' | 'sunset' | 'lowBattery' | 'cold';
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

/** Electrical loads (W); all of it ends up as heat inside the rover. Nothing runs while dormant. */
function loads(rover: RoverState, power: PowerState, thermal: ThermalState) {
  if (power.dead) return 0;
  return RULES.power.hotelW + rover.driveW + (thermal.heaterOn ? RULES.power.heaterW : 0);
}

export function newWorld(env: Env, tMs: number, rover: RoverState = newRover()): World {
  const base = {
    tMs, rover, warp: DEFAULT_WARP as number, paused: false, power: newPower(), thermal: newThermal(),
    ended: '' as const, scans: 0, alert: '' as const, overheated: false, panelW: 0, loadW: RULES.power.hotelW as number,
  };
  const seen = observe(env, base);
  const up = normalAt(env.field, rover.x, rover.y);
  return { ...base, ...seen, panelW: panelW(seen.sunFrac, sunVector(seen.sky.sunAz, seen.sky.sunEl), up, base.thermal.tempC) };
}

/** Advance by `realDt` wall-clock seconds; the simulated time is realDt × warp. */
export function stepWorld(env: Env, w: World, input: DriveInput, realDt: number): World {
  if (w.paused || w.ended) return w;
  // Steering is limited in screen time so the rover stays controllable at any warp.
  const steerScale = Math.min(1, MAX_SCREEN_TURN_DEG_S / (RULES.rover.turnRate * w.warp));
  const canDrive = w.warp <= MAX_DRIVE_WARP && !w.power.dead && !w.overheated;
  const drive = canDrive ? { throttle: input.throttle, steer: input.steer * steerScale } : { throttle: 0, steer: 0 };
  let total = Math.min(realDt, 0.25) * w.warp; // a stalled tab must not skip hours
  let { rover, power, thermal, tMs, overheated } = w;
  const end = coverageEndMs(env.ephem);
  // Sun/Earth visibility and the Sun direction change slowly: evaluated once per frame.
  const seen = observe(env, { tMs, rover });
  const sun = sunVector(seen.sky.sunAz, seen.sky.sunEl);
  let inW = w.panelW, loadW = w.loadW;
  while (total > 1e-9) {
    const active = drive.throttle !== 0 || Math.abs(rover.speed) > 1e-4;
    const dt = Math.min(active ? MOVING_STEP_S : PARKED_STEP_S, total);
    rover = stepRover(env.field, rover, drive, dt);
    inW = panelW(seen.sunFrac, sun, normalAt(env.field, rover.x, rover.y), thermal.tempC);
    loadW = loads(rover, power, thermal);
    power = stepPower(power, inW, loadW, seen.earthUp, dt);
    thermal = stepThermal(thermal, seen.sunFrac, loadW, dt);
    if (thermal.tempC > RULES.thermal.hotC) overheated = true;
    else if (thermal.tempC < RULES.thermal.hotC - 10) overheated = false;
    tMs += dt * 1000;
    total -= dt;
    if (thermal.tempC < RULES.thermal.freezeC || tMs >= end) break;
  }
  const ended: World['ended'] = thermal.tempC < RULES.thermal.freezeC ? 'frozen' : tMs >= end ? 'coverage' : '';
  const next = { ...w, tMs: Math.min(tMs, end), rover, power, thermal, overheated, panelW: inW, loadW, ended };
  const after = { ...next, ...observe(env, next) };
  // Like a game autopilot: fast warp drops back when the Sun sets, the battery runs low or it gets cold.
  if (w.warp > SAFE_WARP) {
    const low = RULES.power.batteryWh * 0.25, cold = RULES.thermal.freezeC + 15;
    const alert: World['alert'] = w.sunFrac >= 0.01 && after.sunFrac < 0.01 ? 'sunset'
      : w.power.chargeWh >= low && power.chargeWh < low ? 'lowBattery'
        : w.thermal.tempC >= cold && thermal.tempC < cold ? 'cold' : '';
    if (alert) return { ...after, warp: SAFE_WARP, alert };
  }
  return after;
}

/** Why a science scan cannot run right now ('' when it can). */
export function scanBlocker(w: World): '' | 'moving' | 'battery' {
  if (Math.abs(w.rover.speed) > 1e-3) return 'moving';
  if (w.power.dead || w.power.chargeWh < RULES.science.scanWh + RULES.power.batteryWh * 0.05) return 'battery';
  return '';
}

/** Run a science scan: costs energy, adds data that must be sent to Earth. */
export function scan(w: World): World {
  if (scanBlocker(w) || w.ended) return w;
  const power = { ...w.power, chargeWh: w.power.chargeWh - RULES.science.scanWh, dataMB: w.power.dataMB + RULES.science.scanMB };
  return { ...w, power, scans: w.scans + 1 };
}
