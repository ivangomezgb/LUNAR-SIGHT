import { create } from 'zustand';
import { STOPS } from './stops';

// Progress of the guided route, kept in this browser (storage may be blocked: then it lasts the visit).
type GuideMode = 'welcome' | 'open' | 'pill' | 'hidden';
interface GuideState {
  visited: string[];
  mode: GuideMode;
  visit: (path: string) => void;
  setMode: (m: GuideMode) => void;
  reset: () => void;
}

const KEY = 'lln.guide.v1';
function load(): { visited: string[]; mode: GuideMode } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as { visited?: string[]; mode?: GuideMode };
      return { visited: Array.isArray(v.visited) ? v.visited : [], mode: v.mode ?? 'pill' };
    }
  } catch { /* ignore */ }
  return { visited: [], mode: 'welcome' };
}
function save(s: { visited: string[]; mode: GuideMode }) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export const useGuide = create<GuideState>((set, get) => ({
  ...load(),
  visit: (path) => {
    if (!STOPS.some((s) => s.path === path) || get().visited.includes(path)) return;
    const visited = [...get().visited, path];
    set({ visited });
    save({ visited, mode: get().mode });
  },
  setMode: (mode) => { set({ mode }); save({ visited: get().visited, mode }); },
  reset: () => { set({ visited: [], mode: 'open' }); save({ visited: [], mode: 'open' }); },
}));

/** The next stop to suggest from `path`: the first unvisited one after it, wrapping around. */
export function nextStop(path: string, visited: string[]) {
  const i = Math.max(0, STOPS.findIndex((s) => s.path === path));
  for (let k = 1; k <= STOPS.length; k++) {
    const s = STOPS[(i + k) % STOPS.length];
    if (!visited.includes(s.path) && s.path !== path) return s;
  }
  return STOPS[(i + 1) % STOPS.length];
}
