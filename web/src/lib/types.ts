// Shared data contracts between pipeline/ (Python) and web/ (TypeScript).
// Source of truth: docs/contracts.md. Degrees everywhere; *_cdeg = integer hundredths of a degree.
// Azimuth: from local north, clockwise (Horizons convention). Times: UTC ISO strings.

export interface SiteIndexEntry {
  id: string;
  name: string;
  lat_deg: number;
  lon_deg: number; // east-positive
  elev_m: number;
  group: string; // e.g. "artemis", "clps", "isro", "science"
  tags: string[];
  source_url: string;
  source_note?: string;
  // present when the point was moved to the best-lit gentle spot near the published reference
  ref_lat_deg?: number;
  ref_lon_deg?: number;
  selection?: string;
  dem_res_m: number; // finest DEM resolution used near the site
  dem_source: string; // e.g. "PGDA 81 LOLA 5 m/px (87S)"
  has_clones: boolean;
  slope_deg_50m: number;
  map_px: [number, number]; // pixel (x, y) of the site on basemap.png
}

export interface SiteData {
  id: string;
  generated_utc: string;
  frame: "MOON_ME";
  horizon: {
    az_step_deg: number; // 0.5 -> 720 samples, index 0 = north
    heights_m: number[]; // observer heights above ground available
    elev_cdeg: Record<string, number[]>; // key = String(height_m)
    max_dist_m: number;
  };
  ephem: {
    t0_utc: string; // "2026-11-01T00:00:00Z"
    step_h: number; // 1
    n: number; // 19008
    sun: { az_cdeg: number[]; el_cdeg: number[] };
    earth: { az_cdeg: number[]; el_cdeg: number[] };
  };
  uncertainty: { illum_pct_p5: number; illum_pct_p50: number; illum_pct_p95: number; n_clones?: number; window?: string; source?: string } | null;
}

export interface ValidationRow {
  site: string;
  t_utc: string;
  body: "sun" | "earth";
  az_ours: number;
  el_ours: number;
  az_horizons: number;
  el_horizons: number;
  d_az: number; // circular difference, degrees
  d_el: number;
}

export interface ValidationData {
  generated_utc: string;
  method: string;
  rows: ValidationRow[];
  summary: { n: number; max_abs_d_az_deg: number; max_abs_d_el_deg: number; threshold_deg: number; pass: boolean };
  im2: {
    site: string;
    t_utc: string; // "2025-03-06T17:31:00Z"
    lat_deg: number;
    lon_deg: number;
    sun_az_deg: number;
    sun_el_deg: number;
    horizon_el_at_sun_az_deg: number | null;
    sun_fraction: number | null;
    earth_el_deg: number;
    horizon_az_step_deg: number | null;
    horizon_elev_cdeg: number[] | null; // horizon at 2 m for the IM-2 site, if a DEM covers it
    note: string;
  } | null;
}

export interface Basemap {
  image: string; // "basemap.png"
  width_px: number;
  height_px: number;
  crs: string; // proj string of the polar stereographic map
  // affine: map_x = a*px + b*py + c ; map_y = d*px + e*py + f  (metres)
  affine: [number, number, number, number, number, number];
  extent_lat_deg: number; // e.g. -80 => image covers lat <= -80
}

// ---------- metrics engine API (implemented in lib/metrics.ts, lib/score.ts) ----------

export interface Assumptions {
  heightM: number; // observer / panel height key into horizon.elev_cdeg (default 2)
  dayFraction: number; // sun fraction counting as "day" (default 0.5)
  earthMarginDeg: number; // earth centre must be this far above real horizon (default 0.5)
}

export interface Metrics {
  startUtc: string;
  hours: number;
  lightPct: number; // mean visible solar-disk fraction, %
  longestDayH: number;
  longestNightH: number;
  earthPct: number; // % of hours with Earth visible
  hoursToSunset: number | null; // null = beyond data coverage
  hoursToEarthset: number | null;
  nextEarthWindow: { startUtc: string; durationH: number } | null;
  sunElAtLandingDeg: number; // sun elevation above real horizon at landing hour (can be negative)
}

export interface Weights {
  light: number;
  earth: number;
  night: number;
  landingSun: number;
}

export interface ReplanInput {
  siteIds: string[];
  originalUtc: string;
  delayDays: number;
  toleranceDays: number;
  missionDays: number; // default 14
  stepH: number; // default 6
  weights: Weights;
  filters: { minLightPct: number; minEarthPct: number; maxSlopeDeg: number; requireSunAtLanding: boolean };
}

export interface RankedOption {
  siteId: string;
  landingUtc: string;
  score: number; // 0..100
  metrics: Metrics;
  reasons: string[]; // top 3, English, e.g. "+18% light vs original plan"
}
