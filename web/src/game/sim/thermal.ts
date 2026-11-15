// Lumped thermal model of the rover's electronics: absorbed sunlight + internal dissipation
// − radiation to the environment (εσA(T⁴ − T_sink⁴); colder sink in shadow). A thermostat runs
// the survival heater; below the freeze limit the rover is lost.
import { RULES } from './rules';

const SIGMA = 5.670374e-8; // W m⁻² K⁻⁴

export interface ThermalState {
  tempC: number;
  heaterOn: boolean;
}

export function newThermal(): ThermalState {
  return { tempC: RULES.thermal.startC, heaterOn: false };
}

/** Effective radiative sink temperature (K) for a visible solar fraction 0..1. */
export function sinkK(sunFrac: number): number {
  const th = RULES.thermal;
  return th.sinkShadowK + (th.sinkSunK - th.sinkShadowK) * Math.max(0, Math.min(1, sunFrac));
}

/** Net heat flow (W) into the rover at temperature tempC. */
export function heatFlowW(tempC: number, sunFrac: number, internalW: number): number {
  const th = RULES.thermal, T = tempC + 273.15, Ts = sinkK(sunFrac);
  const absorbed = th.absorptivity * RULES.power.solarWm2 * th.sunAreaM2 * sunFrac;
  const radiated = th.emissivity * SIGMA * th.radiatorM2 * (T ** 4 - Ts ** 4);
  return absorbed + internalW - radiated;
}

/** Advance `dt` s; `internalW` = all electrical power dissipated inside (avionics, drives, heater). */
export function stepThermal(s: ThermalState, sunFrac: number, internalW: number, dt: number): ThermalState {
  const th = RULES.thermal;
  const tempC = s.tempC + (heatFlowW(s.tempC, sunFrac, internalW) / th.capacityJK) * dt;
  const heaterOn = tempC < th.heaterOnC ? true : tempC > th.heaterOffC ? false : s.heaterOn;
  return { tempC, heaterOn };
}

/** Temperature (°C) where heat in = heat out, by bisection (for tests and the HUD forecast). */
export function equilibriumC(sunFrac: number, internalW: number): number {
  let lo = -270, hi = 300;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (heatFlowW(mid, sunFrac, internalW) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
