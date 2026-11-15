import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { type Field, heightAt } from '../sim/field';

interface Marker { x: number; y: number }
interface Props {
  field: Field;
  /** Visible solar fraction of the terrain at (x, y), from the scene's physics bake. */
  sunlitAt: (x: number, y: number) => number;
  bakeVersion: number;
  /** 'sun' = amber (sunlight), 'earth' = blue (Earth visibility). */
  tint?: 'sun' | 'earth';
  rover: Marker & { heading: number };
  waypoint: Marker | null;
  nav: Marker | null;
  lander: Marker | null;
  size: number;
}

/** Top-down map of the drivable terrain: hillshade × real sunlight, with the rover and targets. */
export default function Minimap({ field, sunlitAt, bakeVersion, tint = 'sun', rover, waypoint, nav, lander, size }: Props) {
  const base = useRef<HTMLCanvasElement | null>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const half = field.near.half;
  const px = (x: number) => ((x + half) / (2 * half)) * size;
  const py = (y: number) => ((half - y) / (2 * half)) * size;

  // Terrain layer: rebuilt when a new sunlight bake is published.
  useEffect(() => {
    const n = Math.round(size), c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!, img = g.createImageData(n, n), step = (2 * half) / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * step, y = half - (j + 0.5) * step;
      const dzx = heightAt(field, x + step, y) - heightAt(field, x - step, y);
      const dzy = heightAt(field, x, y + step) - heightAt(field, x, y - step);
      const shade = Math.max(0, Math.min(1, 0.55 + (-dzx + dzy) / (4 * step))); // NW-lit relief
      const raw = sunlitAt(x, y), lit = Number.isFinite(raw) ? raw : 0;
      const v = Number.isFinite(shade) ? shade : 0;
      const k = (j * n + i) * 4;
      if (tint === 'earth') {
        img.data[k] = 30 + v * 50 + lit * 40;
        img.data[k + 1] = 40 + v * 50 + lit * 110;
        img.data[k + 2] = 60 + v * 50 + lit * 170;
      } else {
        img.data[k] = 40 + v * 60 + lit * 150;
        img.data[k + 1] = 44 + v * 60 + lit * 128;
        img.data[k + 2] = 58 + v * 60 + lit * 70;
      }
      img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    base.current = c;
  }, [field, half, size, sunlitAt, bakeVersion, tint]);

  useEffect(() => {
    const g = cv.current?.getContext('2d');
    if (!g || !base.current) return;
    g.clearRect(0, 0, size, size);
    g.drawImage(base.current, 0, 0);
    const dot = (m: Marker, color: string, r: number) => { g.beginPath(); g.arc(px(m.x), py(m.y), r, 0, Math.PI * 2); g.fillStyle = color; g.fill(); };
    if (lander) { g.fillStyle = '#e8e8e2'; g.fillRect(px(lander.x) - 3, py(lander.y) - 3, 6, 6); }
    if (waypoint) { g.strokeStyle = '#7fd99a'; g.lineWidth = 1.5; g.beginPath(); g.arc(px(waypoint.x), py(waypoint.y), 5, 0, Math.PI * 2); g.stroke(); }
    if (nav) dot(nav, '#4fd1ff', 3.5);
    const a = (rover.heading * Math.PI) / 180, cx = px(rover.x), cy = py(rover.y);
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath();
    g.fillStyle = '#f4ce72'; g.strokeStyle = '#000'; g.lineWidth = 1; g.fill(); g.stroke(); g.restore();
    g.fillStyle = 'rgba(232,238,245,.8)'; g.font = '10px Geist Mono, monospace'; g.fillText('N', size / 2 - 3, 11);
  });

  return (
    <canvas ref={cv} width={size} height={size} className="minimap" role="img"
      aria-label={t('Map of the drivable area: bright ground is in sunlight now; arrow = rover')} />
  );
}
