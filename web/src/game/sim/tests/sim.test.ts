import { describe, expect, it } from 'vitest';
import { getSeries } from '../../../lib/metrics';
import { sunFraction } from '../../../lib/sunFraction';
import { type Ephemeris, skyAt } from '../clock';
import { type Field, heightAt, makeField, makeGrid } from '../field';
import { netPowerW, newPower, stepPower } from '../power';
import { crossSlope, newRover, stepRover } from '../rover';
import { RULES } from '../rules';
import { makeHorizon } from '../visibility';
import { newWorld, stepWorld } from '../world';
import { hasRealData, loadRealSite } from './realData';

/** n x n grid of `res` m whose height is fn(x east, y north). */
function field(fn: (x: number, y: number) => number, n = 201, res = 10): Field {
  const z = Float32Array.from({ length: n * n }, (_, k) => fn(((k % n) - (n - 1) / 2) * res, ((n - 1) / 2 - Math.floor(k / n)) * res));
  const g = makeGrid({ n, res_m: res }, z);
  return { near: g, far: g };
}
const drive = (f: Field, throttle: number, steer: number, seconds: number, start = newRover()) => {
  let r = start;
  for (let t = 0; t < seconds; t++) r = stepRover(f, r, { throttle, steer }, 1);
  return r;
};

describe('rover', () => {
  it('accelerates to top speed and drives north on flat ground', () => {
    const r = drive(field(() => 0), 1, 0, 100);
    expect(r.speed).toBeCloseTo(RULES.rover.maxSpeed, 6);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeGreaterThan(15);
    expect(r.odometer).toBeCloseTo(r.y, 6);
  });
  it('turns clockwise with positive steer', () => {
    const r = drive(field(() => 0), 0, 1, 5);
    expect(r.heading).toBeCloseTo(5 * RULES.rover.turnRate, 6);
  });
  it('cannot climb steeper than the limit but can go down it', () => {
    const steep = field((_x, y) => Math.tan(20 * Math.PI / 180) * y); // 20 deg rising to the north
    const up = drive(steep, 1, 0, 50);
    expect(up.blocked).toBe('slope');
    expect(up.y).toBeCloseTo(0, 6);
    const down = drive(steep, 1, 0, 50, newRover(0, 0, 180));
    expect(down.y).toBeLessThan(-5);
    expect(down.blocked).toBe('');
  });
  it('stops at the edge of the detailed terrain', () => {
    const f = field(() => 0, 21, 10); // ±100 m
    const r = drive(f, 1, 0, 2000);
    expect(r.blocked).toBe('edge');
    expect(r.y).toBeLessThanOrEqual(f.near.half - RULES.rover.edgeMarginM + 1e-9);
  });
  it('tips over on a cross slope beyond the limit', () => {
    const f = field((x) => Math.tan(30 * Math.PI / 180) * x); // 30 deg rising to the east
    expect(Math.abs(crossSlope(f, 0, 0, 0))).toBeCloseTo(30, 3);
    expect(stepRover(f, newRover(), { throttle: 0, steer: 0 }, 1).blocked).toBe('tipped');
  });
});

describe('power and data', () => {
  it('charges in sunlight and drains in shadow', () => {
    expect(netPowerW(1, false)).toBeGreaterThan(0);
    expect(netPowerW(0, false)).toBeLessThan(netPowerW(0.005, false) + 1); // heater only in shadow
    let p = { ...newPower(), chargeWh: 1000 };
    p = stepPower(p, 1, false, false, 3600);
    expect(p.chargeWh).toBeCloseTo(1000 + RULES.power.panelW - RULES.power.hotelW, 6);
    const hoursLeft = RULES.power.batteryWh / -netPowerW(0, false);
    let dark = newPower();
    for (let h = 0; h < Math.ceil(hoursLeft) + 1; h++) dark = stepPower(dark, 0, false, false, 3600);
    expect(dark.dead).toBe(true);
  });
  it('sends data only while the Earth is in view', () => {
    const p = { ...newPower(), dataMB: 10 };
    expect(stepPower(p, 1, false, false, 10).sentMB).toBe(0);
    const sent = stepPower(p, 1, true, false, 10);
    expect(sent.sentMB).toBeCloseTo(RULES.comms.downlinkMBps * 10, 6);
    expect(sent.dataMB + sent.sentMB).toBeCloseTo(10, 6);
  });
});

describe('clock', () => {
  const e: Ephemeris = { t0Ms: 0, stepH: 1, n: 3, sunAz: [359, 1, 3], sunEl: [0, 1, 2], earthAz: [10, 20, 30], earthEl: [5, 5, 5] };
  it('interpolates angles across north', () => {
    const s = skyAt(e, 1800000);
    expect(s.sunAz).toBeCloseTo(0, 6);
    expect(s.sunEl).toBeCloseTo(0.5, 6);
    expect(s.earthAz).toBeCloseTo(15, 6);
    expect(skyAt(e, -1e9).sunEl).toBe(0); // clamped to coverage
  });
});

const real = hasRealData('connecting-ridge');
describe.skipIf(!real)('surface world on real data (connecting-ridge)', () => {
  it('sees from the site exactly what the published metrics see', () => {
    const { site, terrain } = loadRealSite('connecting-ridge');
    const f = makeField(terrain);
    const mask = site.horizon.elev_cdeg['2'];
    const series = getSeries(site, { heightM: 2, dayFraction: 0.5, earthMarginDeg: 0.5 });
    const ephem: Ephemeris = { t0Ms: Date.parse(site.ephem.t0_utc), stepH: site.ephem.step_h, n: site.ephem.n, ...series };
    const env = { field: f, horizon: makeHorizon(f, mask, site.horizon.az_step_deg, 2), ephem };
    let agree = 0, total = 0;
    for (let i = 0; i < site.ephem.n; i += 97) {
      const w = newWorld(env, ephem.t0Ms + i * 3600000);
      total++;
      if ((w.sunFrac >= 0.5) === (series.sunFrac[i] >= 0.5)) agree++;
    }
    console.info(`day/night agreement with the published series at the site: ${agree}/${total}`);
    expect(agree / total).toBeGreaterThan(0.97);
    expect(Number.isFinite(heightAt(f, 0, 0))).toBe(true);
  });
  it('drives, keeps time and spends energy', () => {
    const { site, terrain } = loadRealSite('connecting-ridge');
    const f = makeField(terrain);
    const series = getSeries(site, { heightM: 2, dayFraction: 0.5, earthMarginDeg: 0.5 });
    const ephem: Ephemeris = { t0Ms: Date.parse(site.ephem.t0_utc), stepH: 1, n: site.ephem.n, ...series };
    const env = { field: f, horizon: makeHorizon(f, site.horizon.elev_cdeg['2'], 0.5, 2), ephem };
    let w = { ...newWorld(env, Date.parse('2027-01-12T06:00:00Z')), warp: 60 };
    for (let k = 0; k < 600; k++) w = stepWorld(env, w, { throttle: 1, steer: 0 }, 1 / 60);
    expect(w.tMs - Date.parse('2027-01-12T06:00:00Z')).toBeCloseTo(600 / 60 * 60 * 1000, -1);
    expect(w.rover.odometer + (w.rover.blocked ? 1 : 0)).toBeGreaterThan(0);
    expect(w.sunFrac).toBeCloseTo(sunFraction(w.sky.sunEl, w.sunHorizon), 9);
  });
});

import { fmtLatLon, latLonToLocal, localToLatLon, parseLatLon, route } from '../geo';
describe('coordinates', () => {
  const site = { lat: -89.4472, lon: -137.354 };
  it('round-trips local offsets near the pole', () => {
    for (const [x, y] of [[0, 0], [3000, -1200], [-4500, 4500], [10, 5]]) {
      const ll = localToLatLon(site, x, y);
      const back = latLonToLocal(site, ll);
      expect(back.x).toBeCloseTo(x, 3);
      expect(back.y).toBeCloseTo(y, 3);
    }
  });
  it('moves north along the meridian by the arc length', () => {
    const p = localToLatLon({ lat: -85, lon: 30 }, 0, 1737400 * Math.PI / 180);
    expect(p.lat).toBeCloseTo(-84, 6);
    expect(p.lon).toBeCloseTo(30, 6);
  });
  it('parses and formats coordinates', () => {
    expect(parseLatLon('-89.45, -137.2')).toEqual({ lat: -89.45, lon: -137.2 });
    expect(parseLatLon('89.45 S 137.2 W')).toEqual({ lat: -89.45, lon: -137.2 });
    expect(parseLatLon('nope')).toBeNull();
    expect(fmtLatLon({ lat: -89.45, lon: -137.2 }, 2)).toBe('89.45° S, 137.20° W');
    expect(route(0, 0, 100, 0)).toEqual({ dist: 100, bearing: 90 });
  });
});

import { MAX_DRIVE_WARP, MAX_SCREEN_TURN_DEG_S } from '../clock';
describe('time warp and control', () => {
  it('keeps steering controllable on screen at any drivable warp', () => {
    const f = field(() => 0);
    const env = { field: f, horizon: { at: () => -90, farOnly: new Float32Array(0), azStep: 0.5 },
      ephem: { t0Ms: 0, stepH: 1, n: 10, sunAz: new Array(10).fill(0), sunEl: new Array(10).fill(5), earthAz: new Array(10).fill(0), earthEl: new Array(10).fill(5) } };
    for (const warp of [1, 60, MAX_DRIVE_WARP]) {
      let w = { ...newWorld(env, 0), warp };
      for (let k = 0; k < 60; k++) w = stepWorld(env, w, { throttle: 0, steer: 1 }, 1 / 60);
      expect(w.rover.heading).toBeLessThanOrEqual(MAX_SCREEN_TURN_DEG_S + 1e-6);
      expect(w.rover.heading).toBeGreaterThan(5);
    }
  });
  it('moves the real-speed rover warp times faster on screen', () => {
    const f = field(() => 0, 401, 10);
    const env = { field: f, horizon: { at: () => -90, farOnly: new Float32Array(0), azStep: 0.5 },
      ephem: { t0Ms: 0, stepH: 1, n: 100, sunAz: new Array(100).fill(0), sunEl: new Array(100).fill(5), earthAz: new Array(100).fill(0), earthEl: new Array(100).fill(5) } };
    let w = newWorld(env, 0);
    expect(w.warp).toBe(60);
    for (let k = 0; k < 120; k++) w = stepWorld(env, w, { throttle: 1, steer: 0 }, 1 / 60);
    expect(w.rover.y).toBeGreaterThan(20); // ~2 s of screen time at 60x ≈ 24 m
  });
});

import { allDone, newMission, pickWaypoint, score, updateMission } from '../mission';
import { scan, scanBlocker } from '../world';
describe('mission objectives', () => {
  const flatEnv = (sunEl: number, earthEl: number, n = 200) => ({
    field: field((x, y) => -Math.hypot(x - 300, y - 300) * 0.05 + 50, 401, 10), // gentle hill at (300, 300)
    horizon: { at: () => 0, farOnly: new Float32Array(0), azStep: 0.5 },
    ephem: { t0Ms: 0, stepH: 1, n, sunAz: new Array(n).fill(90), sunEl: new Array(n).fill(sunEl), earthAz: new Array(n).fill(0), earthEl: new Array(n).fill(earthEl) },
  });
  it('places the waypoint on the highest gentle point of the ring', () => {
    const env = flatEnv(5, 5);
    const wp = pickWaypoint(env.field, 900);
    expect(Math.hypot(wp.x, wp.y)).toBeCloseTo(900, 3);
    expect(Math.atan2(wp.x, wp.y) * 180 / Math.PI).toBeCloseTo(45, -1); // towards the hill
  });
  it('completes scan and downlink only with the Earth in view', () => {
    const env = flatEnv(5, 5);
    let w = newWorld(env, 0), m = newMission(env.field, 0);
    expect(scanBlocker(w)).toBe('');
    w = scan(scan(w));
    expect(w.scans).toBe(2);
    expect(w.power.dataMB).toBeCloseTo(4, 6);
    for (let k = 0; k < 120; k++) w = stepWorld(env, w, { throttle: 0, steer: 0 }, 1 / 60);
    const r = updateMission(m, w);
    m = r.mission;
    expect(r.completed).toEqual(expect.arrayContaining(['scan', 'downlink']));
    expect(m.done.drive).toBeUndefined();
    const dark = flatEnv(-5, -5);
    const wd = stepWorld(dark, scan(newWorld(dark, 0)), { throttle: 0, steer: 0 }, 1);
    const rd = updateMission(newMission(dark.field, 0), wd);
    expect(rd.completed).toEqual(expect.arrayContaining(['scan', 'shadow']));
    expect(rd.completed).not.toContain('downlink');
  });
  it('cannot scan while moving and scores completed missions higher', () => {
    const env = flatEnv(5, 5);
    const moving = stepWorld(env, newWorld(env, 0), { throttle: 1, steer: 0 }, 0.5);
    expect(scanBlocker(moving)).toBe('moving');
    const m = newMission(env.field, 0), w = newWorld(env, 0);
    const full = { ...m, done: { drive: 1, shadow: 1, scan: 1, downlink: 1, waypoint: 1, survive: 1 } };
    expect(allDone(full)).toBe(true);
    expect(score(full, w)).toBeGreaterThan(score(m, w) + 600);
  });
});

describe('fast warp safety', () => {
  it('drops back to a safe warp at sunset so the player can react', () => {
    const n = 48;
    const env = { field: field(() => 0), horizon: { at: () => 0, farOnly: new Float32Array(0), azStep: 0.5 },
      ephem: { t0Ms: 0, stepH: 1, n, sunAz: new Array(n).fill(0), sunEl: Array.from({ length: n }, (_, i) => (i < 3 ? 2 : -2)), earthAz: new Array(n).fill(0), earthEl: new Array(n).fill(5) } };
    let w = { ...newWorld(env, 0), warp: 36000 };
    for (let k = 0; k < 20 && !w.alert; k++) w = stepWorld(env, w, { throttle: 0, steer: 0 }, 1 / 60);
    expect(w.alert).toBe('sunset');
    expect(w.warp).toBe(60);
    expect(w.ended).toBe('');
  });
});

import { altitude, hoverThrottle, judge, newLander, stepLander } from '../lander';
describe('powered descent', () => {
  const flat = field(() => 100, 201, 10);
  it('free fall at lunar gravity ends in a crash', () => {
    let s = newLander(flat);
    expect(altitude(flat, s)).toBeCloseTo(RULES.lander.start.altitude, 6);
    for (let k = 0; k < 4000 && !s.landed; k++) s = stepLander(flat, s, { throttle: 0, east: 0, north: 0 }, 0.05);
    expect(s.landed).toBe('crash');
    expect(s.reason).toBe('speed');
  });
  it('the hover throttle holds altitude and burns fuel', () => {
    let s = { ...newLander(flat), vx: 0, vy: 0, vz: 0 };
    const z0 = s.z, f0 = s.fuelKg;
    for (let k = 0; k < 200; k++) s = stepLander(flat, s, { throttle: hoverThrottle(s), east: 0, north: 0 }, 0.05);
    expect(Math.abs(s.z - z0)).toBeLessThan(0.5);
    expect(s.fuelKg).toBeLessThan(f0);
  });
  it('a gentle vertical touchdown on flat ground is a landing', () => {
    let s = { ...newLander(flat), z: 100 + 5, vx: 0, vy: 0, vz: -1 };
    for (let k = 0; k < 400 && !s.landed; k++) s = stepLander(flat, s, { throttle: hoverThrottle(s) * 0.95, east: 0, north: 0 }, 0.05);
    expect(s.landed).toBe('ok');
    expect(s.touch!.vh).toBeLessThan(1e-9);
  });
  it('judges drift and slope at contact', () => {
    expect(judge(-1, 2, 2)).toEqual({ landed: 'crash', reason: 'drift' });
    expect(judge(-1, 0.2, 12)).toEqual({ landed: 'crash', reason: 'slope' });
    expect(judge(-1.5, 0.5, 5)).toEqual({ landed: 'ok', reason: '' });
  });
  it('RCS translates the lander and the engine stops without fuel', () => {
    let s = { ...newLander(flat), vx: 0, vy: 0 };
    s = stepLander(flat, s, { throttle: 0, east: 1, north: 0 }, 1);
    expect(s.vx).toBeCloseTo(RULES.lander.rcsAccel, 6);
    const dry = { ...s, fuelKg: 0 };
    expect(stepLander(flat, dry, { throttle: 1, east: 1, north: 0 }, 1).throttle).toBe(0);
  });
});

import { stoppingHeight } from '../lander';
describe('descent helper', () => {
  it('stopping height matches the kinematics at full throttle', () => {
    const s = { ...newLander(field(() => 0, 21, 10)), vz: -20 };
    const L = RULES.lander, net = L.maxThrustN / (L.dryKg + s.fuelKg) - RULES.gravity;
    expect(stoppingHeight(s)).toBeCloseTo(400 / (2 * net), 6);
    expect(stoppingHeight({ ...s, vz: 2 })).toBe(0);
    expect(stoppingHeight({ ...s, fuelKg: 0 })).toBe(Infinity);
  });
});

describe.skipIf(!hasRealData('connecting-ridge'))('descent on the real terrain', () => {
  it('a pilot using only the player controls can land softly on the target', () => {
    const { terrain } = loadRealSite('connecting-ridge');
    const f = makeField(terrain);
    let s = newLander(f);
    for (let k = 0; k < 20000 && !s.landed; k++) {
      const alt = altitude(f, s);
      const ax = -0.02 * s.x - 0.6 * s.vx, ay = -0.02 * s.y - 0.6 * s.vy;
      const near = Math.hypot(s.x, s.y) < 30 && Math.hypot(s.vx, s.vy) < 0.6;
      const want = near ? -Math.max(0.8, alt * 0.06) : alt > 60 ? -Math.max(2, alt * 0.06) : 0;
      // on/off keys, like the keyboard: full engine or nothing, RCS full or nothing
      s = stepLander(f, s, { throttle: s.vz < want ? 1 : 0, east: Math.abs(ax) > 0.3 ? Math.sign(ax) : 0, north: Math.abs(ay) > 0.3 ? Math.sign(ay) : 0 }, 0.02);
    }
    console.info(`real-terrain landing: ${s.landed} ${s.reason} at ${Math.hypot(s.x, s.y).toFixed(1)} m, touch vz ${s.touch?.vz.toFixed(2)} vh ${s.touch?.vh.toFixed(2)} slope ${s.touch?.slope.toFixed(1)}, fuel ${(100 * s.fuelKg / RULES.lander.fuelKg).toFixed(0)}%`);
    expect(s.landed).toBe('ok');
    expect(Math.hypot(s.x, s.y)).toBeLessThan(40);
    expect(s.fuelKg).toBeGreaterThan(0);
  });
  it('the brake cue comes early enough: obeying it from free fall still lands', () => {
    const { terrain } = loadRealSite('connecting-ridge');
    const f = makeField(terrain);
    let s = { ...newLander(f), x: 0, y: 0, vx: 0, vy: 0 };
    let cueAt = NaN;
    for (let k = 0; k < 20000 && !s.landed; k++) {
      const alt = altitude(f, s);
      const cue = alt > 3 && stoppingHeight(s) > alt * 0.7;
      if (cue && Number.isNaN(cueAt)) cueAt = alt;
      const braking = !Number.isNaN(cueAt);
      const throttle = !braking ? 0 : s.vz < -Math.max(0.8, alt * 0.05) ? 1 : 0;
      s = stepLander(f, s, { throttle, east: 0, north: 0 }, 0.02);
    }
    console.info(`brake cue at ${cueAt.toFixed(0)} m; touch vz ${s.touch?.vz.toFixed(2)}`);
    expect(cueAt).toBeGreaterThan(50);
    expect(s.landed).toBe('ok');
  });
});
