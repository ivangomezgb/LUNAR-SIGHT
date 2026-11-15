// Rover driving over the real height field: speed, steering, climb limit and tip-over.
import { type Field, heightAt, inNear, normalAt } from './field';
import { RULES } from './rules';

const DEG = Math.PI / 180;

export interface RoverState {
  x: number; // m east of the site
  y: number; // m north of the site
  heading: number; // deg from north, clockwise
  speed: number; // m/s, signed (reverse < 0)
  odometer: number; // m
  blocked: '' | 'slope' | 'edge' | 'tipped';
}

export interface DriveInput {
  throttle: number; // -1..1
  steer: number; // -1 (left) .. 1 (right)
}

export function newRover(x = 0, y = 0, heading = 0): RoverState {
  return { x, y, heading, speed: 0, odometer: 0, blocked: '' };
}

/** Grade (deg, + uphill) of moving `d` metres along `heading` from (x, y); d < 0 = reversing. */
export function gradeAlong(f: Field, x: number, y: number, heading: number, d: number): number {
  const nx = x + d * Math.sin(heading * DEG), ny = y + d * Math.cos(heading * DEG);
  const dz = heightAt(f, nx, ny) - heightAt(f, x, y);
  return Math.atan2(dz, Math.abs(d)) / DEG;
}

/** Cross slope (deg) at (x, y) for a rover facing `heading`. */
export function crossSlope(f: Field, x: number, y: number, heading: number): number {
  const [nx, ny, nz] = normalAt(f, x, y);
  const rightX = Math.cos(heading * DEG), rightY = -Math.sin(heading * DEG);
  return Math.atan2(nx * rightX + ny * rightY, nz) / DEG;
}

/** Advance the rover by `dt` simulated seconds. Never moves it into blocked terrain. */
export function stepRover(f: Field, s: RoverState, input: DriveInput, dt: number): RoverState {
  const r = RULES.rover;
  if (s.blocked === 'tipped') return { ...s, speed: 0 };
  const target = Math.max(-1, Math.min(1, input.throttle)) * r.maxSpeed;
  const dv = Math.max(-r.accel * dt, Math.min(r.accel * dt, target - s.speed));
  let speed = s.speed + dv;
  // steer like a skid-steer: turning works even when stopped
  const heading = (((s.heading + Math.max(-1, Math.min(1, input.steer)) * r.turnRate * dt) % 360) + 360) % 360;
  const d = speed * dt;
  let { x, y } = s;
  let blocked: RoverState['blocked'] = '';
  if (d !== 0) {
    const nx = x + d * Math.sin(heading * DEG), ny = y + d * Math.cos(heading * DEG);
    const inside = inNear(f, nx, ny) && Math.max(Math.abs(nx), Math.abs(ny)) <= f.near.half - r.edgeMarginM;
    const grade = gradeAlong(f, x, y, heading, d);
    if (!inside) blocked = 'edge';
    else if (grade > r.maxClimbDeg) blocked = 'slope';
    if (blocked) speed = 0;
    else { x = nx; y = ny; }
  }
  if (Math.abs(crossSlope(f, x, y, heading)) > r.tipDeg) blocked = 'tipped';
  return { x, y, heading, speed, odometer: s.odometer + (blocked ? 0 : Math.abs(d)), blocked };
}
