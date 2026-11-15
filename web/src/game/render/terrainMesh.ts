import * as THREE from 'three';
import type { GridSpec } from '../../lib/types';

/**
 * Triangle mesh of one heightmap grid in three.js axes (x = east, y = up, z = south).
 * `max` caps the vertices per side (LOD); `hole` removes far cells inside the near footprint.
 */
export function gridGeometry(spec: GridSpec, heights: Float32Array, max: number, hole = 0) {
  const count = Math.min(max, spec.n), positions = new Float32Array(count * count * 3), indices = new Uint32Array((count - 1) * (count - 1) * 6), valid: boolean[] = [];
  for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
    const col = Math.round(i * (spec.n - 1) / (count - 1)), row = Math.round(j * (spec.n - 1) / (count - 1)), k = j * count + i;
    const x = (col - (spec.n - 1) / 2) * spec.res_m, z = (row - (spec.n - 1) / 2) * spec.res_m, h = heights[row * spec.n + col];
    valid[k] = Number.isFinite(h); positions.set([x, valid[k] ? h : 0, z], k * 3);
  }
  let indexCount = 0;
  for (let j = 0; j < count - 1; j++) for (let i = 0; i < count - 1; i++) {
    const a = j * count + i, b = a + 1, c = a + count, d = c + 1;
    // Remove every far cell intersecting the near footprint, avoiding overlapping surfaces.
    if (hole && positions[a * 3] < hole && positions[d * 3] > -hole && positions[a * 3 + 2] < hole && positions[d * 3 + 2] > -hole) continue;
    if (valid[a] && valid[b] && valid[c]) { indices[indexCount++] = a; indices[indexCount++] = c; indices[indexCount++] = b; }
    if (valid[b] && valid[c] && valid[d]) { indices[indexCount++] = b; indices[indexCount++] = c; indices[indexCount++] = d; }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexCount), 1)); g.computeVertexNormals(); return g;
}
