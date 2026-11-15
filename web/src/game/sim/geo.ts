// Real selenographic coordinates of points in the site's local frame (sphere R = 1737.4 km),
// so the rover reports latitude/longitude and the player can navigate to typed coordinates.
import { R_MOON_M } from './field';

const DEG = Math.PI / 180;

export interface LatLon { lat: number; lon: number } // degrees, longitude east-positive

/** Point `x` m east and `y` m north of the site (great-circle offset). */
export function localToLatLon(site: LatLon, x: number, y: number): LatLon {
  const d = Math.hypot(x, y) / R_MOON_M;
  if (d === 0) return { ...site };
  const th = Math.atan2(x, y), p0 = site.lat * DEG, l0 = site.lon * DEG;
  const p = Math.asin(Math.sin(p0) * Math.cos(d) + Math.cos(p0) * Math.sin(d) * Math.cos(th));
  const l = l0 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p0), Math.cos(d) - Math.sin(p0) * Math.sin(p));
  return { lat: p / DEG, lon: ((((l / DEG) + 180) % 360) + 360) % 360 - 180 };
}

/** Local (east, north) metres of a coordinate relative to the site: inverse of localToLatLon. */
export function latLonToLocal(site: LatLon, to: LatLon): { x: number; y: number } {
  const p0 = site.lat * DEG, p = to.lat * DEG, dl = (to.lon - site.lon) * DEG;
  const a = Math.sin((p - p0) / 2) ** 2 + Math.cos(p0) * Math.cos(p) * Math.sin(dl / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const th = Math.atan2(Math.sin(dl) * Math.cos(p), Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl));
  return { x: d * R_MOON_M * Math.sin(th), y: d * R_MOON_M * Math.cos(th) };
}

/** Distance (m) and bearing (deg from north, clockwise) from one local point to another. */
export function route(fromX: number, fromY: number, toX: number, toY: number): { dist: number; bearing: number } {
  const dx = toX - fromX, dy = toY - fromY;
  return { dist: Math.hypot(dx, dy), bearing: ((Math.atan2(dx, dy) / DEG) + 360) % 360 };
}

/** "89.4512° S, 137.2031° W" style text. */
export function fmtLatLon(p: LatLon, digits = 4): string {
  return `${Math.abs(p.lat).toFixed(digits)}° ${p.lat < 0 ? 'S' : 'N'}, ${Math.abs(p.lon).toFixed(digits)}° ${p.lon < 0 ? 'W' : 'E'}`;
}

/** Parse "-89.45, -137.2" or "89.45 S 137.2 W"; null when it is not a coordinate. */
export function parseLatLon(text: string): LatLon | null {
  const m = text.trim().toUpperCase().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2] === 'S') lat = -Math.abs(lat);
  if (m[4] === 'W') lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 360)) return null;
  return { lat, lon: lon > 180 ? lon - 360 : lon };
}
