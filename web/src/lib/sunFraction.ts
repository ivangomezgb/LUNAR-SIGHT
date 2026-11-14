export const SUN_RADIUS_DEG = 0.267;

export function sunFraction(sunElDeg: number, horizonElDeg: number): number {
  const u = (sunElDeg - horizonElDeg) / SUN_RADIUS_DEG;
  if (u >= 1) return 1;
  if (u <= -1) return 0;
  return 1 - (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}

export function horizonAt(maskCdeg: ArrayLike<number>, azDeg: number, stepDeg = 0.5): number {
  if (!maskCdeg.length || !(stepDeg > 0)) throw new Error('Invalid horizon mask');
  const x = (((azDeg % 360) + 360) % 360) / stepDeg;
  const i = Math.floor(x), f = x - i, n = maskCdeg.length;
  return ((1 - f) * maskCdeg[i % n] + f * maskCdeg[(i + 1) % n]) / 100;
}
