// Can also run under Node after tsc compilation with a synchronous `test` adapter.
import { test } from 'vitest';
import { DEFAULT_ENERGY_PARAMETERS, simulateEnergy } from '../energy';
import type { EnergyParameters } from '../energy';

const utc = '2027-01-12T06:00:00.000Z';
function near(actual: number, expected: number) {
  if (Math.abs(actual - expected) > 1e-8) throw new Error(`Expected ${expected}, got ${actual}`);
}
function assert(value: boolean) { if (!value) throw new Error('Assertion failed'); }
function run(fractions: number[], overrides: Partial<EnergyParameters> = {}, azimuths = fractions.map(() => 0),
  start = utc, hours = fractions.length) {
  return simulateEnergy({ sunFrac: Float32Array.from(fractions), sunAz: Float32Array.from(azimuths),
    sunEl: new Float32Array(fractions.length) }, utc, start, hours / 24,
  { ...DEFAULT_ENERGY_PARAMETERS, ...overrides });
}
test('constant sun: generation, curtailment and full battery', () => {
  const r = run(Array(24).fill(1));
  near(r.ratedPowerW, 1633.2); near(r.generatedKWh, 39.1968);
  near(r.generatedPerDayKWh, 39.1968); near(r.meanPowerW, 1633.2);
  near(r.minSocPct, 100); near(r.requiredBatteryKWh, 0); near(r.deficitHours, 0); assert(r.survives);
});
test('night outlasts battery: exact depletion and minimum capacity', () => {
  const r = run(Array(10).fill(0), { batteryKWh: 0.6, roundTripEfficiency: 1 });
  assert(!r.survives); assert(r.firstDepletionUtc === '2027-01-12T11:00:00.000Z');
  near(r.requiredBatteryKWh, 1.2); near(r.nightEnergyKWh, 1.2); near(r.longestNoSunH, 10);
  near(r.marginH!, -5); near(r.minSocPct, 0);
});
test('fixed panel opposite Sun produces no power but still draws day load', () => {
  const r = run([1, 1], { panelMode: 'fixed', panelAzDeg: 180, roundTripEfficiency: 1 });
  near(r.generatedKWh, 0); near(r.deficitHours, 2); near(r.requiredBatteryKWh, 0.6); near(r.longestNoSunH, 0);
  near(run([1], { panelMode: 'fixed', panelAzDeg: 60 }).meanPowerW, 816.6);
});
test('partial sunlight deficits use day load and discharge efficiency', () => {
  const r = run([0.125, 0, 1]);
  near(r.deficitHours, 2); near(r.requiredBatteryKWh, (0.3 - 1.6332 * 0.125 + 0.12) / Math.sqrt(0.9));
});
test('recharging resets drawdown; capacity is not sum of all deficits', () => {
  const r = run([0, 1, 0], { roundTripEfficiency: 1 });
  near(r.requiredBatteryKWh, 0.12); near(r.longestNoSunH, 1);
  assert(run([0, 1, 0], { roundTripEfficiency: 1, batteryKWh: 0.12 }).survives);
  assert(!run([0, 1, 0], { roundTripEfficiency: 1, batteryKWh: 0.119 }).survives);
});
test('insufficient recharge accumulates drawdown with charge losses', () => {
  const r = run([0, 1, 0], { areaM2: 1, efficiency: 0.3, roundTripEfficiency: 0.81 });
  near(r.requiredBatteryKWh, 2 * 0.12 / 0.9 - (0.4083 - 0.3) * 0.9);
});
test('partial boundary hours preserve landing time and clip night', () => {
  const r = run([0, 1], { roundTripEfficiency: 1 }, [0, 0], '2027-01-12T06:30:00Z', 1);
  near(r.longestNoSunH, 0.5); near(r.generatedKWh, 0.8166); near(r.deficitHours, 0.5);
});
test('zero load has undefined hour margin; empty battery works with sufficient sun', () => {
  assert(run([1], { batteryKWh: 0 }).survives);
  assert(run([0], { batteryKWh: 0, nightLoadW: 0 }).marginH === null);
});
test('unsupported coverage and invalid parameters are rejected', () => {
  for (const action of [() => run([1], {}, [0], utc, 2), () => run([1], { roundTripEfficiency: 0 }),
    () => run([1], { batteryKWh: -1 }), () => run([NaN]), () => run([1], {}, [0], 'bad')]) {
    let threw = false; try { action(); } catch { threw = true; } assert(threw);
  }
});
test('elevation incidence reduces tracking generation', () => {
  const r = simulateEnergy({ sunFrac: new Float32Array([1]), sunAz: new Float32Array([0]),
    sunEl: new Float32Array([60]) }, utc, utc, 1 / 24);
  near(r.meanPowerW, 816.6);
});
