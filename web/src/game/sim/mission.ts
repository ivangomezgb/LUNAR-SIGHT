// Mission objectives: each one is a short lesson about the real science of the lunar south pole.
// Objectives and the waypoint are GAME elements, chosen deterministically from the real terrain.
import { type Field, heightAt, slopeDeg } from './field';
import { RULES } from './rules';
import type { World } from './world';

export type ObjectiveId = 'drive' | 'shadow' | 'scan' | 'downlink' | 'waypoint' | 'survive';
export const OBJECTIVES: ObjectiveId[] = ['drive', 'shadow', 'scan', 'downlink', 'waypoint', 'survive'];

export interface MissionState {
  startMs: number;
  waypoint: { x: number; y: number };
  done: Partial<Record<ObjectiveId, number>>; // objective -> simulated time it was completed
}

/** Highest gentle (≤ 12°) point on a ring around the site: a hill that keeps the Sun longer. */
export function pickWaypoint(f: Field, ringM: number = RULES.mission.waypointRingM): { x: number; y: number } {
  let best = { x: 0, y: ringM }, bestZ = -Infinity;
  for (let k = 0; k < 72; k++) {
    const a = (k * 5 * Math.PI) / 180, x = ringM * Math.sin(a), y = ringM * Math.cos(a);
    const z = heightAt(f, x, y), s = slopeDeg(f, x, y);
    if (Number.isFinite(z) && s <= 12 && z > bestZ) { bestZ = z; best = { x, y }; }
  }
  return best;
}

export function newMission(f: Field, startMs: number): MissionState {
  return { startMs, waypoint: pickWaypoint(f), done: {} };
}

/** Which objectives the world state satisfies right now. */
export function satisfied(m: MissionState, w: World): Record<ObjectiveId, boolean> {
  const r = RULES.mission;
  return {
    drive: w.rover.odometer >= r.driveM,
    shadow: w.sunFrac < 0.01,
    scan: w.scans >= 1,
    downlink: w.power.sentMB >= r.downlinkMB,
    waypoint: Math.hypot(w.rover.x - m.waypoint.x, w.rover.y - m.waypoint.y) <= r.waypointRadiusM,
    survive: !w.ended && w.tMs - m.startMs >= r.surviveH * 3600000,
  };
}

/** Record newly completed objectives; returns the same object when nothing changed. */
export function updateMission(m: MissionState, w: World): { mission: MissionState; completed: ObjectiveId[] } {
  const now = satisfied(m, w);
  const completed = OBJECTIVES.filter((id) => now[id] && m.done[id] === undefined);
  if (!completed.length) return { mission: m, completed };
  const done = { ...m.done };
  for (const id of completed) done[id] = w.tMs;
  return { mission: { ...m, done }, completed };
}

export function allDone(m: MissionState): boolean {
  return OBJECTIVES.every((id) => m.done[id] !== undefined);
}

/** 0–1000: objectives first, then data returned, distance and energy left. */
export function score(m: MissionState, w: World): number {
  const objectives = OBJECTIVES.filter((id) => m.done[id] !== undefined).length * 120;
  const data = Math.min(100, w.power.sentMB * 10);
  const distance = Math.min(100, w.rover.odometer / 20);
  const energy = Math.round(80 * (w.power.chargeWh / RULES.power.batteryWh));
  return Math.round(objectives + data + distance + energy);
}
