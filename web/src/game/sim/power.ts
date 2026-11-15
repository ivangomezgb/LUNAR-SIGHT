// Solar array, battery and data link. The array is a vertical panel on a turntable facing the
// Sun's azimuth, so its incidence angle is the Sun's elevation above the rover's own (tilted)
// deck plane; output also follows the visible solar disk and the cell temperature.
import { RULES } from './rules';

export interface PowerState {
  chargeWh: number;
  dataMB: number; // collected, waiting for an Earth link
  sentMB: number;
  dead: boolean; // dormant: battery empty, all loads off until the panel revives it
}

export function newPower(): PowerState {
  return { chargeWh: RULES.power.batteryWh, dataMB: 0, sentMB: 0, dead: false };
}

/**
 * Array output (W). `sun` and `up` are unit vectors (east, north, up) of the Sun and of the rover
 * deck normal; `sunFrac` is the visible solar disk; `tempC` the cell temperature.
 */
export function panelW(sunFrac: number, sun: readonly number[], up: readonly number[], tempC: number): number {
  const p = RULES.power;
  const sUp = sun[0] * up[0] + sun[1] * up[1] + sun[2] * up[2];
  const cosI = Math.sqrt(Math.max(0, 1 - sUp * sUp)); // panel turns to the Sun's azimuth in its own plane
  const eff = Math.max(0, p.panelEff * (1 + p.panelTempCoef * (tempC - 28)));
  return p.solarWm2 * p.panelAreaM2 * eff * cosI * Math.max(0, Math.min(1, sunFrac));
}

/** Sun direction (east, north, up) from azimuth/elevation in degrees. */
export function sunVector(azDeg: number, elDeg: number): [number, number, number] {
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** Advance the battery: `inW` from the array, `loadW` drawn by the rover (ignored while dormant). */
export function stepPower(s: PowerState, inW: number, loadW: number, earthUp: boolean, dt: number): PowerState {
  const p = RULES.power;
  const net = s.dead ? inW : inW - loadW;
  const chargeWh = Math.max(0, Math.min(p.batteryWh, s.chargeWh + (net * dt) / 3600));
  const dead = s.dead ? chargeWh < p.batteryWh * p.reviveFrac : chargeWh <= 0;
  const sent = earthUp && !dead ? Math.min(s.dataMB, RULES.comms.downlinkMBps * dt) : 0;
  return { chargeWh, dataMB: s.dataMB - sent, sentMB: s.sentMB + sent, dead };
}
