// Horizon elevation seen from any point of the playable area, so the rover's own position
// decides whether it has sunlight and an Earth link (not just the published site).
//
// horizon(p, az) = max( ray march over the near (10 m) and far (400 m) grids,  ≲ 51 km
//                       far-only part of the site's published mask + tilt,     51–200 km )
// The far-only part is the site mask where it is higher than the site's own ray march (the
// obstacle lies beyond the grids). Moving ≤ 5 km changes such far horizons by the tilt of the
// local vertical (d/R, applied) plus a parallax of ≲ 10 % of their elevation (ignored);
// both are listed in docs/assumptions.md.
import { type Field, heightAt, inNear, R_MOON_M } from './field';

const DEG = Math.PI / 180;

/** Elevation (deg) of the highest terrain along azimuth `azDeg`, seen from `eyeH` m above (x, y). */
export function marchHorizon(f: Field, x: number, y: number, eyeH: number, azDeg: number): number {
  const ground = heightAt(f, x, y);
  if (!Number.isFinite(ground)) return NaN;
  const oz = ground + eyeH;
  // local vertical at the observer: away from the Moon's centre at (0, 0, -R)
  const ul = Math.hypot(x, y, ground + R_MOON_M);
  const ux = x / ul, uy = y / ul, uz = (ground + R_MOON_M) / ul;
  const sx = Math.sin(azDeg * DEG), sy = Math.cos(azDeg * DEG);
  let best = -Infinity;
  let d = f.near.res;
  for (;;) {
    const px = x + d * sx, py = y + d * sy;
    const near = inNear(f, px, py);
    const z = heightAt(f, px, py);
    if (!Number.isFinite(z)) break; // left the far grid
    const vx = px - x, vy = py - y, vz = z - oz;
    const s = (vx * ux + vy * uy + vz * uz) / Math.hypot(vx, vy, vz);
    if (s > best) best = s;
    d += near ? f.near.res : f.far.res / 2;
  }
  return best === -Infinity ? NaN : Math.asin(best) / DEG;
}

export interface Horizon {
  /** Horizon elevation (deg) at azimuth azDeg from (x, y), eye `eyeH` m above the ground. */
  at(x: number, y: number, azDeg: number): number;
  /** Far-only horizon from the site (deg, -Infinity where nothing lies beyond the grids). */
  farOnly: Float32Array;
  azStep: number;
}

/**
 * Build the horizon model of a site. `maskCdeg` is the published mask for height `eyeH`
 * (sites/<id>.json); `tolDeg` decides when the mask comes from beyond the grids.
 */
export function makeHorizon(f: Field, maskCdeg: ArrayLike<number>, azStep: number, eyeH: number, tolDeg = 0.1): Horizon {
  const nAz = maskCdeg.length;
  const farOnly = new Float32Array(nAz);
  for (let i = 0; i < nAz; i++) {
    const mask = maskCdeg[i] / 100, local = marchHorizon(f, 0, 0, eyeH, i * azStep);
    farOnly[i] = !(local >= mask - tolDeg) ? mask : -Infinity;
  }
  return {
    farOnly,
    azStep,
    at(x, y, azDeg) {
      const local = marchHorizon(f, x, y, eyeH, azDeg);
      const k = Math.round((((azDeg % 360) + 360) % 360) / azStep) % nAz;
      let far = farOnly[k];
      if (far !== -Infinity) {
        // moving `along` metres towards distant terrain tilts the local vertical by along/R
        const along = x * Math.sin(azDeg * DEG) + y * Math.cos(azDeg * DEG);
        far += along / R_MOON_M / DEG;
      }
      return Math.max(Number.isFinite(local) ? local : -90, far);
    },
  };
}
