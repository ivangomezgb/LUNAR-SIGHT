// Regolith dust on ballistic arcs. With no air on the Moon there is no drag and no lingering
// cloud: every grain flies a parabola under lunar gravity and stops where it meets the terrain.
// Each Dust is a pooled THREE.Points (live grains packed at the front of the buffers).
import * as THREE from 'three';
import { RULES } from '../sim/rules';

const MAX_AGE_S = 12;

/** Exact ballistic step (no drag): position and velocity after `dt` s under gravity `g`. */
export function ballisticStep(p: number[], v: number[], dt: number, g: number = RULES.gravity) {
  p[0] += v[0] * dt;
  p[1] += v[1] * dt;
  p[2] += v[2] * dt - 0.5 * g * dt * dt;
  v[2] -= g * dt;
}

export class Dust {
  readonly points: THREE.Points;
  private pos: Float32Array; // three.js coords (x east, y up, z south)
  private vel: Float32Array; // ENU (east, north, up)
  private col: Float32Array;
  private age: Float32Array;
  private live = 0;
  private cap: number;
  private carry = 0; // fractional grains carried between frames

  constructor(capacity: number, size = 0.09) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.points.frustumCulled = false;
  }

  get count() { return this.live; }

  /** Grain `i` position as ENU (east, north, up). */
  at(i: number): [number, number, number] { return [this.pos[i * 3], -this.pos[i * 3 + 2], this.pos[i * 3 + 1]]; }

  /** Add one grain at ENU (x, y, z) with ENU velocity; `light` 0..1 tints it by the sunlight it is in. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, light: number) {
    if (this.live >= this.cap) return;
    const i = this.live++, k = i * 3, b = 0.1 + 0.9 * light;
    this.pos[k] = x; this.pos[k + 1] = z; this.pos[k + 2] = -y;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = 0.81 * b; this.col[k + 1] = 0.78 * b; this.col[k + 2] = 0.71 * b;
    this.age[i] = 0;
  }

  /** How many grains to emit this frame for a steady `rate` per second (keeps the fraction). */
  quota(rate: number, dt: number): number {
    this.carry += Math.max(0, rate) * dt;
    const n = Math.floor(this.carry);
    this.carry -= n;
    return n;
  }

  /** Fly every grain `dt` s; it stops when it reaches the `ground` height (NaN outside = stop). */
  update(dt: number, ground: (x: number, y: number) => number) {
    const p = [0, 0, 0], v = [0, 0, 0];
    for (let i = 0; i < this.live; i++) {
      const k = i * 3;
      p[0] = this.pos[k]; p[1] = -this.pos[k + 2]; p[2] = this.pos[k + 1];
      v[0] = this.vel[k]; v[1] = this.vel[k + 1]; v[2] = this.vel[k + 2];
      ballisticStep(p, v, dt);
      this.age[i] += dt;
      const h = ground(p[0], p[1]);
      if (!(p[2] > h) || this.age[i] > MAX_AGE_S) { this.kill(i--); continue; }
      this.pos[k] = p[0]; this.pos[k + 1] = p[2]; this.pos[k + 2] = -p[1];
      this.vel[k] = v[0]; this.vel[k + 1] = v[1]; this.vel[k + 2] = v[2];
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.live);
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }

  /** Remove grain i by moving the last live grain into its slot. */
  private kill(i: number) {
    const last = --this.live;
    if (i === last) return;
    for (const a of [this.pos, this.vel, this.col]) a.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.age[i] = this.age[last];
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
