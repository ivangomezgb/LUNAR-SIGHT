import { describe, expect, it } from 'vitest';
import { RULES } from '../../sim/rules';
import { ballisticStep, Dust } from '../dust';

const DEG = Math.PI / 180;

describe('ballistic dust', () => {
  it('a grain flies the vacuum parabola: apex v²sin²θ/2g and range v²sin2θ/g', () => {
    const g = RULES.gravity, v0 = 20, th = 10 * DEG;
    const p = [0, 0, 0], v = [v0 * Math.cos(th), 0, v0 * Math.sin(th)];
    let apex = 0;
    for (let k = 0; k < 10000 && p[2] >= 0; k++) { ballisticStep(p, v, 1 / 120); apex = Math.max(apex, p[2]); }
    expect(apex).toBeCloseTo((v0 * Math.sin(th)) ** 2 / (2 * g), 2);
    expect(p[0]).toBeCloseTo((v0 * v0 * Math.sin(2 * th)) / g, 0);
  });
  it('lunar dust flies six times higher than it would on Earth for the same throw', () => {
    const apexOn = (g: number) => { const p = [0, 0, 0], v = [0, 0, 1]; let a = 0; while (v[2] > 0) { ballisticStep(p, v, 1e-3, g); a = Math.max(a, p[2]); } return a; };
    expect(apexOn(RULES.gravity) / apexOn(9.81)).toBeCloseTo(9.81 / RULES.gravity, 1);
  });
  it('the pool lands grains on the terrain, recycles them and respects its capacity', () => {
    const d = new Dust(3);
    for (let k = 0; k < 5; k++) d.emit(0, 0, 0.01, k, 0, 1, 1);
    expect(d.count).toBe(3);
    d.update(0.5, () => 0);
    expect(d.count).toBe(3);
    const [x, , z] = d.at(1);
    expect(x).toBeCloseTo(0.5, 6);
    expect(z).toBeCloseTo(0.01 + 0.5 - 0.5 * RULES.gravity * 0.25, 5);
    d.update(1, () => 0); // total 1.5 s > time of flight 2/g ≈ 1.23 s
    expect(d.count).toBe(0);
  });
  it('emits a steady rate across uneven frames', () => {
    const d = new Dust(10);
    let n = 0;
    for (let k = 0; k < 60; k++) n += d.quota(50, k % 2 ? 0.01 : 0.0233);
    expect(n).toBe(Math.floor(50 * 30 * (0.01 + 0.0233)));
  });
});
