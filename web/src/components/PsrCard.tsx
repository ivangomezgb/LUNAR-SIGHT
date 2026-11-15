import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { loadPsr, type PsrData, type PsrSite } from '../lib/data';
import '../styles/psr.css';

const SIZE = 320; // canvas px for the +-10 km overlay

function decodeBits(b64: string, n: number): Uint8Array {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

function compass(deg: number): string {
  return t(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
}

function PsrMap({ s }: { s: PsrSite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const o = s.overlay, bits = decodeBits(o.bits, o.n_rows * o.n_cols);
    const scale = SIZE / Math.max(o.n_rows, o.n_cols);
    ctx.fillStyle = '#10151c';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // PSR pixels: solid blue-grey with a diagonal hatch so the cue is not colour-only.
    ctx.fillStyle = '#3d6fb0';
    for (let r = 0; r < o.n_rows; r++) for (let c = 0; c < o.n_cols; c++) if (bits[r * o.n_cols + c]) ctx.fillRect(c * scale, r * scale, Math.ceil(scale), Math.ceil(scale));
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = 'rgba(220,235,255,.55)';
    ctx.lineWidth = 1;
    for (let k = -SIZE; k < SIZE * 2; k += 6) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - SIZE, SIZE); ctx.stroke(); }
    ctx.restore();
    // Repaint non-PSR background over the hatch lines drawn outside PSR pixels.
    ctx.fillStyle = '#10151c';
    for (let r = 0; r < o.n_rows; r++) for (let c = 0; c < o.n_cols; c++) if (!bits[r * o.n_cols + c]) ctx.fillRect(c * scale, r * scale, Math.ceil(scale), Math.ceil(scale));
    const sx = (o.site_col + 0.5) * scale, sy = (o.site_row + 0.5) * scale, kmPx = 1000 / o.res_m * scale;
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.setLineDash([4, 4]);
    for (const km of [5, 10]) { ctx.beginPath(); ctx.arc(sx, sy, km * kmPx, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy + 9); ctx.stroke();
    // North arrow (local north rotated in the polar-stereographic map) and a 2 km scale bar.
    ctx.save(); ctx.translate(28, 34); ctx.rotate((o.north_deg_from_up * Math.PI) / 180);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -14); ctx.moveTo(-5, -7); ctx.lineTo(0, -14); ctx.lineTo(5, -7); ctx.stroke();
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(t('N'), 0, -18);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(14, SIZE - 16); ctx.lineTo(14 + 2 * kmPx, SIZE - 16); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(t('2 km'), 14, SIZE - 22);
  }, [s]);
  return <canvas ref={ref} width={SIZE} height={SIZE} className="psr-map" role="img"
    aria-label={t('Permanently shadowed regions within 10 km of the site, hatched; rings at 5 and 10 km.')} />;
}

export default function PsrCard({ siteId, siteName }: { siteId: string; siteName?: string }) {
  const [data, setData] = useState<PsrData | null>(null), [error, setError] = useState('');
  useEffect(() => { loadPsr().then(setData).catch(() => setError(t('PSR data unavailable'))); }, []);
  const s = data?.sites[siteId];
  return (
    <section className="card psr-card" aria-label={t('Permanently shadowed regions')}>
      <h2 className="card-title">{t('Permanently shadowed regions')}{siteName ? ` · ${siteName}` : ''}</h2>
      <p className="small muted">{t('Places the Sun never reaches over an 18.6-year lunar cycle: cold traps where water ice may survive (presence is not implied).')}</p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">{t('Loading data…')}</p>}
      {data && !s && <p className="muted">{t('No PSR data for this site.')}</p>}
      {s && (
        <div className="psr-body">
          <PsrMap s={s} />
          <div>
            {s.nearest ? (
              <dl className="psr-stats">
                <div><dt>{t('Nearest PSR')}</dt><dd>{s.nearest.distance_km.toFixed(2)} km · {s.nearest.bearing_deg.toFixed(0)}° {compass(s.nearest.bearing_deg)}</dd></div>
                <div><dt>{t('Its area')}</dt><dd>{s.nearest.area_is_lower_bound ? '≥ ' : ''}{s.nearest.area_km2.toFixed(3)} km²</dd></div>
                {Object.entries(s.psr_area_km2_within).map(([km, a]) => (
                  <div key={km}><dt>{t('PSR area within {0} km', { 0: km })}</dt><dd>{a.toFixed(2)} km²</dd></div>
                ))}
                <div><dt>{t('Long-term sunlight (published)')}</dt><dd>{s.avg_sun_any_disc_pct.toFixed(1)} %</dd></div>
                <div><dt>{t('Long-term Earth visibility (published)')}</dt><dd>{s.avg_earth_any_disc_pct.toFixed(1)} %</dd></div>
              </dl>
            ) : (
              <p>{t('No PSR within {0} km.', { 0: s.search_radius_km })}</p>
            )}
            <p className="small muted">
              {t('Source: LOLA PSR and average-visibility maps ({0}, {1} m/px), Mazarico et al. 2011.', { 0: s.product, 1: s.resolution_m })}{' '}
              <a href={data!.source} target="_blank" rel="noreferrer">PGDA 69</a>.{' '}
              {t('Long-term values count hours with any part of the disc visible over ~18.6 years; they differ from our mission metrics by definition.')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
