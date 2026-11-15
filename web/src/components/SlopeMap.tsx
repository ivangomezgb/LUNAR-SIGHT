import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../state';
import { loadTerrain } from '../lib/terrain';
import { computeHazard, slopeBand, SAFE_SLOPE_DEG, MODERATE_SLOPE_DEG, SAFE_CIRCLE_RADIUS_M,
  SEARCH_RADIUS_M, MAP_RING_RADII_M, SCALE_BAR_M, MOON_RADIUS_M, type HazardResult } from '../lib/hazard';
import '../styles/slope.css';

interface Loaded { result: HazardResult; source: string }
const cache = new Map<string, Promise<Loaded>>();
function load(id: string): Promise<Loaded> {
  let promise = cache.get(id);
  if (!promise) {
    promise = loadTerrain(id).then(({ meta, near }) => ({ result: computeHazard(near, meta.near.n, meta.near.res_m), source: meta.near.source }));
    cache.set(id, promise);
    void promise.catch(() => { cache.delete(id); });
  }
  return promise;
}
const colors = ['#3b756a', '#97a85a', '#d6a64b', '#cd714e', '#a94d79', '#343944'];
const labels = ['0–5° · dots', '>5–8° · horizontal lines', '>8–15° · diagonal lines', '>15–25° · crosshatch', '>25° · dense dots', 'Unknown · checkerboard'];
const patterns = ['·', '―', '/', '×', '⁙', '▧'];

export default function SlopeMap({ siteId, siteName }: { siteId: string; siteName?: string }) {
  const [state, setState] = useState<{ id: string; data?: Loaded; error?: boolean } | null>(null);
  const [cursor, setCursor] = useState<{ id: string; index: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), caption = useId();
  const mapImage = useRef<ImageData | null>(null);
  const lang = useApp(s => s.lang);
  useEffect(() => {
    let active = true;
    void load(siteId).then(data => { if (active) setState({ id: siteId, data }); }, () => { if (active) setState({ id: siteId, error: true }); });
    return () => { active = false; };
  }, [siteId]);
  const data = state?.id === siteId ? state.data : undefined, r = data?.result;
  const index = r ? cursor?.id === siteId ? Math.min(cursor.index, r.slopes.length - 1) : r.siteIndex : 0;
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d');
    if (!r || !el || !ctx) return;
    const w = el.width, span = r.n * r.resM, step = w / r.n;
    const x = (east: number) => (east - r.westM + r.resM / 2) / span * w;
    const y = (north: number) => (r.northM - north + r.resM / 2) / span * w;
    for (let row = 0; row < r.n; row++) for (let col = 0; col < r.n; col++) {
      const band = slopeBand(r.slopes[row * r.n + col]);
      ctx.fillStyle = colors[band]; ctx.fillRect(col * step, row * step, step + 0.5, step + 0.5);
    }
    // Screen-space textures remain legible when the grid is scaled down.
    ctx.strokeStyle = '#10141a'; ctx.fillStyle = '#10141a'; ctx.lineWidth = 1;
    for (let py = 4; py < w; py += 8) for (let px = 4; px < w; px += 8) {
      const band = slopeBand(r.slopes[Math.min(r.n - 1, Math.floor(py / step)) * r.n + Math.min(r.n - 1, Math.floor(px / step))]);
      ctx.beginPath();
      if (band === 0 || band === 4) { ctx.fillRect(px, py, 1.5, 1.5); if (band === 4) ctx.fillRect(px + 3, py + 3, 1.5, 1.5); }
      if (band === 1) { ctx.moveTo(px - 2, py); ctx.lineTo(px + 2, py); }
      if (band === 2 || band === 3) { ctx.moveTo(px - 2, py + 2); ctx.lineTo(px + 2, py - 2); }
      if (band === 3) { ctx.moveTo(px - 2, py - 2); ctx.lineTo(px + 2, py + 2); }
      if (band === 5) ctx.fillRect(px - 2, py - 2, 4, 4);
      ctx.stroke();
    }
    ctx.font = '14px sans-serif'; ctx.lineWidth = 2;
    const text = (value: string, xx: number, yy: number) => { ctx.strokeStyle = '#10141a'; ctx.lineWidth = 4; ctx.strokeText(value, xx, yy); ctx.fillStyle = '#fff'; ctx.fillText(value, xx, yy); ctx.lineWidth = 2; };
    const circle = (east: number, north: number, radius: number) => { ctx.beginPath(); ctx.arc(x(east), y(north), radius / span * w, 0, Math.PI * 2); ctx.stroke(); };
    ctx.strokeStyle = '#fff'; ctx.setLineDash([5, 4]);
    for (const radius of MAP_RING_RADII_M) circle(0, 0, radius);
    ctx.setLineDash([]);
    // Put the two labels on opposite sides, along the site -> passing-circle direction, so they never overlap.
    let ux = 1, uy = 0;
    if (r.nearest && Math.hypot(r.nearest.eastM, r.nearest.northM) > 1) {
      const dx = x(r.nearest.eastM) - x(0), dy = y(r.nearest.northM) - y(0), d = Math.hypot(dx, dy);
      ux = dx / d; uy = dy / d;
    }
    const label = (value: string, cx: number, cy: number, dirX: number, dirY: number, gap: number) => {
      ctx.textAlign = dirX < -0.3 ? 'right' : dirX > 0.3 ? 'left' : 'center';
      ctx.textBaseline = dirY < -0.3 ? 'bottom' : dirY > 0.3 ? 'top' : 'middle';
      text(value, cx + dirX * gap, cy + dirY * gap);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    };
    if (r.nearest) {
      ctx.strokeStyle = '#fff'; circle(r.nearest.eastM, r.nearest.northM, SAFE_CIRCLE_RADIUS_M);
      const sameSpot = Math.hypot(r.nearest.eastM, r.nearest.northM) <= 1;
      label(t('Passing circle'), x(r.nearest.eastM), y(r.nearest.northM), sameSpot ? 0 : ux, sameSpot ? -1 : uy, SAFE_CIRCLE_RADIUS_M / span * w + 8);
    }
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x(0) - 8, y(0)); ctx.lineTo(x(0) + 8, y(0)); ctx.moveTo(x(0), y(0) - 8); ctx.lineTo(x(0), y(0) + 8); ctx.stroke();
    label(t('Site'), x(0), y(0), -ux, r.nearest && Math.hypot(r.nearest.eastM, r.nearest.northM) <= 1 ? 1 : -uy, 12);
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(25, 55); ctx.lineTo(25, 20); ctx.lineTo(20, 28); ctx.moveTo(25, 20); ctx.lineTo(30, 28); ctx.stroke(); text(t('N'), 36, 30);
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(20, w - 22); ctx.lineTo(20 + SCALE_BAR_M / span * w, w - 22); ctx.stroke(); text(t('1 km'), 20, w - 30);
    mapImage.current = ctx.getImageData(0, 0, w, w);
  }, [r, lang]);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d');
    if (!r || !el || !ctx || !mapImage.current) return;
    ctx.putImageData(mapImage.current, 0, 0);
    const step = el.width / r.n, col = index % r.n, row = Math.floor(index / r.n);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(col * step - 3, row * step - 3, step + 6, step + 6);
  }, [r, index, lang]);
  const num = (v: number | null, digits = 1) => v === null || !Number.isFinite(v) ? t('Unknown') : v.toFixed(digits);
  return <section className="slope-card" aria-label={t('Slopes and landing area')}>
    <h2>{t('Slopes and landing area')}{siteName ? ` · ${siteName}` : ''}</h2>
    {!r && <p role="status">{state?.id === siteId && state.error ? t('Slope terrain unavailable for this site.') : t('Loading slope terrain…')}</p>}
    {r && <>
      <p>{t('From the 10 m LOLA-derived grid: real metre-scale hazards (boulders, small craters) are not resolved')}</p>
      <p>{t('Grid spacing: {0} m. Source: {1}.', { 0: r.resM, 1: data!.source })}</p>
      <p>{t('Slope map: 2 km in each direction from the site. Use arrow keys to inspect cells.')}</p>
      <canvas ref={canvas} width={600} height={600} tabIndex={0} role="img" aria-label={t('Slope map: 2 km in each direction from the site. Use arrow keys to inspect cells.')} aria-describedby={caption}
        onMouseMove={event => { const box = event.currentTarget.getBoundingClientRect(); const col = Math.max(0, Math.min(r.n - 1, Math.floor((event.clientX - box.left) / box.width * r.n))); const row = Math.max(0, Math.min(r.n - 1, Math.floor((event.clientY - box.top) / box.height * r.n))); setCursor({ id: siteId, index: row * r.n + col }); }}
        onKeyDown={event => { const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key]; if (!delta) return; event.preventDefault(); const row = Math.max(0, Math.min(r.n - 1, Math.floor(index / r.n) + delta[0])), col = Math.max(0, Math.min(r.n - 1, index % r.n + delta[1])); setCursor({ id: siteId, index: row * r.n + col }); }} />
      <p id={caption} aria-live="polite">{t('East {0} m; north {1} m. Slope {2}°. Curvature-corrected height relative to site: {3} m.', { 0: num(r.westM + index % r.n * r.resM), 1: num(r.northM - Math.floor(index / r.n) * r.resM), 2: num(r.slopes[index]), 3: num(r.heights[index]) })}</p>
      <ul className="slope-legend">{labels.map((label, i) => <li key={label}><span style={{ background: colors[i] }} aria-hidden="true">{patterns[i]}</span>{t(label)}</li>)}</ul>
      <p>{t('Cross: site. Dashed rings: 100 m and 500 m. Solid ring: nearest passing 100 m-radius circle.')}</p>
      <p><strong>{t('Site-cell slope: {0}°.', { 0: num(r.siteSlopeDeg) })}</strong></p>
      <ul className="slope-stats">{r.circles.map(c => <li key={c.radiusM}>{t('{0}% of the {1} m-radius landing circle is ≤ {2}°; {3}% is ≤ {4}°. Unknown: {5}%.', { 0: num(c.safePct), 1: c.radiusM, 2: SAFE_SLOPE_DEG, 3: num(c.moderatePct), 4: MODERATE_SLOPE_DEG, 5: num(c.unknownPct) })}</li>)}</ul>
      <p>{t('Largest site-centred passing radius (grid-step precision): {0} m.', { 0: num(r.largestRadiusM) })} {r.largestLimited && t('Limited by the 2 km analysis window.')}</p>
      <p>{r.nearest ? t('Nearest passing {0} m-radius circle: {1} m away; bearing {2}° clockwise from north.', { 0: SAFE_CIRCLE_RADIUS_M, 1: num(r.nearest.distanceM), 2: num(r.nearest.bearingDeg) }) : t('No fully known passing {0} m-radius circle found within {1} m.', { 0: SAFE_CIRCLE_RADIUS_M, 1: SEARCH_RADIUS_M })} {r.nearest?.distanceM === 0 && t('Already centred on the site; bearing is undefined.')}</p>
      <p>{t('Relief within 500 m: {0} m (known heights: {1}%).', { 0: num(r.reliefM), 1: num(r.reliefKnownPct) })}</p>
      <details><summary>{t('Slope method and screening assumptions')}</summary>
        <p>{t('Central differences span two grid steps. Add d²/(2R) to remove curvature, with R = {0} m. Heights and relief use this correction.', { 0: MOON_RADIUS_M })}</p>
        <p>{t('Passing means every sampled node is ≤ {0}° and known; {1}° is a second descriptive threshold. These are planning thresholds, not NASA safety requirements.', { 0: SAFE_SLOPE_DEG, 1: MODERATE_SLOPE_DEG })}</p>
        <p>{t('Percentages use all node centres inside each circle; unknown nodes remain in the denominator. A missing centre or neighbour makes slope unknown. Even grids use the southeast nearest node for site slope.')}</p>
        <p>{t('Circle radii advance by one grid step and exclude the first failing node. Search tests the exact site and grid nodes within 1 km; equal-distance ties prefer north, then west. Entirely passing refers to sampled nodes, not continuous terrain.')}</p>
        <p>{t('The 10 m sampling smooths small hazards: treat roughness as a lower-bound estimate, not a certified safe landing area. A symmetric peak can have a zero central-difference slope.')}</p>
      </details>
    </>}
  </section>;
}
