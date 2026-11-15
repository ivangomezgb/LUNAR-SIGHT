// Terrain shading from the game's own physics: each point's visible fraction of the solar disk
// is computed with the same horizon model the rover uses (visibility.ts), baked into a vertex
// attribute and multiplied into the Sun's light in the shader. A shadow map cannot do this at
// polar Sun elevations of 0–3°: grazing light makes the terrain shadow itself.
import * as THREE from 'three';
import { sunFraction } from '../../lib/sunFraction';
import type { Field } from '../sim/field';
import type { Horizon } from '../sim/visibility';

/** MeshStandardMaterial whose first directional light (the Sun) is scaled by `sunlit`. */
export const overlayUniform = { value: 0 }; // 0 = off, 1 = yearly sunlight heat map

export function sunlitMaterial(color: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOverlay = overlayUniform;
    shader.vertexShader = 'attribute float sunlit;\nattribute float annual;\nvarying float vSunlit;\nvarying float vAnnual;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSunlit = sunlit;\n  vAnnual = annual;');
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? vSunlit : 1.0;',
    );
    if (lights === THREE.ShaderChunk.lights_fragment_begin) throw new Error('three.js light chunk changed');
    shader.fragmentShader = 'varying float vSunlit;\nvarying float vAnnual;\nuniform float uOverlay;\n' + shader.fragmentShader
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (uOverlay > 0.5) diffuseColor.rgb *= 0.25; // keep the relief, let the yearly map read`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (uOverlay > 0.5) {
    float a = clamp(vAnnual, 0.0, 1.0);
    vec3 cold = vec3(0.03, 0.05, 0.20), mid = vec3(0.55, 0.20, 0.35), warm = vec3(1.0, 0.78, 0.28);
    vec3 heat = a < 0.5 ? mix(cold, mid, a * 2.0) : mix(mid, warm, (a - 0.5) * 2.0);
    totalEmissiveRadiance += heat * 0.9;
  }`);
  };
  return m;
}

/**
 * Progressive bake of sunlight over the near terrain. `positions` are the mesh vertices in
 * three.js axes; the attribute is written when a full pass for one Sun position is done.
 */
export class SunlitBake {
  readonly attr: THREE.BufferAttribute;
  private lit: Float32Array;
  private next: Float32Array;
  private cursor = -1;
  /** Increments every time a finished bake is published (for the minimap). */
  version = 0;
  private bakeAz = NaN;
  private bakeEl = NaN;
  private doneAz = NaN;
  private doneEl = NaN;
  private horizon: Horizon;
  private size: number;
  private half: number;
  private positions: ArrayLike<number>;

  constructor(field: Field, horizon: Horizon, positions: ArrayLike<number>, size: number) {
    this.horizon = horizon;
    this.size = size;
    this.half = field.near.half;
    this.positions = positions;
    this.lit = new Float32Array(size * size).fill(1);
    this.next = new Float32Array(size * size);
    this.attr = new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(1), 1);
  }

  private point(k: number): [number, number] {
    const step = (2 * this.half) / (this.size - 1);
    return [-this.half + (k % this.size) * step, this.half - Math.floor(k / this.size) * step];
  }

  /** Bake synchronously (first frame) with the given Sun. */
  bakeNow(sunAz: number, sunEl: number) {
    this.request(sunAz, sunEl, true);
    this.work(Infinity);
  }

  /** Ask for a new bake when the Sun moved enough since the last one. */
  request(sunAz: number, sunEl: number, force = false) {
    const dAz = Math.abs(((sunAz - (this.cursor >= 0 ? this.bakeAz : this.doneAz) + 540) % 360) - 180);
    const dEl = Math.abs(sunEl - (this.cursor >= 0 ? this.bakeEl : this.doneEl));
    if (!force && this.cursor >= 0) return; // finish the running bake first
    if (!force && dAz < 0.25 && dEl < 0.03) return;
    this.bakeAz = sunAz; this.bakeEl = sunEl; this.cursor = 0;
  }

  /** Continue the running bake for up to `budgetMs`; true when the attribute changed. */
  work(budgetMs: number): boolean {
    if (this.cursor < 0) return false;
    const t0 = performance.now(), n = this.size * this.size;
    while (this.cursor < n) {
      const [x, y] = this.point(this.cursor);
      const h = this.horizon.at(x, y, this.bakeAz);
      this.next[this.cursor] = Number.isFinite(h) ? sunFraction(this.bakeEl, h) : 0;
      this.cursor++;
      if ((this.cursor & 63) === 0 && performance.now() - t0 > budgetMs) return false;
    }
    [this.lit, this.next] = [this.next, this.lit];
    this.doneAz = this.bakeAz; this.doneEl = this.bakeEl; this.cursor = -1;
    this.writeAttribute();
    return true;
  }

  /** Visible solar fraction at (x east, y north), bilinear in the bake grid. */
  sample(x: number, y: number): number {
    const s = this.size, f = (s - 1) / (2 * this.half);
    const c = Math.max(0, Math.min(s - 1.001, (x + this.half) * f)), r = Math.max(0, Math.min(s - 1.001, (this.half - y) * f));
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, i = r0 * s + c0, l = this.lit;
    return l[i] * (1 - fc) * (1 - fr) + l[i + 1] * fc * (1 - fr) + l[i + s] * (1 - fc) * fr + l[i + s + 1] * fc * fr;
  }

  private writeAttribute() {
    const a = this.attr.array as Float32Array, p = this.positions;
    for (let v = 0; v < a.length; v++) a[v] = this.sample(p[v * 3], -p[v * 3 + 2]);
    this.attr.needsUpdate = true;
    this.version++;
  }
}
