// The candidate sites as a ring of "stations" around the south pole: ordered by their bearing
// from the pole, so "next" always moves the same way around it.
import { latLonToMap } from './polar';

export function stationOrder<T extends { id: string; lat_deg: number; lon_deg: number }>(sites: readonly T[]): string[] {
  return sites
    .map((s) => { const m = latLonToMap(s.lat_deg, s.lon_deg); return { id: s.id, a: Math.atan2(m.x, m.y) }; })
    .sort((p, q) => p.a - q.a)
    .map((p) => p.id);
}

/** The station `step` places after (or before, step < 0) `id`, wrapping around. */
export function stationAfter(order: readonly string[], id: string, step: number): string {
  if (!order.length) return id;
  const i = Math.max(0, order.indexOf(id));
  return order[(((i + step) % order.length) + order.length) % order.length];
}
