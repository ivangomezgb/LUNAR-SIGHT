// Powered descent onto the real terrain: lunar gravity, a throttleable main engine whose
// acceleration grows as fuel burns (rocket equation), lateral RCS, and touchdown checks
// against the real slope under the legs. Vehicle numbers are declared game assumptions (RULES).
import { type Field, heightAt, slopeDeg } from './field';
import { RULES } from './rules';

export interface LanderState {
  x: number; y: number; z: number; // m, site frame (z = absolute height in the terrain frame)
  vx: number; vy: number; vz: number; // m/s
  fuelKg: number;
  throttle: number; // 0..1 actually applied this step
  landed: '' | 'ok' | 'crash';
  reason: '' | 'speed' | 'drift' | 'slope';
  touch: { vz: number; vh: number; slope: number } | null; // values at contact
}

export interface LanderInput {
  throttle: number; // 0..1 main engine
  east: number; // -1..1 lateral RCS
  north: number; // -1..1
}

/** Start of the descent: above and off the target, still falling and drifting. */
export function newLander(f: Field, target = { x: 0, y: 0 }): LanderState {
  const s = RULES.lander.start;
  const x = target.x + s.offsetEast, y = target.y + s.offsetNorth;
  return {
    x, y, z: heightAt(f, target.x, target.y) + s.altitude,
    vx: s.vEast, vy: s.vNorth, vz: s.vDown,
    fuelKg: RULES.lander.fuelKg, throttle: 0, landed: '', reason: '', touch: null,
  };
}

/** Height above the terrain directly below (radar altitude). */
export function altitude(f: Field, s: LanderState): number {
  return s.z - heightAt(f, s.x, s.y);
}

/** Main-engine throttle that exactly cancels gravity at the current mass. */
export function hoverThrottle(s: LanderState): number {
  const L = RULES.lander;
  return Math.min(1, ((L.dryKg + s.fuelKg) * RULES.gravity) / L.maxThrustN);
}

/** Touchdown verdict from vertical speed, horizontal drift and the real slope under the legs. */
export function judge(vz: number, vh: number, slope: number): Pick<LanderState, 'landed' | 'reason'> {
  const L = RULES.lander;
  if (-vz > L.maxTouchVz) return { landed: 'crash', reason: 'speed' };
  if (vh > L.maxTouchVh) return { landed: 'crash', reason: 'drift' };
  if (!(slope <= L.maxSlopeDeg)) return { landed: 'crash', reason: 'slope' };
  return { landed: 'ok', reason: '' };
}

export function stepLander(f: Field, s: LanderState, input: LanderInput, dt: number): LanderState {
  if (s.landed) return s;
  const L = RULES.lander;
  const mass = L.dryKg + s.fuelKg;
  const hasFuel = s.fuelKg > 0;
  const throttle = hasFuel ? Math.max(0, Math.min(1, input.throttle)) : 0;
  const ex = hasFuel ? Math.max(-1, Math.min(1, input.east)) : 0, ny = hasFuel ? Math.max(-1, Math.min(1, input.north)) : 0;
  const thrust = throttle * L.maxThrustN;
  const az = thrust / mass - RULES.gravity;
  const burn = (thrust / (L.ispS * 9.80665) + (Math.abs(ex) + Math.abs(ny)) * L.rcsKgPerS) * dt;
  let vx = s.vx + ex * L.rcsAccel * dt, vy = s.vy + ny * L.rcsAccel * dt, vz = s.vz + az * dt;
  let x = s.x + vx * dt, y = s.y + vy * dt, z = s.z + vz * dt;
  const fuelKg = Math.max(0, s.fuelKg - burn);
  const ground = heightAt(f, x, y);
  if (Number.isFinite(ground) && z <= ground) {
    const vh = Math.hypot(vx, vy), slope = slopeDeg(f, x, y);
    z = ground;
    const verdict = judge(vz, vh, slope);
    const touch = { vz, vh, slope };
    vx = vy = vz = 0;
    return { x, y, z, vx, vy, vz, fuelKg, throttle, ...verdict, touch };
  }
  // keep the vehicle over the mapped terrain
  const edge = f.near.half - RULES.rover.edgeMarginM;
  if (Math.abs(x) > edge) { x = Math.sign(x) * edge; vx = 0; }
  if (Math.abs(y) > edge) { y = Math.sign(y) * edge; vy = 0; }
  return { ...s, x, y, z, vx, vy, vz, fuelKg, throttle };
}

/**
 * Autopilot with the same on/off controls a player has (full engine or nothing, RCS full or
 * nothing): null the drift over the target, descend at ~6 % of the altitude per second, then
 * settle slowly. Tested to land softly on the real terrain.
 */
export function autopilot(f: Field, s: LanderState, target = { x: 0, y: 0 }): LanderInput {
  const alt = altitude(f, s), dx = s.x - target.x, dy = s.y - target.y;
  const ax = -0.02 * dx - 0.6 * s.vx, ay = -0.02 * dy - 0.6 * s.vy;
  const near = Math.hypot(dx, dy) < 30 && Math.hypot(s.vx, s.vy) < 0.6;
  const want = near ? -Math.max(0.8, alt * 0.06) : alt > 60 ? -Math.max(2, alt * 0.06) : 0;
  return { throttle: s.vz < want ? 1 : 0, east: Math.abs(ax) > 0.3 ? Math.sign(ax) : 0, north: Math.abs(ay) > 0.3 ? Math.sign(ay) : 0 };
}

/** Height (m) needed to stop the current descent rate at full throttle (∞ if the engine cannot). */
export function stoppingHeight(s: LanderState): number {
  const L = RULES.lander;
  const net = (L.maxThrustN / (L.dryKg + s.fuelKg)) - RULES.gravity;
  if (s.vz >= 0) return 0;
  return net > 0 && s.fuelKg > 0 ? (s.vz * s.vz) / (2 * net) : Infinity;
}
