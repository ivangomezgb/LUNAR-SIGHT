import { describe, expect, it } from 'vitest';
import { stationAfter, stationOrder } from '../stations';

const sites = [
  { id: 'west', lat_deg: -89, lon_deg: -90 },
  { id: 'near-side', lat_deg: -89, lon_deg: 0 },
  { id: 'east', lat_deg: -89, lon_deg: 90 },
  { id: 'far-side', lat_deg: -89, lon_deg: 180 },
];

describe('stations around the pole', () => {
  it('orders the sites by bearing so next/previous go round the pole', () => {
    const order = stationOrder(sites);
    expect(order).toHaveLength(4);
    expect(new Set(order)).toEqual(new Set(sites.map((s) => s.id)));
    // consecutive stations are neighbours (90° apart), never across the pole
    const lon = (id: string) => sites.find((s) => s.id === id)!.lon_deg;
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(((lon(order[(k + 1) % 4]) - lon(order[k]) + 540) % 360) - 180);
      expect(d).toBe(90);
    }
  });
  it('wraps around in both directions', () => {
    const order = ['a', 'b', 'c'];
    expect(stationAfter(order, 'c', 1)).toBe('a');
    expect(stationAfter(order, 'a', -1)).toBe('c');
    expect(stationAfter(order, 'b', 1)).toBe('c');
    expect(stationAfter([], 'x', 1)).toBe('x');
  });
});
