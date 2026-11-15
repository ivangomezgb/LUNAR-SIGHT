// Rover dynamics on the real height field under lunar gravity (1.62 m/s²):
// motor force limited by wheel–regolith traction (μ·N) and motor power, rolling resistance,
// and the downslope component of gravity. The climb limit (tan θ = μ − Crr ≈ 16.7°) and the
// slope where the rover can no longer hold and slides (tan θ = μ ≈ 24°) emerge from the forces.
import { type Field, heightAt, inNear, normalAt } from './field';
import { RULES } from './rules';

const DEG = Math.PI / 180;

export interface RoverState {
  x: number; // m east of the site
  y: number; // m north of the site
  heading: number; // deg from north, clockwise
  speed: number; // m/s along the heading, signed (reverse < 0)
  odometer: number; // m
  blocked: '' | 'slope' | 'edge' | 'tipped' | 'sliding';
  slip: boolean; // wheels at the traction limit
  driveW: number; // electrical power drawn by the drives this step (W)
}

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1 (left) .. 1 (right)
}

export function newRover(x = 0, y = 0, heading = 0): RoverState {
  return { x, y, heading, speed: 0, odometer: 0, blocked: '', slip: false, driveW: 0 };
}

/** Steepest grade (deg) the rover can climb: gravity + rolling resistance = traction. */
export const climbLimitDeg = () => Math.atan(RULES.rover.mu - RULES.rover.crr) / DEG;
/** Steepest slope (deg) where brakes can still hold the rover: gravity = traction. */
export const holdLimitDeg = () => Math.atan(RULES.rover.mu) / DEG;

/** Grade (deg, + uphill) of moving `d` metres along `heading` from (x, y); d < 0 = reversing. */
export function gradeAlong(f: Field, x: number, y: number, heading: number, d: number): number {
  const nx = x + d * Math.sin(heading * DEG), ny = y + d * Math.cos(heading * DEG);
  const dz = heightAt(f, nx, ny) - heightAt(f, x, y);
  return Math.atan2(dz, Math.abs(d)) / DEG;
}

/** Terrain angle (rad) rising along +heading, from a 2 m centred difference. */
function pitchAlong(f: Field, x: number, y: number, heading: number): number {
  const sx = Math.sin(heading * DEG), sy = Math.cos(heading * DEG);
  const dz = heightAt(f, x + sx, y + sy) - heightAt(f, x - sx, y - sy);
  return Math.atan2(dz, 2);
}

/** Cross slope (deg) at (x, y) for a rover facing `heading`. */
export function crossSlope(f: Field, x: number, y: number, heading: number): number {
  const [nx, ny, nz] = normalAt(f, x, y);
  const rightX = Math.cos(heading * DEG), rightY = -Math.sin(heading * DEG);
  return Math.atan2(nx * rightX + ny * rightY, nz) / DEG;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Advance the rover by `dt` simulated seconds (keep dt ≲ 0.1 s while moving). */
export function stepRover(f: Field, s: RoverState, input: DriveInput, dt: number): RoverState {
  const r = RULES.rover, g = RULES.gravity, m = r.massKg;
  if (s.blocked === 'tipped') return { ...s, speed: 0, driveW: 0, slip: false };
  const heading = (((s.heading + clamp(input.steer, -1, 1) * r.turnRate * dt) % 360) + 360) % 360;
  const th = pitchAlong(f, s.x, s.y, heading);
  const N = m * g * Math.cos(th), traction = r.mu * N, rolling = r.crr * N;
  const gravityAlong = -m * g * Math.sin(th); // force along +heading
  const target = clamp(input.throttle, -1, 1) * r.maxSpeed;
  const v = s.speed;
  // Ground force the speed controller asks for (gravity feed-forward included).
  const need = (m * (target - v)) / r.responseS - gravityAlong;
  let motor = 0, force: number, slip: boolean;
  if (target !== 0 && Math.sign(need) === Math.sign(target)) {
    // Driving: the motors push, limited by power and traction; rolling resistance (sinkage) is
    // an extra loss, so the climb limit is tan θ = μ − Crr.
    const dir = Math.sign(target);
    motor = need + dir * rolling;
    if (Math.abs(v) > 0.02) motor = clamp(motor, -r.motorW / Math.abs(v), r.motorW / Math.abs(v));
    slip = Math.abs(motor) > traction;
    motor = clamp(motor, -traction, traction);
    force = motor + gravityAlong;
    if (Math.abs(v) > 1e-4) force -= Math.sign(v) * rolling;
    else force = Math.abs(force) <= rolling ? 0 : force - Math.sign(force) * rolling; // static friction
  } else {
    // Braking or holding: the whole ground force is limited by traction (μN); beyond
    // tan θ = μ the wheels lock and the rover slides.
    slip = Math.abs(need) > traction;
    force = clamp(need, -traction, traction) + gravityAlong;
  }
  let speed = v + (force / m) * dt;
  if (target === 0 && v !== 0 && Math.sign(speed) !== Math.sign(v) && Math.abs(need) <= traction) speed = 0; // brakes stop, never reverse
  speed = clamp(speed, -r.maxSlideSpeed, r.maxSlideSpeed);

  let x = s.x + speed * dt * Math.sin(heading * DEG), y = s.y + speed * dt * Math.cos(heading * DEG);
  let blocked: RoverState['blocked'] = '';
  const inside = inNear(f, x, y) && Math.max(Math.abs(x), Math.abs(y)) <= f.near.half - r.edgeMarginM;
  if (!inside) { x = s.x; y = s.y; speed = 0; blocked = 'edge'; }
  const commanded = Math.sign(target), moving = Math.sign(speed);
  if (!blocked && Math.abs(th) > Math.atan(r.mu) && Math.abs(speed) > 0.01 && moving !== commanded) blocked = 'sliding';
  else if (!blocked && commanded !== 0 && slip && commanded * th > 0 && Math.abs(speed) < 0.05) blocked = 'slope';
  if (Math.abs(crossSlope(f, x, y, heading)) > r.tipDeg) blocked = 'tipped';
  const mech = Math.max(0, motor * speed);
  const driveW = Math.abs(speed) > 1e-3 || commanded !== 0 ? r.driveBaseW + mech / r.motorEff : 0;
  const d = Math.hypot(x - s.x, y - s.y);
  return { x, y, heading, speed, odometer: s.odometer + d, blocked, slip, driveW };
}
