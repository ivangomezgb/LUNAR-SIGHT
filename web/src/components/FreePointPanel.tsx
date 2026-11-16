import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { t } from '../i18n';
import { useApp } from '../state';
import { loadBasemap, loadSite, loadSites } from '../lib/data';
import { MOON_RADIUS_M, nearestCurated } from '../lib/freepoint';
import type { FreeResult } from '../lib/freepoint';
import type { Basemap, SiteData, SiteIndexEntry, Metrics } from '../lib/types';
import type { Trail } from '../lib/terrain';
import { computeMetrics, getSeries, hourIndex } from '../lib/metrics';
import Panorama from './Panorama';
import MetricCards from './MetricCards';
import Timeline from './Timeline';
import LandingRisk from './LandingRisk';
import DateTimePicker from './DateTimePicker';
import { coverage } from './series';
import { HOUR_MS, isoHour, parseUtc } from './format';
import FreePointMap, { freeDataBase, withinMap, type FreePoint } from './FreePointMap';
import '../styles/freepoint.css';
import { StopBadge } from '../guide/TourBits';

const FreePoint3D = lazy(() => import('./FreePoint3D'));

function useMission() {
  const [params, setParams] = useSearchParams();
  const storedLanding = useApp(s => s.landingUtc), storedDays = useApp(s => s.missionDays);
  const assumptions = useApp(s => s.assumptions);
  const parsed = parseUtc(params.get('t'));
  const landingUtc = parsed ? isoHour(Math.floor(parsed.getTime() / HOUR_MS) * HOUR_MS) : storedLanding;
  const d = Number(params.get('days')), h = Number(params.get('h'));
  const days = Number.isInteger(d) && d >= 1 && d <= 60 ? d : storedDays;
  const height = [1, 2, 5, 10].includes(h) ? h : assumptions.heightM;
  useEffect(() => {
    const store = useApp.getState();
    if (store.landingUtc !== landingUtc) { store.setPlaying(false); store.setLanding(landingUtc); }
    if (store.missionDays !== days) store.setMissionDays(days);
    if (store.assumptions.heightM !== height) store.setAssumptions({ heightM: height });
  }, [landingUtc, days, height]);
  const update = (values: Record<string, string | null>) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('t', landingUtc); next.set('days', String(days)); next.set('h', String(height));
    Object.entries(values).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
    return next;
  }, { replace: true });
  return { landingUtc, days, height, assumptions: useMemo(() => ({ ...assumptions, heightM: height }), [assumptions, height]), update };
}
function dms(value: number) {
  const seconds = Math.round(Math.abs(value) * 3600);
  return `${value < 0 ? '−' : ''}${Math.floor(seconds / 3600)}° ${Math.floor(seconds % 3600 / 60)}′ ${seconds % 60}″`;
}
function separation(point: FreePoint, site: SiteIndexEntry) {
  const rad = Math.PI / 180, a = point.lat * rad, b = site.lat_deg * rad, delta = (site.lon_deg - point.lon) * rad;
  const hav = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(delta / 2) ** 2;
  const km = 2 * MOON_RADIUS_M / 1000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, hav))));
  const bearing = (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / rad + 360) % 360;
  return { km, bearing };
}

export default function FreePointPanel({ lat, lon, onClose }: FreePoint & { onClose?: () => void }) {
  const lang = useApp(s => s.lang), id = useId();
  const mission = useMission();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; progress: number; result?: FreeResult; error?: string }>({ key: '', progress: 0 });
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [referenceState, setReferenceState] = useState<{ id: string; data?: SiteData; error?: boolean }>({ id: '' });
  const [referenceAttempt, setReferenceAttempt] = useState(0);
  const key = `${lat},${lon},${attempt}`;
  useEffect(() => () => useApp.getState().setPlaying(false), []);
  useEffect(() => {
    let active = true;
    loadSites().then(value => { if (active) setSites(value); }).catch(() => { if (active) setReferenceState({ id: '', error: true }); });
    return () => { active = false; };
  }, [referenceAttempt]);
  useEffect(() => {
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('../lib/freepoint.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.kind === 'progress') setState({ key, progress: data.progress });
        else if (data.kind === 'result') setState({ key, progress: 1, result: data.result });
        else setState({ key, progress: 0, error: data.error });
      };
      worker.onerror = () => setState({ key, progress: 0, error: 'Free-coordinate calculation failed' });
      worker.postMessage({ lat, lon, base: new URL(freeDataBase() + 'free/', window.location.href).href });
    } catch { setState({ key, progress: 0, error: 'Free-coordinate calculation failed' }); }
    return () => worker?.terminate();
  }, [lat, lon, key]);
  const nearest = useMemo(() => nearestCurated(lat, lon, sites), [lat, lon, sites]);
  useEffect(() => {
    if (!nearest) return;
    let active = true;
    loadSite(nearest.id).then(data => { if (active) setReferenceState({ id: nearest.id, data }); })
      .catch(() => { if (active) setReferenceState({ id: nearest.id, error: true }); });
    return () => { active = false; };
  }, [nearest, referenceAttempt]);
  const result = state.key === key ? state.result : undefined;
  const error = state.key === key ? state.error : undefined;
  const distance = nearest ? separation({ lat, lon }, nearest) : null;
  const accuracy = result?.accuracy;
  return <div className="free-results" lang={lang}>
    <header className="card free-point-header" aria-labelledby={id}>
      <div className="card-head"><div><div className="eyebrow">{t('Selected landing point')}</div><h2 id={id}>{lat.toFixed(5)}°, {lon.toFixed(5)}°</h2></div>
        {onClose && <button className="btn btn-ghost" onClick={onClose}>{t('Close free point')}</button>}</div>
      <p className="mono">{t('{0} latitude · {1} east longitude', { 0: dms(lat), 1: dms(lon) })}</p>
      <div className="free-facts">
        <div><span className="eyebrow">{t('Coarse DEM elevation')}</span><strong>{result ? t('{0} m', { 0: result.elevationM.toFixed(0) }) : '—'}</strong><span className="small">{t('Above the 1737.4 km lunar reference sphere')}</span></div>
        <div><span className="eyebrow">{t('Nearest curated site')}</span>{nearest && distance ? <><Link to={`/?focus=site&site=${encodeURIComponent(nearest.id)}&t=${encodeURIComponent(mission.landingUtc)}&days=${mission.days}&h=${mission.height}&lang=${lang}`}>{nearest.name}</Link><span className="small">{distance.km < .001 ? t('At the curated point; bearing undefined') : t('{0} km · bearing {1}° from north', { 0: distance.km.toFixed(2), 1: distance.bearing.toFixed(1) })}</span></> : <span>{t('Nearest curated site unavailable.')}</span>}</div>
      </div>
      <div className="free-accuracy" role="note"><strong className="badge badge-warn">{t('Approximate - coarse DEM')}</strong>
        <p>{t('240 m terrain + 960 m outer grid; no 5 m near field. Nearby obstacles may be missed. No local slope or uncertainty interval is inferred.')}</p>
        {accuracy ? <p>{t('Measured at {0} curated sites, 2 m: mask absolute error mean {1}°, max {2}°; 2027 sunlight difference mean {3}, max {4} percentage points. These are comparisons, not error bounds for other points or heights.', { 0: accuracy.sites, 1: accuracy.mask_mean_deg.toFixed(2), 2: accuracy.mask_max_deg.toFixed(2), 3: accuracy.sunlight_mean_pp.toFixed(2), 4: accuracy.sunlight_max_pp.toFixed(2) })}</p> : <p>{result ? t('Accuracy has not been measured. Do not treat this coarse result as a curated-site prediction.') : t('Measured accuracy will appear when the terrain calculation completes.')}</p>}
      </div>
    </header>
    <section className="card"><h2 className="card-title">{t('Mission')}</h2>
      <DateTimePicker idPrefix={id} landingUtc={mission.landingUtc} missionDays={mission.days}
        onLanding={value => mission.update({ t: value })} onMissionDays={value => mission.update({ days: String(value) })}
        {...(result ? { minMs: coverage(result.site)[0], maxMs: coverage(result.site)[1] } : {})} />
      <label className="free-height">{t('Observer height')} <select className="select" value={mission.height} onChange={e => mission.update({ h: e.target.value })}>{[1, 2, 5, 10].map(h => <option key={h} value={h}>{t('{0} m', { 0: h })}</option>)}</select></label>
    </section>
    {!result && <section className="card" aria-busy={!error}>
      {error ? <div role="alert"><p>{t(error)}</p><button className="btn btn-primary" onClick={() => setAttempt(a => a + 1)}>{t('Retry calculation')}</button></div> : <>
        <p role="status">{t('Loading terrain and computing horizon…')}</p><progress max={1} value={state.key === key ? state.progress : 0} aria-label={t('Horizon progress')} />
        <div className="free-skeleton" aria-hidden="true">{[0, 1, 2, 3].map(i => <div key={i} />)}</div>
      </>}
    </section>}
    {result && <FreeResults result={result} lat={lat} lon={lon} mission={mission} nearest={nearest}
      reference={referenceState.id === nearest?.id ? referenceState.data : undefined}
      referenceError={referenceState.error === true && (!nearest || referenceState.id === nearest.id)}
      retryReference={() => setReferenceAttempt(a => a + 1)} />}
  </div>;
}

function FreeResults({ result, lat, lon, mission, nearest, reference, referenceError, retryReference }: {
  result: FreeResult; lat: number; lon: number; mission: ReturnType<typeof useMission>; nearest?: SiteIndexEntry;
  reference?: SiteData; referenceError: boolean; retryReference: () => void;
}) {
  const cursorH = useApp(s => s.cursorH);
  const { site } = result, { landingUtc, days, assumptions } = mission;
  const [c0, c1] = coverage(site), landMs = Date.parse(landingUtc), hours = days * 24;
  const covered = landMs >= c0 && landMs + hours * HOUR_MS <= c1;
  const series = useMemo(() => getSeries(site, assumptions), [site, assumptions]);
  const metrics = useMemo(() => covered ? computeMetrics(site, landingUtc, hours, assumptions) : null, [site, landingUtc, hours, assumptions, covered]);
  const comparison = useMemo(() => {
    if (!reference || !covered || !reference.horizon.elev_cdeg[String(assumptions.heightM)]) return null;
    const [start, end] = coverage(reference);
    return landMs >= start && landMs + hours * HOUR_MS <= end ? computeMetrics(reference, landingUtc, hours, assumptions) : null;
  }, [reference, covered, landMs, hours, landingUtc, assumptions]);
  const trails = useMemo(() => {
    // Trail contract uses the 2 m mask, independent of the metric height selector.
    const s = getSeries(site, { ...assumptions, heightM: 2 });
    const start = Math.min(site.ephem.n - 1, Math.max(0, hourIndex(site, landingUtc))), end = Math.min(site.ephem.n, start + 14 * 24 + 1);
    const trail = (body: 'sun' | 'earth'): Trail => ({ az: s[body === 'sun' ? 'sunAz' : 'earthAz'].slice(start, end), el: s[body === 'sun' ? 'sunEl' : 'earthEl'].slice(start, end),
      visible: Array.from({ length: end - start }, (_, k) => body === 'sun' ? s.sunFrac[start + k] >= assumptions.dayFraction : s.earthVis[start + k] > 0),
      dayMarks: Array.from({ length: Math.floor((end - start - 1) / 24) }, (_, k) => (k + 1) * 24) });
    return { sunTrail: trail('sun'), earthTrail: trail('earth') };
  }, [site, assumptions, landingUtc]);
  const i = hourIndex(site, new Date(landMs + Math.floor(cursorH) * HOUR_MS));
  const viewProps = i >= 0 && i < site.ephem.n ? { lat, lon, elevationM: result.elevationM,
    sunAz: series.sunAz[i], sunEl: series.sunEl[i], earthAz: series.earthAz[i], earthEl: series.earthEl[i], ...trails } : null;
  if (!covered) return <section className="card" role="alert"><h2>{t('Landing time outside data coverage')}</h2><p>{t('Choose a landing time so the entire mission fits between {0} and {1}.', { 0: new Date(c0).toISOString(), 1: new Date(c1).toISOString() })}</p><button className="btn" onClick={() => mission.update({ t: isoHour(Math.max(c0, Math.min(landMs, c1 - hours * HOUR_MS))) })}>{t('Move into range')}</button></section>;
  const scrub = (h: number) => { useApp.getState().setPlaying(false); useApp.getState().setCursorH(Math.max(0, Math.min(hours, h))); };
  return <>
    <section className="card free-3d-slot" data-lat={lat} data-lon={lon} data-ready={Boolean(viewProps)}><h2 className="card-title">{t('Realistic view')}</h2>{viewProps && <Suspense fallback={<p role="status">{t('Loading 3D viewer…')}</p>}><FreePoint3D {...viewProps} /></Suspense>}</section>
    <Panorama site={site} />
    {metrics && <MetricCards metrics={metrics} site={site} />}
    <section className="card"><div className="card-head"><h2 className="card-title">{t('30-day timeline')}</h2><span className="small">{t('Click inside the window to scrub, outside to move the landing')}</span></div>
      <Timeline site={site} series={series} startMs={Math.max(c0, Math.floor(landMs / (24 * HOUR_MS)) * 24 * HOUR_MS - 3 * 24 * HOUR_MS)} days={30} landingUtc={landingUtc} missionH={hours} dayFraction={assumptions.dayFraction} cursorH={cursorH}
        onPick={ms => { const h = (ms - landMs) / HOUR_MS; if (h >= 0 && h <= hours) scrub(h); else { useApp.getState().setPlaying(false); mission.update({ t: isoHour(ms) }); } }} onKeyStep={h => scrub(cursorH + h)} />
    </section>
    <LandingRisk site={site} utc={landingUtc} assumptions={assumptions} />
    <section className="card"><h2 className="card-title">{t('Compare with the nearest curated site')}</h2><p className="small">{t('Same landing time, mission duration, observer height and visibility thresholds. The curated site includes finer terrain.')}</p>
      {metrics && comparison && nearest ? <Comparison chosen={metrics} reference={comparison} name={nearest.name} /> : <p role="status">{referenceError ? t('Curated comparison unavailable.') : reference ? t('Curated data does not cover this mission or observer height.') : t('Loading curated comparison…')}</p>}
      {referenceError && <button className="btn btn-ghost" onClick={retryReference}>{t('Retry comparison')}</button>}
    </section>
    <details className="card"><summary>{t('Calculation details')}</summary><p>{t('Hourly SPICE positions; horizon every 0.5° out to 200 km. Sun radius 0.267°. No atmospheric refraction.')}</p><p>{t('Day threshold: {0}% solar disk. Earth centre clearance: {1}°. Calculation: {2} ms on this device, excluding download.', { 0: assumptions.dayFraction * 100, 1: assumptions.earthMarginDeg, 2: Math.round(result.elapsedMs) })}</p></details>
  </>;
}
function Comparison({ chosen, reference, name }: { chosen: Metrics; reference: Metrics; name: string }) {
  const rows: [string, keyof Pick<Metrics, 'lightPct' | 'earthPct' | 'longestNightH' | 'sunElAtLandingDeg'>, string][] = [
    ['Sunlight', 'lightPct', '%'], ['Earth visibility', 'earthPct', '%'], ['Longest night', 'longestNightH', 'h'], ['Sun above terrain at landing', 'sunElAtLandingDeg', '°']];
  return <div className="free-comparison" role="table" aria-label={t('Point comparison')}><div className="free-comparison-head" role="row"><span role="columnheader">{t('Metric')}</span><strong role="columnheader">{t('Chosen point')}</strong><strong role="columnheader">{name}</strong></div>
    {rows.map(([label, key, unit]) => <div className="free-comparison-row" role="row" key={key}><span role="rowheader">{t(label)}</span><strong role="cell">{chosen[key].toFixed(1)} {t(unit)}</strong><strong role="cell">{reference[key].toFixed(1)} {t(unit)}</strong></div>)}
  </div>;
}

export function FreePointExplorer() {
  const lang = useApp(s => s.lang), id = useId();
  const [params] = useSearchParams(), mission = useMission();
  const [map, setMap] = useState<Basemap | null>(null), [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [loadError, setLoadError] = useState(false), [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState(''), [copyStatus, setCopyStatus] = useState('');
  const [latText, setLatText] = useState(''), [lonText, setLonText] = useState('');
  const latRaw = params.get('lat'), lonRaw = params.get('lon');
  const candidate = latRaw?.trim() && lonRaw?.trim() ? { lat: Number(latRaw), lon: Number(lonRaw) } : null;
  const point = map && candidate && withinMap(map, candidate) ? candidate : null;
  const invalidLink = Boolean(map && (latRaw !== null || lonRaw !== null) && !point);
  useEffect(() => {
    let active = true;
    Promise.all([loadBasemap(), loadSites()]).then(([m, s]) => { if (active) { setMap(m); setSites(s); setLoadError(false); } }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => { setLatText(latRaw ?? ''); setLonText(lonRaw ?? ''); }, [latRaw, lonRaw]);
  const select = (next: FreePoint) => {
    if (!map || !withinMap(map, next)) { setFormError('Point outside basemap'); return; }
    setFormError(''); setCopyStatus('');
    useApp.getState().setPlaying(false); useApp.getState().setCursorH(0);
    mission.update({ lat: String(next.lat), lon: String(next.lon) });
  };
  const copy = async () => {
    const query = new URLSearchParams(params);
    query.set('t', mission.landingUtc); query.set('days', String(mission.days)); query.set('h', String(mission.height));
    mission.update({});
    const url = new URL(window.location.href); url.hash = '/free?' + query;
    try { await navigator.clipboard.writeText(url.href); setCopyStatus('Link copied'); }
    catch { setCopyStatus('Copy unavailable. Copy the URL from your address bar.'); }
  };
  return <div className="page free-page" lang={lang}>
    <header className="card free-hero"><div><StopBadge /><div className="eyebrow">{t('Lunar south pole · Mission planning')}</div><h1>{t('Any point. A real lunar horizon.')}</h1><p>{t('Explore beyond the curated sites. Select real terrain, inspect the sky and compare your mission window.')}</p><span className="badge badge-warn">{t('Approximate - coarse DEM')}</span></div>
      <div><button className="btn btn-ghost" disabled={!point} onClick={copy}>{t('Copy link')}</button><p role="status" className="small">{t(copyStatus)}</p></div></header>
    <section className="card"><div className="card-head"><h2 className="card-title">{t('Choose your point')}</h2><span className="small">{t('LOLA · south polar stereographic')}</span></div>
      {map ? <FreePointMap map={map} sites={sites} point={point} onSelect={select} /> : <p role="status">{t('Loading basemap…')}</p>}
      {loadError && <div role="alert"><p>{t('Map or reference sites unavailable.')}</p><button className="btn" onClick={() => setAttempt(a => a + 1)}>{t('Retry map')}</button></div>}
      <div className="free-quick-picks"><span className="eyebrow">{t('Quick picks')}</span>
        <button className="chip" disabled={!map} onClick={() => select({ lat: -83.65136, lon: -68.72626 })}>{t('Peak near Cabeus B centre')}</button>
        <button className="chip" disabled={!map} onClick={() => select({ lat: -87.16972, lon: 125.45962 })}>{t('Slater Plain centre')}</button><span className="small">{t('Click anywhere')}</span>
      </div>
      <form className="free-coordinate-form" onSubmit={event => { event.preventDefault(); select({ lat: Number(latText), lon: Number(lonText) }); }} aria-describedby={id + '-bounds'}>
        <label htmlFor={id + '-lat'}>{t('Latitude (degrees)')}<input className="input mono" id={id + '-lat'} type="number" min={-90} max={0} step="any" required value={latText} onChange={e => setLatText(e.target.value)} /></label>
        <label htmlFor={id + '-lon'}>{t('Longitude (east degrees)')}<input className="input mono" id={id + '-lon'} type="number" min={-180} max={180} step="any" required value={lonText} onChange={e => setLonText(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={!map}>{t('Calculate free point')}</button>
      </form>
      <p className="small" id={id + '-bounds'}>{t('Allowed area: the displayed ±200 km polar square, including its corners north of 84°S. Longitude −180° to +180° east; latitude −90° to 0°, subject to the square boundary.')}</p>
      {(formError || invalidLink) && <p role="alert">{t(formError || 'The link contains coordinates outside the allowed map area.')}</p>}
    </section>
    {point ? <FreePointPanel {...point} onClose={() => { useApp.getState().setPlaying(false); mission.update({ lat: null, lon: null }); }} /> : <section className="card free-empty"><div className="eyebrow">{t('Your mission starts with a point')}</div><h2>{t('Where would you land?')}</h2><p>{t('Choose a map location, a curated reference marker or a USGS region centre. We compute an approximate terrain horizon and real hourly Sun and Earth visibility in your browser.')}</p></section>}
  </div>;
}

