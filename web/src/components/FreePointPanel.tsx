import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n';
import { useApp } from '../state';
import { loadBasemap, loadSite, loadSites } from '../lib/data';
import { nearestCurated, pointFromMapPixel } from '../lib/freepoint';
import type { FreeResult } from '../lib/freepoint';
import type { Basemap, SiteData, SiteIndexEntry } from '../lib/types';
import { computeMetrics, DEFAULT_ASSUMPTIONS } from '../lib/metrics';
import PanoramaChart from './PanoramaChart';
import MetricCards from './MetricCards';

const dataBase = () => import.meta.env.BASE_URL + (import.meta.env.VITE_DATA_DIR ?? 'data').replace(/\/$/, '') + '/';

export default function FreePointPanel({ lat, lon, onClose }: { lat: number; lon: number; onClose?: () => void }) {
  const lang = useApp(s => s.lang);
  const titleId = useId();
  const [state, setState] = useState<{ point: string; progress: number; result?: FreeResult; error?: string }>({ point: '', progress: 0 });
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [comparison, setComparison] = useState<SiteData | null>(null);
  const [height, setHeight] = useState(2);
  const point = `${lat},${lon}`;
  useEffect(() => {
    let active = true;
    loadSites().then(s => { if (active) setSites(s); }).catch(() => { /* Analysis remains available without comparison. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const worker = new Worker(new URL('../lib/freepoint.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.kind === 'progress') setState({ point, progress: data.progress });
      else if (data.kind === 'result') setState({ point, progress: 1, result: data.result });
      else setState({ point, progress: 0, error: data.error });
    };
    worker.onerror = () => setState({ point, progress: 0, error: 'Free-coordinate calculation failed' });
    worker.postMessage({ lat, lon, base: new URL(dataBase() + 'free/', window.location.href).href });
    return () => worker.terminate();
  }, [lat, lon, point]);
  const nearest = useMemo(() => nearestCurated(lat, lon, sites), [lat, lon, sites]);
  useEffect(() => {
    let active = true;
    if (nearest) loadSite(nearest.id).then(s => { if (active) setComparison(s); }).catch(() => { /* Omit unavailable comparison. */ });
    return () => { active = false; };
  }, [nearest]);
  const result = state.point === point ? state.result : undefined;
  const assumptions = { ...DEFAULT_ASSUMPTIONS, heightM: height };
  const metrics = result ? computeMetrics(result.site, '2027-01-01T00:00:00Z', 365 * 24, assumptions) : null;
  const reference = comparison?.id === nearest?.id && comparison ? computeMetrics(comparison, '2027-01-01T00:00:00Z', 365 * 24, assumptions) : null;
  const accuracy = result?.accuracy;
  return <section lang={lang} aria-labelledby={titleId} style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <h2 id={titleId}>{t('Free coordinates')}</h2>
    {onClose && <button type="button" onClick={onClose}>{t('Close free point')}</button>}
    <p>{t('Latitude {0}°, longitude {1}° east', { 0: lat.toFixed(5), 1: lon.toFixed(5) })}</p>
    <p><strong>{t('Approximate - coarse DEM (~240 m), no 5 m near field')}</strong></p>
    <p>{t('2027 UTC, hourly. Sun radius 0.267°; day ≥ 50% of disk; Earth centre ≥ 0.5° above horizon. Heights 1/2/5/10 m, default 2 m. Horizon every 0.5°, rays from 240 m to 200 km. Outer DEM: 960 m block maxima; 1 m height rounding. Spherical Moon: 1737.4 km. No local slopes or uncertainty interval are inferred.')}</p>
    <label>{t('Observer height')} <select value={height} onChange={e => setHeight(Number(e.target.value))}>
      {[1, 2, 5, 10].map(h => <option key={h} value={h}>{t('{0} m', { 0: h })}</option>)}
    </select></label>
    <div role="status" aria-live="polite">
      {!result && !(state.point === point && state.error) && <>
        <p>{t('Loading terrain and computing horizon…')}</p>
        <progress aria-label={t('Horizon progress')} max={1} value={state.point === point ? state.progress : 0} style={{ maxWidth: '100%' }} />
      </>}
      {state.point === point && state.error && <p role="alert">{t(state.error)}. {t('Select another point or reopen this view to retry.')}</p>}
    </div>
    {result && <>
      {accuracy ? <p>{t('Measured at {0} curated sites, 2 m: mask absolute error mean {1}°, max {2}°; 2027 sunlight difference mean {3}, max {4} percentage points. These are comparisons, not error bounds for other points or heights.', {
        0: accuracy.sites, 1: accuracy.mask_mean_deg.toFixed(2), 2: accuracy.mask_max_deg.toFixed(2),
        3: accuracy.sunlight_mean_pp.toFixed(2), 4: accuracy.sunlight_max_pp.toFixed(2),
      })}</p> : <p>{t('Accuracy has not been measured. Do not treat this coarse result as a curated-site prediction.')}</p>}
      <p>{t('Calculation: {0} ms on this device. Phone target: under 3 s, not guaranteed.', { 0: Math.round(result.elapsedMs) })}</p>
      {metrics && <MetricCards metrics={metrics} />}
      <PanoramaChart maskCdeg={result.site.horizon.elev_cdeg[String(height)]} stepDeg={0.5} compact height={180}
        elMin={Math.min(-5, ...result.site.horizon.elev_cdeg[String(height)].map(v => v / 100 - 1))}
        elMax={Math.max(5, ...result.site.horizon.elev_cdeg[String(height)].map(v => v / 100 + 1))}
        ariaLabel={t('Approximate horizon silhouette')} />
      {nearest && <details>
        <summary>{t('Compare with nearest curated site: {0}', { 0: nearest.name })}</summary>
        {reference && <p>{t('Curated 2027 sunlight {0}%, Earth visibility {1}%, longest night {2} h (same height and thresholds).', {
          0: reference.lightPct.toFixed(1), 1: reference.earthPct.toFixed(1), 2: reference.longestNightH,
        })}</p>}
        <Link to="/compare" onClick={() => { useApp.getState().setCompare([nearest.id]); useApp.getState().setAssumptions({ heightM: height }); }}>
          {t('Open curated comparison')}
        </Link>
      </details>}
      {!nearest && <p>{t('Nearest curated site unavailable.')}</p>}
    </>}
  </section>;
}

/** Optional standalone route: click the full basemap, or enter coordinates with a keyboard. */
export function FreePointExplorer() {
  const lang = useApp(s => s.lang);
  const [map, setMap] = useState<Basemap | null>(null);
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState('');
  const formId = useId();
  useEffect(() => {
    let active = true;
    loadBasemap().then(m => { if (active) setMap(m); }).catch(() => { if (active) setError('Basemap unavailable'); });
    return () => { active = false; };
  }, []);
  return <main lang={lang} style={{ width: '100%', minWidth: 0, maxWidth: 900, margin: '0 auto', overflowWrap: 'anywhere' }}>
    <h1>{t('Free coordinates')}</h1>
    <p>{t('Click anywhere within the basemap, or enter latitude and longitude below. The square map includes corners north of 84°S. Results use coarse terrain.')}</p>
    {map && <svg viewBox={`0 0 ${map.width_px} ${map.height_px}`} style={{ display: 'block', width: '100%', maxHeight: '55vh' }}
      role="img" aria-label={t('Free-coordinate polar map; use the coordinate form for keyboard selection')}
      onClick={e => {
        const matrix = e.currentTarget.getScreenCTM();
        if (!matrix) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
        try { setPoint(pointFromMapPixel(map, p.x, p.y)); setError(''); }
        catch { setError('Point outside basemap'); }
      }}>
      <image href={dataBase() + map.image} width={map.width_px} height={map.height_px} />
    </svg>}
    <form onSubmit={e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      setPoint({ lat: Number(data.get('lat')), lon: Number(data.get('lon')) });
      setError('');
    }} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBlock: 16 }}>
      <label htmlFor={formId + '-lat'}>{t('Latitude (degrees)')}<input id={formId + '-lat'} name="lat" type="number" min={-90} max={0} step="any" required style={{ display: 'block', width: 130, maxWidth: '100%' }} /></label>
      <label htmlFor={formId + '-lon'}>{t('Longitude (east degrees)')}<input id={formId + '-lon'} name="lon" type="number" min={-180} max={180} step="any" required style={{ display: 'block', width: 130, maxWidth: '100%' }} /></label>
      <button type="submit">{t('Calculate free point')}</button>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {point && <FreePointPanel {...point} onClose={() => setPoint(null)} />}
  </main>;
}
