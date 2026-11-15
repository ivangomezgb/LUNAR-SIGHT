import { t } from '../i18n';
import { groupColor, groupLabel, shortName } from './format';
import { useMemo, useState } from 'react';
import type { Basemap, SiteIndexEntry } from '../lib/types';
import { dataUrl } from './hooks';

interface Props {
  sites: SiteIndexEntry[];
  basemap?: Basemap | null;
  selectedId: string | null;
  compareIds: string[];
  onSelect: (id: string) => void;
}

/** Marker outline per group, so groups differ by shape as well as colour. */
function markerPath(group: string, cx: number, cy: number, r: number): string {
  switch (group) {
    case 'clps': { const a = r * 0.9; return `M${cx - a},${cy - a}h${2 * a}v${2 * a}h${-2 * a}Z`; }
    case 'isro': { const a = r * 1.25; return `M${cx},${cy - a}L${cx + a},${cy}L${cx},${cy + a}L${cx - a},${cy}Z`; }
    case 'science': { const a = r * 1.3; return `M${cx},${cy - a}L${cx + a * 0.95},${cy + a * 0.7}L${cx - a * 0.95},${cy + a * 0.7}Z`; }
    default: return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
  }
}

const GROUP_COLOR: Record<string, string> = {
  artemis: '#f5c542',
  clps: '#5fd1b3',
  isro: '#ff8a5c',
  science: '#b49cff',
};
const VB = 400;

export default function SiteMap({ sites, basemap, selectedId, compareIds, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (basemap && sites.every((s) => Array.isArray(s.map_px))) {
      const xs = sites.map((s) => s.map_px[0]);
      const ys = sites.map((s) => s.map_px[1]);
      const minSpan = Math.min(basemap.width_px, basemap.height_px) * 0.25;
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const span = Math.max(x1 - x0, y1 - y0, minSpan) * 1.25;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      x0 = Math.max(0, cx - span / 2);
      y0 = Math.max(0, cy - span / 2);
      x1 = Math.min(basemap.width_px, x0 + span);
      y1 = Math.min(basemap.height_px, y0 + span);
      const s = Math.max(x1 - x0, y1 - y0);
      return {
        kind: 'basemap' as const,
        viewBox: `${x0} ${y0} ${s} ${s}`,
        unit: s / VB,
        pos: (site: SiteIndexEntry) => site.map_px as [number, number],
      };
    }
    const maxRho = Math.max(2, ...sites.map((s) => 90 + s.lat_deg));
    const R = Math.ceil(maxRho * 1.15);
    const scale = (VB / 2 - 26) / R;
    const pos = (site: SiteIndexEntry): [number, number] => {
      const rho = (90 + site.lat_deg) * scale;
      const th = (site.lon_deg * Math.PI) / 180;
      return [VB / 2 + rho * Math.sin(th), VB / 2 - rho * Math.cos(th)];
    };
    return { kind: 'grid' as const, viewBox: `0 0 ${VB} ${VB}`, unit: 1, pos, R, scale };
  }, [sites, basemap]);

  const u = layout.unit;
  const active = sites.find((site) => site.id === (hover ?? selectedId));
  // A projected distance, derived from the published affine transform. No assumed latitude scale.
  const mapMetresPerUnit = basemap ? Math.hypot(basemap.affine[0], basemap.affine[3]) : 0;
  const scaleKm = mapMetresPerUnit > 0 ? Math.pow(10, Math.floor(Math.log10(90 * u * mapMetresPerUnit / 1000))) : 0;
  const [mapX, mapY] = layout.viewBox.split(' ').map(Number);
  const ordered = [...sites].sort((a, b) => (a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0));

  return (
    <div className="sitemap">
      <svg viewBox={layout.viewBox} role="group" aria-label={t("Polar map of candidate landing sites around the lunar south pole")} className="sitemap-svg">
        {layout.kind === 'basemap' && basemap ? (
          <image href={dataUrl(basemap.image)} x={0} y={0} width={basemap.width_px} height={basemap.height_px} preserveAspectRatio="none" className="sitemap-img" />
        ) : (
          layout.kind === 'grid' && (
            <g className="polar-grid">
              <circle cx={VB / 2} cy={VB / 2} r={layout.R * layout.scale} className="pg-disc" />
              {Array.from({ length: layout.R }, (_, k) => k + 1).map((d) => (
                <g key={d}>
                  <circle cx={VB / 2} cy={VB / 2} r={d * layout.scale} className={d === layout.R ? 'pg-ring pg-outer' : 'pg-ring'} />
                  {(layout.R <= 6 || d % 2 === 0) && (
                    <text x={VB / 2 + 3} y={VB / 2 - d * layout.scale - 3} className="pg-label">
                      {-90 + d}°
                    </text>
                  )}
                </g>
              ))}
              {Array.from({ length: 12 }, (_, k) => k * 30).map((lon) => {
                const th = (lon * Math.PI) / 180;
                const r = layout.R * layout.scale;
                const lx = VB / 2 + (r + 13) * Math.sin(th);
                const ly = VB / 2 - (r + 13) * Math.cos(th) + 3;
                const lbl = lon === 0 ? '0°' : lon === 180 ? '180°' : lon < 180 ? `${lon}°E` : `${360 - lon}°W`;
                return (
                  <g key={lon}>
                    <line x1={VB / 2} y1={VB / 2} x2={VB / 2 + r * Math.sin(th)} y2={VB / 2 - r * Math.cos(th)} className="pg-meridian" />
                    <text x={lx} y={ly} textAnchor="middle" className="pg-label pg-lon">
                      {lbl}
                    </text>
                  </g>
                );
              })}
              <text x={VB / 2} y={VB / 2 + 12} textAnchor="middle" className="pg-pole"> {t("S. Pole")} </text>
            </g>
          )
        )}

        {layout.kind === 'basemap' && scaleKm > 0 && (
          <g className="map-scale" pointerEvents="none" transform={`translate(${mapX + 16 * u},${mapY + 376 * u})`}>
            <path d={`M0,${-5 * u}V0H${scaleKm * 1000 / mapMetresPerUnit}V${-5 * u}`} fill="none" strokeWidth={2 * u} />
            <text x={0} y={-10 * u} fontSize={10 * u} strokeWidth={3 * u}>{t('{0} km · map scale', { 0: scaleKm })}</text>
          </g>
        )}
        {ordered.map((s) => {
          const [cx, cy] = layout.pos(s);
          const sel = s.id === selectedId;
          const cmp = compareIds.includes(s.id);
          const show = sel || cmp || hover === s.id;
          const r = (sel ? 8 : 6) * u;
          return (
            <g
              key={s.id}
              className={`site-marker${sel ? ' is-selected' : ''}${cmp ? ' is-compare' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              aria-label={`${shortName(s.name)}, ${groupLabel(s.group)}, ${s.lat_deg.toFixed(2)}°, ${s.lon_deg.toFixed(2)}°${cmp ? t(", in comparison") : ''}`}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.id)}
              onBlur={() => setHover(null)}
            >
              <circle cx={cx} cy={cy} r={r + 8 * u} className="sm-hit" />
              {sel && <circle cx={cx} cy={cy} r={r + 6 * u} className="sm-halo" strokeWidth={2 * u} />}
              <path d={markerPath(s.group, cx, cy, r)} fill={groupColor(s.group)} className="sm-dot" strokeWidth={1.5 * u} />
              {cmp && <rect x={cx + r * 0.6} y={cy - r * 1.6} width={6 * u} height={6 * u} className="sm-cmp" />}
              {show && (
                <text x={cx + r + 5 * u} y={cy + 4 * u} className="sm-label" fontSize={12 * u} strokeWidth={3 * u}>
                  {shortName(s.name)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="map-readout" aria-live="polite" aria-atomic="true">
        {active && <><strong>{shortName(active.name)}</strong><span className="mono">{active.lat_deg.toFixed(3)}° · {active.lon_deg.toFixed(3)}°E</span><span>{active.dem_res_m} {t('m/px')} · {active.slope_deg_50m.toFixed(1)}{t('° slope (50 m)')}</span></>}
      </div>
      <div className="sitemap-legend">
        {Object.entries(GROUP_COLOR)
          .filter(([g]) => sites.some((s) => s.group === g))
          .map(([g, c]) => (
            <span key={g}>
              <svg viewBox="-8 -8 16 16" width="12" height="12" aria-hidden><path d={markerPath(g, 0, 0, 5)} fill={c} /></svg> {g === 'artemis' ? t("Artemis III") : g === 'clps' ? t("CLPS") : g === 'isro' ? t("ISRO") : t("Science")}
            </span>
          ))}
        <span>
          <i className="sm-cmp-swatch" /> {t("In comparison")} </span>
        {layout.kind === 'grid' && <span className="muted">{t("Schematic polar grid (no basemap)")}</span>}
      </div>
    </div>
  );
}
