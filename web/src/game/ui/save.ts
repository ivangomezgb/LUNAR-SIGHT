// Mission progress kept in this browser (per site and start time). Storage may be blocked or
// cleared at any time; the game always works without it.
import type { MissionState } from '../sim/mission';
import type { World } from '../sim/world';

const KEY = 'lln.mission.v1';

export interface SavedMission {
  site: string;
  startMs: number;
  savedAt: number;
  landing: { x: number; y: number } | null;
  world: Pick<World, 'tMs' | 'warp' | 'rover' | 'power' | 'scans'> & Partial<Pick<World, 'thermal'>>;
  mission: MissionState;
}

export function loadSave(site: string, startMs: number): SavedMission | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMission;
    if (s.site !== site || s.startMs !== startMs || !s.world?.rover || !s.mission?.done) return null;
    return s;
  } catch {
    return null;
  }
}

export function writeSave(s: SavedMission): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked or full */ }
}

export function clearSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The saved mission, whatever its site and start (for "continue" from orbit). */
export function peekSave(): SavedMission | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as SavedMission) : null;
    return s && s.world?.rover && s.mission?.done ? s : null;
  } catch {
    return null;
  }
}
