import { describe, expect, it } from 'vitest';
import { azElToThree, decodeInt16, decodeOctahedral } from '../terrain';
describe('terrain contracts', () => {
  it('round trips octahedral normals in both hemispheres', () => {
    for (let az = 0; az < 360; az += 13) for (let el = -90; el <= 90; el += 11) {
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      const n = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
      const length = n.reduce((s, v) => s + Math.abs(v), 0);
      let x = n[0] / length, y = n[1] / length;
      if (n[2] < 0) { const old = x; x = (1 - Math.abs(y)) * (old >= 0 ? 1 : -1); y = (1 - Math.abs(old)) * (y >= 0 ? 1 : -1); }
      const decoded = decodeOctahedral(Math.round((x + 1) * 127.5), Math.round((y + 1) * 127.5));
      expect(Math.hypot(...decoded)).toBeCloseTo(1, 6);
      expect(decoded.reduce((s, v, i) => s + v * n[i], 0)).toBeGreaterThan(.9998);
    }
  });
  it('decodes little-endian scale, offset and nodata', () => {
    const b = new ArrayBuffer(8), v = new DataView(b);
    [-123, 0, 32767, -32768].forEach((x, i) => v.setInt16(i * 2, x, true));
    const h = decodeInt16(b, .25, 12);
    expect(Array.from(h.slice(0, 3))).toEqual([-18.75, 12, 8203.75]); expect(h[3]).toBeNaN();
    expect(() => decodeInt16(new ArrayBuffer(1), 1, 0)).toThrow();
  });
  it.each([[0, 0, [0, 0, -1]], [90, 0, [1, 0, 0]], [0, 90, [0, 1, 0]]] as const)('maps az %s el %s to y-up', (a, e, want) => {
    azElToThree(a, e).forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
  });
});
