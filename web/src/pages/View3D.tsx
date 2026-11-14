import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadSite, loadSites } from '../lib/data';
import { getSeries, hourIndex, timeAtIndex } from '../lib/metrics';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import { useApp } from '../state';
import { fmtUtc, isoShort, parseUtc } from '../components/format';
import { t } from '../i18n';
import '../styles/view3d.css';

const Scene3D = lazy(() => import('../components/Scene3D'));
const ImmersivePano = lazy(() => import('../components/ImmersivePano'));

type Mode = 'scene' | 'pano';

export default function View3D() {
  const [params, setParams] = useSearchParams();
  const store = useApp();
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [site, setSite] = useState<SiteData | null>(null);
  const [error, setError] = useState('');
  const mode: Mode = params.get('view') === 'pano' ? 'pano' : 'scene';
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const viewer = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState('');
  const id = params.get('site') ?? store.siteId ?? sites[0]?.id;

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

  // The 3D terrain and the panorama are both computed for a 2 m observer.
  const series = useMemo(() => (site ? getSeries(site, { ...store.assumptions, heightM: 2 }) : null), [site, store.assumptions]);
  const timeParam = params.get('t')?.replace(/T(\d{2})$/, 'T$1:00');
  const utc = parseUtc(timeParam) ?? new Date(Date.parse(store.landingUtc) + store.cursorH * 3600000);
  const index = site ? Math.max(0, Math.min(site.ephem.n - 1, hourIndex(site, utc))) : 0;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };
  const go = (i: number) => { if (site) update({ t: isoShort(timeAtIndex(site, i)) }); };
  const switchMode = (m: Mode) => { update({ view: m }); };

  useEffect(() => {
    if (!playing || !site) return;
    const timer = window.setInterval(() => {
      if (index >= site.ephem.n - 1) setPlaying(false);
      else go(Math.min(site.ephem.n - 1, index + speed));
    }, 500);
    return () => clearInterval(timer);
  });

  const synthetic = import.meta.env.VITE_DATA_DIR === 'dev-data' || id?.startsWith('synthetic-');
  const View = mode === 'scene' ? Scene3D : ImmersivePano;

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
              <button aria-pressed={mode === 'scene'} onClick={() => switchMode('scene')}>{t('Terrain 3D')}</button>
              <button aria-pressed={mode === 'pano'} onClick={() => switchMode('pano')}>{t('360° panorama')}</button>
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
            <View siteId={site.id} sunAz={series.sunAz[index]} sunEl={series.sunEl[index]} earthAz={series.earthAz[index]} earthEl={series.earthEl[index]} horizon={site.horizon.elev_cdeg['2']} horizonStep={site.horizon.az_step_deg} />
          </Suspense>
          <div className="expedition-timeline">
            <div className="expedition-time-row">
              <button className="expedition-play" onClick={() => setPlaying(!playing)}>{playing ? t('Pause') : t('Play')}</button>
              <time>{fmtUtc(timeAtIndex(site,index))}</time>
              <label className="expedition-speed">{t('Speed')} <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>{t('1 h / step')}</option><option value={6}>{t('6 h / step')}</option><option value={24}>{t('24 h / step')}</option></select></label>
            </div>
            <input aria-label={t('Ephemeris hour')} type="range" min={rangeStart} max={rangeEnd} step={1} value={index} onChange={e => {setPlaying(false);go(Number(e.target.value));}} />
            <div className="expedition-dayticks">{[rangeStart, Math.round((rangeStart+rangeEnd)/2), rangeEnd].map(i => <span key={i}>{fmtUtc(timeAtIndex(site,i),false)}</span>)}</div>
          </div>
        </>}
      </div>
      {fullscreenError && <p role="status">{fullscreenError}</p>}
      <footer className="expedition-footnote"><span>{t('NASA / LOLA terrain · SPICE ephemerides')}</span><span>{t('Visibility: body centre above the 2 m horizon. Earth disk: geometric phase, uniform albedo.')}</span></footer>
    </section>
  );
}
