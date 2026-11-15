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
