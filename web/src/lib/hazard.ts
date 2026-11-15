/** Grid-only screening, not a landing certification. Definitions: docs/hazard.md. */
export const SAFE_SLOPE_DEG = 8;
export const MODERATE_SLOPE_DEG = 15;
export const SLOPE_BANDS_DEG = [5, SAFE_SLOPE_DEG, MODERATE_SLOPE_DEG, 25] as const;
export const WINDOW_HALF_M = 2000;
export const CIRCLE_RADII_M = [50, 100, 250, 500] as const;
export const SAFE_CIRCLE_RADIUS_M = 100;
export const SEARCH_RADIUS_M = 1000;
export const RELIEF_RADIUS_M = 500;
export const MOON_RADIUS_M = 1737400;
export const MAP_RING_RADII_M = [100, 500] as const;
export const SCALE_BAR_M = 1000;

export interface CircleStats { radiusM: number; samples: number; known: number; safePct: number; moderatePct: number; unknownPct: number }
export interface HazardResult {
  n: number; resM: number; westM: number; northM: number;
  slopes: Float32Array; heights: Float64Array; siteIndex: number; siteSlopeDeg: number | null;
  circles: CircleStats[]; largestRadiusM: number | null; largestLimited: boolean;
  nearest: { eastM: number; northM: number; distanceM: number; bearingDeg: number | null } | null;
  reliefM: number | null; reliefKnownPct: number;
}
export function slopeBand(slope: number): number {
  return !Number.isFinite(slope) ? 5 : SLOPE_BANDS_DEG.findIndex(v => slope <= v) === -1 ? 4 : SLOPE_BANDS_DEG.findIndex(v => slope <= v);
}

/** Input heights are decoded ENU z, with NaN nodata. No mutation or I/O. */
export function computeHazard(heights: ArrayLike<number>, n: number, resM: number): HazardResult {
  if (!Number.isInteger(n) || n < 3 || heights.length !== n * n || !Number.isFinite(resM) || resM <= 0) throw new RangeError('Invalid hazard grid');
  const centre = (n - 1) / 2;
  if (centre * resM < WINDOW_HALF_M + resM) throw new RangeError('Terrain must cover the window and a derivative halo');
  const first = Math.max(0, Math.ceil(centre - WINDOW_HALF_M / resM));
  const last = Math.min(n - 1, Math.floor(centre + WINDOW_HALF_M / resM));
  const size = last - first + 1;
  if (size < 1) throw new RangeError('Hazard window has no samples');
  const westM = (first - centre) * resM, northM = -westM;
  const slopes = new Float32Array(size * size).fill(NaN), corrected = new Float64Array(size * size);
  const height = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return NaN;
    const x = (c - centre) * resM, y = (centre - r) * resM;
    return heights[r * n + c] + (x * x + y * y) / (2 * MOON_RADIUS_M);
  };
  const circles = CIRCLE_RADII_M.map(radiusM => ({ radiusM, samples: 0, known: 0, safePct: 0, moderatePct: 0, unknownPct: 0 }));
  let minHeight = Infinity, maxHeight = -Infinity, reliefTotal = 0, reliefKnown = 0;
  // Distance to first non-passing/unknown sample bounds the concentric disk.
  let badDistance = Infinity;
  const prefix = new Uint32Array(size * (size + 1));
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const i = r * size + c, rr = r + first, cc = c + first;
    const z = height(rr, cc); corrected[i] = z;
    const dx = (height(rr, cc + 1) - height(rr, cc - 1)) / (2 * resM);
    const dy = (height(rr - 1, cc) - height(rr + 1, cc)) / (2 * resM);
    const s = Number.isFinite(z) ? Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI : NaN;
    slopes[i] = s;
    const distance = Math.hypot(westM + c * resM, northM - r * resM);
    const known = Number.isFinite(s), safe = known && s <= SAFE_SLOPE_DEG;
    if (!safe) badDistance = Math.min(badDistance, distance);
    const p = r * (size + 1) + c;
    prefix[p + 1] = prefix[p] + Number(!safe);
    for (const circle of circles) if (distance <= circle.radiusM) {
      circle.samples++; circle.known += Number(known);
      circle.safePct += Number(safe); circle.moderatePct += Number(known && s <= MODERATE_SLOPE_DEG);
    }
    if (distance <= RELIEF_RADIUS_M) {
      reliefTotal++;
      if (Number.isFinite(z)) { reliefKnown++; minHeight = Math.min(minHeight, z); maxHeight = Math.max(maxHeight, z); }
    }
  }
  for (const circle of circles) {
    circle.safePct = circle.samples ? 100 * circle.safePct / circle.samples : 0;
    circle.moderatePct = circle.samples ? 100 * circle.moderatePct / circle.samples : 0;
    circle.unknownPct = circle.samples ? 100 * (circle.samples - circle.known) / circle.samples : 100;
  }
  const siteRow = Math.round(centre) - first, siteIndex = siteRow * size + siteRow;
  const siteSlopeDeg = Number.isFinite(slopes[siteIndex]) ? slopes[siteIndex] : null;
  const extent = Math.min(WINDOW_HALF_M, northM + resM / 2);
  const largestLimited = badDistance > extent;
  const largestRadiusM = siteSlopeDeg === null ? null : siteSlopeDeg > SAFE_SLOPE_DEG ? 0
    : Math.max(0, Math.min(Math.floor(extent / resM), Math.ceil(badDistance / resM) - 1) * resM);
  // Exact discrete disk erosion via row prefix sums: O(candidates * radius/resolution).
  const diskRows: { dr: number; dc: number }[] = [];
  for (let dr = -Math.floor(SAFE_CIRCLE_RADIUS_M / resM); dr <= Math.floor(SAFE_CIRCLE_RADIUS_M / resM); dr++) {
    diskRows.push({ dr, dc: Math.floor(Math.sqrt(SAFE_CIRCLE_RADIUS_M ** 2 - (dr * resM) ** 2) / resM) });
  }
  let nearest: HazardResult['nearest'] = null, best = Infinity;
  // Include the exact site origin first (not a grid node on even-sized grids).
  const originCircle = circles.find(c => c.radiusM === SAFE_CIRCLE_RADIUS_M)!;
  if (extent >= SAFE_CIRCLE_RADIUS_M && originCircle.samples && originCircle.safePct === 100) {
    nearest = { eastM: 0, northM: 0, distanceM: 0, bearingDeg: null }; best = 0;
  }
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const eastM = westM + c * resM, north = northM - r * resM, d2 = eastM ** 2 + north ** 2;
    if (d2 > SEARCH_RADIUS_M ** 2 || d2 >= best || Math.abs(eastM) + SAFE_CIRCLE_RADIUS_M > extent || Math.abs(north) + SAFE_CIRCLE_RADIUS_M > extent) continue;
    let safe = true;
    for (const { dr, dc } of diskRows) {
      const row = r + dr, lo = c - dc, hi = c + dc;
      if (row < 0 || row >= size || lo < 0 || hi >= size || prefix[row * (size + 1) + hi + 1] !== prefix[row * (size + 1) + lo]) { safe = false; break; }
    }
    if (safe) { best = d2; nearest = { eastM, northM: north, distanceM: Math.sqrt(d2), bearingDeg: (Math.atan2(eastM, north) * 180 / Math.PI + 360) % 360 }; }
  }
  return { n: size, resM, westM, northM, slopes, heights: corrected, siteIndex, siteSlopeDeg, circles,
    largestRadiusM, largestLimited, nearest, reliefM: reliefKnown ? maxHeight - minHeight : null,
    reliefKnownPct: reliefTotal ? 100 * reliefKnown / reliefTotal : 0 };
}
