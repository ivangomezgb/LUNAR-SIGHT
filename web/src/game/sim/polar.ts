// South-polar geometry for the orbital view. Same polar stereographic projection as the
// pipeline (dem.latlon_to_xy, k0 = 1, R = 1737.4 km): x = 2R·cosφ·sinλ/(1−sinφ), y = 2R·cosφ·cosλ/(1−sinφ).
// 3D frame (km): pole on the surface at the origin, +Y up (away from the Moon's centre at
// (0, −R, 0)), map x → +X, map y → −Z.
import { R_MOON_M } from './field';

const DEG = Math.PI / 180;
export const R_KM = R_MOON_M / 1000;

export function latLonToMap(latDeg: number, lonDeg: number): { x: number; y: number } {
  const p = latDeg * DEG, l = lonDeg * DEG, k = (2 * R_MOON_M * Math.cos(p)) / (1 - Math.sin(p));
  return { x: k * Math.sin(l), y: k * Math.cos(l) };
}

export function mapToLatLon(x: number, y: number): { lat: number; lon: number } {
  const c = 2 * Math.atan(Math.hypot(x, y) / (2 * R_MOON_M)); // angle from the south pole
  return { lat: -90 + c / DEG, lon: Math.atan2(x, y) / DEG };
}

/** Point on the sphere (radius R + altKm) above map coordinates (m), in the 3D frame (km). */
export function mapToSphere(x: number, y: number, altKm = 0): [number, number, number] {
  const c = 2 * Math.atan(Math.hypot(x, y) / (2 * R_MOON_M)), l = Math.atan2(x, y), r = R_KM + altKm;
  return [r * Math.sin(c) * Math.sin(l), r * Math.cos(c) - R_KM, -r * Math.sin(c) * Math.cos(l)];
}

/** Local outward normal (unit) at map coordinates. */
export function upAt(x: number, y: number): [number, number, number] {
  const p = mapToSphere(x, y);
  const v = [p[0], p[1] + R_KM, p[2]], n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Direction (unit, 3D frame) of a body seen from a site at longitude `lonDeg` near the pole with
 * local azimuth/elevation (deg). Local north points away from the pole, local east along +λ.
 */
export function localToPolarDir(azDeg: number, elDeg: number, lonDeg: number): [number, number, number] {
  const a = azDeg * DEG, e = elDeg * DEG, l = lonDeg * DEG;
  const north = [Math.sin(l), Math.cos(l)], east = [Math.cos(l), -Math.sin(l)];
  const hx = Math.cos(e) * (Math.cos(a) * north[0] + Math.sin(a) * east[0]);
  const hy = Math.cos(e) * (Math.cos(a) * north[1] + Math.sin(a) * east[1]);
  return [hx, Math.sin(e), -hy];
}
