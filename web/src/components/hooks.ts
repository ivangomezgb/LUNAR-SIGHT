import { useEffect, useState } from 'react';
import type { SiteData, SiteIndexEntry, ValidationData, Basemap } from '../lib/types';
import { loadSite, loadSites, loadValidation, loadBasemap } from '../lib/data';

export interface Async<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: undefined, error: null, loading: !!fn });
  useEffect(() => {
    if (!fn) {
      setState({ data: undefined, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState({ data: undefined, error: e instanceof Error ? e : new Error(String(e)), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useSites(): Async<SiteIndexEntry[]> {
  return useAsync(() => loadSites(), []);
}

export function useSite(id: string | null | undefined): Async<SiteData> {
  const a = useAsync(id ? () => loadSite(id) : null, [id]);
  // drop stale data from a previous id
  if (a.data && id && a.data.id !== id) return { data: undefined, error: null, loading: true };
  return a;
}

export function useSitesData(ids: string[]): Async<Map<string, SiteData>> {
  const key = ids.join(',');
  return useAsync(
    ids.length
      ? async () => {
          const all = await Promise.all(ids.map((id) => loadSite(id)));
          return new Map(all.map((s) => [s.id, s] as const));
        }
      : null,
    [key],
  );
}

export function useValidation(): Async<ValidationData | null> {
  return useAsync(() => loadValidation(), []);
}

export function useBasemap(): Async<Basemap> {
  return useAsync(() => loadBasemap(), []);
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** Base URL of the data directory (mirrors lib/data.ts). */
export const DATA_DIR: string = (import.meta.env.VITE_DATA_DIR as string | undefined) ?? 'data';
export function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${DATA_DIR}/${file}`;
}
