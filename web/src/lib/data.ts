import type { Basemap, SiteData, SiteIndexEntry, ValidationData } from './types';

function url(path: string): string {
  return import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/' + path;
}
async function read<T>(path: string): Promise<T> {
  const response = await fetch(url(path));
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}
const isNumArray = (a: unknown, n: number) => Array.isArray(a) && a.length === n && typeof a[0] === 'number';

/** Throw a readable error when a site file does not match the SiteData contract. */
export function checkSiteData(d: unknown, id: string): SiteData {
  const s = d as SiteData;
  const fail = (why: string): never => { throw new Error(`Invalid data for ${id}: ${why}`); };
  if (!s || typeof s !== 'object') fail('not an object');
  if (s.id !== id) fail(`id is ${JSON.stringify(s.id)}`);
  const h = s.horizon, e = s.ephem;
  if (!h || !(h.az_step_deg > 0) || !h.elev_cdeg || typeof h.elev_cdeg !== 'object') fail('missing horizon');
  const nAz = Math.round(360 / h.az_step_deg);
  const heights = Object.keys(h.elev_cdeg);
  if (!heights.length) fail('horizon has no heights');
  for (const k of heights) if (!isNumArray(h.elev_cdeg[k], nAz)) fail(`horizon ${k} m must have ${nAz} values`);
  if (!e || !Number.isInteger(e.n) || e.n < 1 || !(e.step_h > 0) || !Number.isFinite(Date.parse(e.t0_utc))) fail('missing ephemeris header');
  for (const body of ['sun', 'earth'] as const)
    for (const k of ['az_cdeg', 'el_cdeg'] as const)
      if (!isNumArray(e[body]?.[k], e.n)) fail(`ephem ${body}.${k} must have ${e.n} values`);
  return s;
}

const sites = new Map<string, Promise<SiteData>>();
export async function loadSites(): Promise<SiteIndexEntry[]> {
  const index = await read<SiteIndexEntry[]>('sites.json');
  if (!Array.isArray(index) || index.some((e) => !e || typeof e.id !== 'string')) throw new Error('Invalid sites.json');
  return index;
}
export function loadSite(id: string): Promise<SiteData> {
  let pending = sites.get(id);
  if (!pending) {
    pending = read<unknown>(`sites/${encodeURIComponent(id)}.json`).then(d => checkSiteData(d, id)).catch(error => {
      sites.delete(id);
      throw error;
    });
    sites.set(id, pending);
  }
  return pending;
}
export const loadBasemap = (): Promise<Basemap> => read('basemap.json');
export async function loadValidation(): Promise<ValidationData | null> {
  const response = await fetch(url('validation.json'));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Unable to load validation: ${response.status}`);
  try { return await response.json() as ValidationData; } catch { return null; }
}

/** Nearest permanently shadowed region per site (pipeline/lln/psr.py, Mazarico et al. 2011 products). */
export interface PsrSite {
  product: string; resolution_m: number; search_radius_km: number;
  psr_area_km2_within: Record<string, number>;
  nearest: { distance_km: number; bearing_deg: number; area_km2: number; area_is_lower_bound: boolean } | null;
  avg_sun_any_disc_pct: number; avg_earth_any_disc_pct: number;
  overlay: { n_rows: number; n_cols: number; res_m: number; site_row: number; site_col: number; north_deg_from_up: number; bits: string };
}
export interface PsrData { source: string; files: string; citation: string; definition: string; sites: Record<string, PsrSite> }
let psrCache: Promise<PsrData> | null = null;
export function loadPsr(): Promise<PsrData> {
  psrCache ??= read<PsrData>('psr/psr.json').then((d) => {
    if (!d || typeof d.sites !== 'object') throw new Error('Invalid psr.json');
    return d;
  }).catch((e) => { psrCache = null; throw e; });
  return psrCache;
}

/** Our illumination vs the published LOLA long-term averages (pipeline/scripts/literature_check.py). */
export interface LiteratureRow {
  id: string; name: string; published_product: string; published_resolution_m: number;
  published_sun_any_pct: number; published_earth_any_pct: number;
  published_sun_neighbourhood: { radius_m: number; min_pct: number; max_pct: number };
  ours_in_neighbourhood_1m: boolean;
  ours: Record<string, { sun_any_pct_full: number; sun_any_pct_2027: number; earth_any_pct_full: number }>;
}
export interface LiteratureData {
  reference: { citation: string; source: string; files: string; definition: string };
  ours_definition: string; rows: LiteratureRow[];
  summary: Record<string, { mean_diff_pp: number; median_abs_diff_pp: number; max_abs_diff_pp: number; corr: number } | string>;
}
export function loadLiterature(): Promise<LiteratureData> {
  return read<LiteratureData>('literature.json').then((d) => {
    if (!d || !Array.isArray(d.rows)) throw new Error('Invalid literature.json');
    return d;
  });
}
