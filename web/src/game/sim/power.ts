// Battery and data link. Inputs come from the real Sun/Earth visibility at the rover.
import { RULES } from './rules';

export interface PowerState {
  chargeWh: number;
  dataMB: number; // collected, waiting for an Earth link
  sentMB: number;
  dead: boolean;
}

export function newPower(): PowerState {
  return { chargeWh: RULES.power.batteryWh, dataMB: 0, sentMB: 0, dead: false };
}

/** Net power (W) for a visible solar-disk fraction `sun` (0..1) and whether the rover moves. */
export function netPowerW(sun: number, moving: boolean): number {
  const p = RULES.power;
  return p.panelW * sun - p.hotelW - (moving ? p.driveW : 0) - (sun < 0.01 ? p.heaterW : 0);
}

export function stepPower(s: PowerState, sun: number, earthUp: boolean, moving: boolean, dt: number): PowerState {
  if (s.dead) return s;
  const chargeWh = Math.min(RULES.power.batteryWh, s.chargeWh + (netPowerW(sun, moving) * dt) / 3600);
  const sent = earthUp ? Math.min(s.dataMB, RULES.comms.downlinkMBps * dt) : 0;
  return { chargeWh: Math.max(0, chargeWh), dataMB: s.dataMB - sent, sentMB: s.sentMB + sent, dead: chargeWh <= 0 };
}
