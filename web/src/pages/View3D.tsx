import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadSite, loadSites } from '../lib/data';
import { getSeries, hourIndex, timeAtIndex } from '../lib/metrics';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import type { CameraMode, Trail } from '../lib/terrain';
import { useApp } from '../state';
import { useShallow } from 'zustand/react/shallow';
import { fmtUtc, isoShort, parseUtc } from '../components/format';
import { t } from '../i18n';
import '../styles/view3d.css';

const Scene3D = lazy(() => import('../components/Scene3D'));
const ImmersivePano = lazy(() => import('../components/ImmersivePano'));

const TRAIL_DAYS = [1, 14, 30] as const;

export default function View3D() {
  const [params, setParams] = useSearchParams();
  const store = useApp(useShallow((s) => ({ siteId: s.siteId, assumptions: s.assumptions, landingUtc: s.landingUtc, cursorH: s.cursorH })));
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [site, setSite] = useState<SiteData | null>(null);
  const [error, setError] = useState('');
  const view = params.get('view');
  const mode: CameraMode = view === 'pano' ? 'pano' : view === 'first' ? 'first' : 'overview';
  const trailDays = TRAIL_DAYS.find(d => String(d) === params.get('days')) ?? 14;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const viewer = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState('');
  const requested = params.get('site') ?? store.siteId;
  // Wait for the index, then accept only a published id (an unknown ?site= falls back to the first site).
  const id = sites.length ? (sites.some((s) => s.id === requested) ? requested : sites[0].id) : undefined;

  useEffect(() => {
    loadSites().then(setSites).catch(() => setError(t('Site index unavailable')));
  }, []);

  useEffect(() => {
    let active = true;
    setSite(null);
    setError('');
    if (id) {
      loadSite(id)
        .then((s) => { if (active) setSite(s); })
        .catch(() => { if (active) setError(t('Site data unavailable')); });
    }
    return () => { active = false; };
  }, [id]);

  // The 3D terrain and the panorama are both computed for a 2 m observer (else the nearest published height).
  const viewHeight = site ? (site.horizon.elev_cdeg['2'] ? 2 : Number(Object.keys(site.horizon.elev_cdeg)[0])) : 2;
  const series = useMemo(() => (site ? getSeries(site, { ...store.assumptions, heightM: viewHeight }) : null), [site, store.assumptions, viewHeight]);
  const timeParam = params.get('t')?.replace(/T(\d{2})$/, 'T$1:00');
  const utc = parseUtc(timeParam) ?? new Date(Date.parse(store.landingUtc) + store.cursorH * 3600000);
  const index = site ? Math.max(0, Math.min(site.ephem.n - 1, hourIndex(site, utc))) : 0;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };
  const go = (i: number) => { if (site) update({ t: isoShort(timeAtIndex(site, i)) }); };
  const switchMode = (m: CameraMode) => { update({ view: m }); };

  useEffect(() => {
    if (!playing || !site) return;
    const timer = window.setInterval(() => {
      if (index >= site.ephem.n - 1) setPlaying(false);
      else go(Math.min(site.ephem.n - 1, index + speed));
    }, 500);
    return () => clearInterval(timer);
  });

  const synthetic = import.meta.env.VITE_DATA_DIR === 'dev-data' || id?.startsWith('synthetic-');
  const View = mode === 'pano' ? ImmersivePano : Scene3D;

  // Real Sun/Earth paths over the selected window, centred on the current hour.
  const trails = useMemo(() => {
    if (!site || !series) return null;
    const n = site.ephem.n, half = trailDays * 12;
    const start = Math.max(0, Math.min(index - half, n - 1 - 2 * half)), end = Math.min(n - 1, start + 2 * half);
    const make = (az: Float32Array, el: Float32Array, mask: Float32Array): Trail => {
      const out: Trail = { az: az.slice(start, end + 1), el: el.slice(start, end + 1), visible: [], dayMarks: [] };
      const visible: boolean[] = [];
      for (let i = start; i <= end; i++) { visible.push(el[i] >= mask[i]); if (i % 24 === 0) out.dayMarks.push(i - start); }
      out.visible = visible; return out;
    };
    return { sun: make(series.sunAz, series.sunEl, series.horizonSunEl), earth: make(series.earthAz, series.earthEl, series.horizonEarthEl) };
    // Recompute when the window moves by a day, not every hour, to keep playback smooth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, series, trailDays, Math.floor(index / 24)]);

  const selected = sites.find(s => s.id === id);
  const dayStart = Math.floor(index / 24) * 24;
  const rangeStart = Math.max(0, dayStart - 72);
  const rangeEnd = site ? Math.min(site.ephem.n - 1, dayStart + 96) : 0;
  const fullscreen = async () => {
    setFullscreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen();
    } catch { setFullscreenError(t('Fullscreen is unavailable in this browser')); }
  };
  return (
    <section className="card view3d" aria-labelledby="view3d-title">
      <header className="expedition-heading">
        <div><p className="expedition-eyebrow">{t('LUNAR SOUTH POLE / SURFACE EXPLORER')}</p><h1 id="view3d-title">{t('Stand on the Moon.')}</h1></div>
        <p>{t('Real terrain. Real light. Your next landing site.')}</p>
      </header>
      {synthetic && <p role="note" className="badge badge-warn">{t('SYNTHETIC dev data — not real')}</p>}
      {error && <p role="alert">{error}</p>}
      {!site && !error && <p role="status">{t('Loading ephemeris…')}</p>}
      <div className="expedition-viewer" ref={viewer}>
        <div className="expedition-hud">
          <div className="expedition-site">
            <label htmlFor="terrain-site">{t('Landing site')}</label>
            <select id="terrain-site" value={id ?? ''} onChange={e => { setPlaying(false); update({site:e.target.value,t:isoShort(utc)}); }}>
              {sites.map(s => <option key={s.id} value={s.id}>{t(s.name)}</option>)}
            </select>
            {selected && <span className="expedition-coordinates">{Math.abs(selected.lat_deg).toFixed(3 )}° {t('S')} · {Math.abs(selected.lon_deg).toFixed(3)}° {t(selected.lon_deg < 0 ? 'W' : 'E')} · {t('LOLA elevation data')}</span>}
          </div>
          <div className="expedition-actions">
            <div className="expedition-modes" role="group" aria-label={t('View')}>
              <button aria-pressed={mode === 'overview'} onClick={() => switchMode('overview')}>{t('3D overview')}</button>
              <button aria-pressed={mode === 'first'} onClick={() => switchMode('first')}>{t('First person')}</button>
              <button aria-pressed={mode === 'pano'} onClick={() => switchMode('pano')}>{t('Astronaut 360°')}</button>
            </div>
            <button className="expedition-fullscreen" onClick={fullscreen} aria-label={t('Toggle fullscreen')} title={t('Toggle fullscreen')}>⛶</button>
          </div>
          {site && series && <div className="expedition-readings">
            <span className={series.sunEl[index] >= series.horizonSunEl[index] ? 'is-lit' : ''}>{t(series.sunEl[index] >= series.horizonSunEl[index] ? 'In sunlight' : 'In shadow')}</span>
            <span>{t(series.earthEl[index] >= series.horizonEarthEl[index] ? 'Earth in view' : 'Earth hidden')}</span>
            <span>{t('Sun')} <b>{series.sunEl[index].toFixed(2 )}°</b></span>
            <span>{t('Earth')} <b>{series.earthEl[index].toFixed(2 )}°</b></span>
          </div>}
        </div>
        {site && series && <>
          <Suspense fallback={<div className="expedition-loading" role="status">{t('Loading 3D viewer…')}<progress /></div>}>
            <View mode={mode} onMode={switchMode} sunVisible={series.sunEl[index] >= series.horizonSunEl[index]} sunTrail={trails?.sun} earthTrail={trails?.earth} siteId={site.id} sunAz={series.sunAz[index]} sunEl={series.sunEl[index]} earthAz={series.earthAz[index]} earthEl={series.earthEl[index]} horizon={site.horizon.elev_cdeg[String(viewHeight)]} horizonStep={site.horizon.az_step_deg} />
          </Suspense>
          <div className="expedition-timeline">
            <div className="expedition-time-row">
              <button className="expedition-play" onClick={() => setPlaying(!playing)}>{playing ? t('Pause') : t('Play')}</button>
              <time>{fmtUtc(timeAtIndex(site,index))}</time>
              <label className="expedition-speed">{t('Paths')} <select value={trailDays} onChange={e => update({ days: e.target.value })}>{TRAIL_DAYS.map(d => <option key={d} value={d}>{t('{0} d', { 0: d })}</option>)}</select></label>
              <label className="expedition-speed">{t('Speed')} <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>{t('1 h / step')}</option><option value={6}>{t('6 h / step')}</option><option value={24}>{t('24 h / step')}</option></select></label>
            </div>
            <input aria-label={t('Ephemeris hour')} type="range" min={rangeStart} max={rangeEnd} step={1} value={index} onChange={e => {setPlaying(false);go(Number(e.target.value));}} />
            <div className="expedition-dayticks">{[rangeStart, Math.round((rangeStart+rangeEnd)/2), rangeEnd].map(i => <span key={i}>{fmtUtc(timeAtIndex(site,i),false)}</span>)}</div>
          </div>
        </>}
      </div>
      {fullscreenError && <p role="status">{fullscreenError}</p>}
      <footer className="expedition-footnote"><span>{t('Approximate lunar reflectance; fixed exposure; LOLA relief, no added surface detail.')}</span>{mode === 'first' && <span>{t('Mesh horizon approx. (up to ~0.6°); exact horizon in 360°.')}</span>}{mode === 'pano' && <span>{t('360 panorama shading has no per-pixel cast shadows.')}</span>}<span>{t('NASA / LOLA terrain · SPICE ephemerides')}</span><span>{t('Visibility: body centre above the 2 m horizon. Earth disk: geometric phase, uniform albedo.')}</span></footer>
    </section>
  );
}
