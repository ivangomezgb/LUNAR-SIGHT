import { useId, useState } from 'react';
import { t } from '../i18n';
import { pointFromMapPixel, polarXY } from '../lib/freepoint';
import type { Basemap, SiteIndexEntry } from '../lib/types';

export interface FreePoint { lat: number; lon: number }
// Shared only with FreePointPanel; kept here to respect the two-component ownership boundary.
// eslint-disable-next-line react-refresh/only-export-components
export const freeDataBase = () => import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/';
/** Invert the published affine, rather than assuming CSS pixels are map pixels. */
function mapPixel(map: Basemap, point: FreePoint): [number, number] {
  const [x, y] = polarXY(point.lat, point.lon);
  const [a, b, c, d, e, f] = map.affine, det = a * e - b * d;
  return [(e * (x - c) - b * (y - f)) / det, (a * (y - f) - d * (x - c)) / det];
}
// eslint-disable-next-line react-refresh/only-export-components
export function withinMap(map: Basemap, point: FreePoint) {
  if (!Number.isFinite(point.lat + point.lon) || point.lat < -90 || point.lat >= 0 || Math.abs(point.lon) > 180) return false;
  const [x, y] = mapPixel(map, point);
  return x >= -1e-8 && y >= -1e-8 && x <= map.width_px + 1e-8 && y <= map.height_px + 1e-8;
}

export default function FreePointMap({ map, sites, point, onSelect }: {
  map: Basemap; sites: SiteIndexEntry[]; point: FreePoint | null; onSelect: (point: FreePoint) => void;
}) {
  const id = useId();
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState(false);
  const [hover, setHover] = useState<SiteIndexEntry | null>(null);
  const w = map.width_px, h = map.height_px;
  const selected = point ? mapPixel(map, point) : null;
  const current = cursor ?? selected ?? [w / 2, h / 2];
  const readout = pointFromMapPixel(map, ...current as [number, number]);
  const metresPerPixel = Math.hypot(map.affine[0], map.affine[3]);
  const crop = 36000 / metresPerPixel;
  const cropX = selected ? Math.max(0, Math.min(w - crop, selected[0] - crop / 2)) : 0;
  const cropY = selected ? Math.max(0, Math.min(h - crop, selected[1] - crop / 2)) : 0;
  const pin = (x: number, y: number, size: number) => <g transform={`translate(${x} ${y}) scale(${size})`} className="free-pin" aria-hidden="true">
    <circle className="free-pulse" r="20" /><path d="M-26 0H-10 M10 0H26 M0 -26V-10 M0 10V26" />
    <path className="free-pin-body" d="M0 0C-5 -7 -12 -12 -12 -21A12 12 0 0 1 12 -21C12 -12 5 -7 0 0Z" /><circle cx="0" cy="-21" r="4" />
  </g>;
  return <div className="free-map-layout">
    <div>
      <svg className="free-map" viewBox={`0 0 ${w} ${h}`} role="group" tabIndex={0}
        aria-label={t('Select a lunar point')} aria-describedby={id + '-help'}
        onPointerMove={event => {
          setKeyboardCursor(false);
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          setCursor([Math.max(0, Math.min(w, p.x)), Math.max(0, Math.min(h, p.y))]);
        }} onPointerLeave={() => setCursor(null)}
        onClick={event => {
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
          if (p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h) onSelect(pointFromMapPixel(map, p.x, p.y));
        }} onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          const step = (event.shiftKey ? 5000 : 1000) / metresPerPixel;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[event.key]) {
            setKeyboardCursor(true);
            event.preventDefault(); const [dx, dy] = moves[event.key];
            setCursor([Math.max(0, Math.min(w, current[0] + dx)), Math.max(0, Math.min(h, current[1] + dy))]);
          } else if (event.key === 'Enter') { event.preventDefault(); onSelect(readout); }
        }}>
        <image href={freeDataBase() + map.image} width={w} height={h} />
        <g className="free-graticule" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => -89 + i).map(lat => {
            const centre = mapPixel(map, { lat: -90, lon: 0 });
            const north = mapPixel(map, { lat, lon: 0 });
            const r = Math.hypot(north[0] - centre[0], north[1] - centre[1]);
            return <g key={lat}><circle cx={centre[0]} cy={centre[1]} r={r} /><text x={north[0] + 12} y={north[1] + 30}>{lat}°</text></g>;
          })}
          {Array.from({ length: 12 }, (_, i) => i * 30).map(lon => {
            const centre = mapPixel(map, { lat: -90, lon: 0 });
            const edge = mapPixel(map, { lat: -78, lon });
            const dx = edge[0] - centre[0], dy = edge[1] - centre[1];
            const ratio = Math.min((w / 2 - 85) / Math.abs(dx), (h / 2 - 85) / Math.abs(dy));
            return <g key={lon}><path d={`M${centre}L${edge}`} /><text textAnchor="middle" x={centre[0] + dx * ratio} y={centre[1] + dy * ratio}>{lon > 180 ? lon - 360 : lon}°</text></g>;
          })}
        </g>
        {sites.map(site => {
          const [x, y] = mapPixel(map, { lat: site.lat_deg, lon: site.lon_deg });
          return <g key={site.id} className="free-reference" role="button" tabIndex={0} aria-label={t('Select {0}', { 0: site.name })}
            onFocus={() => setHover(site)} onBlur={() => setHover(null)} onPointerEnter={() => setHover(site)} onPointerLeave={() => setHover(null)}
            onClick={e => { e.stopPropagation(); onSelect({ lat: site.lat_deg, lon: site.lon_deg }); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect({ lat: site.lat_deg, lon: site.lon_deg }); } }}>
            <title>{site.name}</title><circle className="free-reference-hit" cx={x} cy={y} r="38" /><circle cx={x} cy={y} r="10" />
          </g>;
        })}
        {selected && pin(...selected, w / 650)}
        {cursor && <path className="free-cursor" d={`M${cursor[0] - 25},${cursor[1]}h50 M${cursor[0]},${cursor[1] - 25}v50`} />}
        <g className="free-scale" transform={`translate(70 ${h - 95})`}><path d={`M0 -10V0H${50000 / metresPerPixel}V-10`} /><text y="40">{t('50 km · polar scale')}</text></g>
      </svg>
      <div className="free-map-readout mono" aria-live={keyboardCursor ? 'polite' : 'off'}>{t('Cursor: {0}° lat, {1}° east', { 0: readout.lat.toFixed(5), 1: readout.lon.toFixed(5) })}</div>
      <div className="free-site-name" role="status">{hover ? hover.name : t('{0} curated reference sites', { 0: sites.length })}</div>
      <p className="small" id={id + '-help'}>{t('Click anywhere. Arrow keys move 1 km; Shift moves 5 km; Enter selects. Distances use the polar map scale.')}</p>
    </div>
    <aside className="free-inset">
      <div className="eyebrow">{t('Surface detail')}</div>
      {selected ? <>
        <svg viewBox={`${cropX} ${cropY} ${crop} ${crop}`} role="img" aria-label={t('Magnified real basemap around the selected point')}>
          <image href={freeDataBase() + map.image} width={w} height={h} />
          {pin(...selected, crop / 250)}
          <g className="free-inset-scale" transform={`translate(${cropX + crop * .08} ${cropY + crop * .88}) scale(${crop / 250})`}><path d="M0 -4V0H69.44V-4" /><text y="18">{t('10 km · polar scale')}</text></g>
        </svg>
        <p className="small">{t('36 km crop of the same LOLA basemap. No generated imagery; detail is limited by source resolution.')}</p>
      </> : <p>{t('Choose a point to inspect the real surface here.')}</p>}
    </aside>
  </div>;
}
