import type { Basemap, SiteData, SiteIndexEntry, ValidationData } from './types';

function url(path: string): string {
  return import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/' + path;
}
async function read<T>(path: string): Promise<T> {
  const response = await fetch(url(path));
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
  return response.json() as Promise<T>;
}
const sites = new Map<string, Promise<SiteData>>();
export const loadSites = (): Promise<SiteIndexEntry[]> => read('sites.json');
export function loadSite(id: string): Promise<SiteData> {
  let pending = sites.get(id);
  if (!pending) {
    pending = read<SiteData>(`sites/${encodeURIComponent(id)}.json`).catch(error => {
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
