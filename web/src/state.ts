import { create } from 'zustand';
import type { Assumptions, Weights } from './lib/types';
import { DEFAULT_ASSUMPTIONS } from './lib/metrics';
import { DEFAULT_WEIGHTS } from './lib/score';

export const DEFAULT_LANDING_UTC = '2027-01-12T06:00:00Z';
export const MAX_COMPARE = 3;

export interface ReplanForm {
  siteIds: string[]; // empty = all sites
  originalUtc: string;
  delayDays: number;
  toleranceDays: number;
  missionDays: number;
  stepH: number;
  weights: Weights;
  filters: { minLightPct: number; minEarthPct: number; maxSlopeDeg: number; requireSunAtLanding: boolean };
}

interface AppState {
  siteId: string | null;
  compareIds: string[];
  landingUtc: string;
  missionDays: number;
  cursorH: number; // hours after landing shown in the panorama
  playing: boolean;
  assumptions: Assumptions;
  replan: ReplanForm;
  setSite: (id: string | null) => void;
  toggleCompare: (id: string) => void;
  setCompare: (ids: string[]) => void;
  setLanding: (utc: string) => void;
  setMissionDays: (d: number) => void;
  setCursorH: (h: number) => void;
  setPlaying: (p: boolean) => void;
  setAssumptions: (a: Partial<Assumptions>) => void;
  setReplan: (r: Partial<ReplanForm>) => void;
}

export const useApp = create<AppState>((set) => ({
  siteId: null,
  compareIds: [],
  landingUtc: DEFAULT_LANDING_UTC,
  missionDays: 14,
  cursorH: 0,
  playing: false,
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  replan: {
    siteIds: [],
    originalUtc: DEFAULT_LANDING_UTC,
    delayDays: 21,
    toleranceDays: 7,
    missionDays: 14,
    stepH: 6,
    weights: { ...DEFAULT_WEIGHTS },
    filters: { minLightPct: 0, minEarthPct: 0, maxSlopeDeg: 15, requireSunAtLanding: true },
  },
  setSite: (id) => set({ siteId: id }),
  toggleCompare: (id) =>
    set((s) => {
      if (s.compareIds.includes(id)) return { compareIds: s.compareIds.filter((x) => x !== id) };
      if (s.compareIds.length >= MAX_COMPARE) return { compareIds: [...s.compareIds.slice(1), id] };
      return { compareIds: [...s.compareIds, id] };
    }),
  setCompare: (ids) => set({ compareIds: ids.slice(0, MAX_COMPARE) }),
  setLanding: (utc) => set({ landingUtc: utc, cursorH: 0 }),
  setMissionDays: (d) => set((s) => ({ missionDays: d, cursorH: Math.min(s.cursorH, d * 24) })),
  setCursorH: (h) => set({ cursorH: h }),
  setPlaying: (p) => set({ playing: p }),
  setAssumptions: (a) => set((s) => ({ assumptions: { ...s.assumptions, ...a } })),
  setReplan: (r) => set((s) => ({ replan: { ...s.replan, ...r } })),
}));
