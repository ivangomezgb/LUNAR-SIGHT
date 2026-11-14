import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadSite, loadSites } from '../lib/data';
import { getSeries, hourIndex, timeAtIndex } from '../lib/metrics';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import { useApp } from '../state';
import { fmtUtc, isoShort, parseUtc } from '../components/format';
import { t } from '../i18n';

const Scene3D = lazy(() => import('../components/Scene3D'));
const ImmersivePano = lazy(() => import('../components/ImmersivePano'));

type Mode = 'scene' | 'pano';

export default function View3D() {
  const [params, setParams] = useSearchParams();
  const store = useApp();
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [site, setSite] = useState<SiteData | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>(params.get('view') === 'pano' ? 'pano' : 'scene');
  const [playing, setPlaying] = useState(false);
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
  const utc = parseUtc(params.get('t')) ?? new Date(Date.parse(store.landingUtc) + store.cursorH * 3600000);
  const index = site ? Math.max(0, Math.min(site.ephem.n - 1, hourIndex(site, utc))) : 0;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    setParams(next, { replace: true });
  };
  const go = (i: number) => { if (site) update({ t: isoShort(timeAtIndex(site, i)) }); };
  const switchMode = (m: Mode) => { setMode(m); update({ view: m }); };

  useEffect(() => {
    if (!playing || !site) return;
    const timer = window.setInterval(() => {
      if (index >= site.ephem.n - 1) setPlaying(false);
      else go(index + 1);
    }, 150);
    return () => clearInterval(timer);
  });

  const synthetic = import.meta.env.VITE_DATA_DIR === 'dev-data' || id?.startsWith('synthetic-');
  const View = mode === 'scene' ? Scene3D : ImmersivePano;

  return (
    <section className="card view3d" aria-labelledby="view3d-title">
      <h1 id="view3d-title" className="card-title">{t('Explore in 3D')}</h1>
      {synthetic && <p role="note" className="badge badge-warn">{t('SYNTHETIC dev data — not real')}</p>}
      <div className="view3d-controls">
        <label>
          {t('Site')}{' '}
          <select value={id ?? ''} onChange={(e) => { setPlaying(false); update({ site: e.target.value, t: isoShort(utc) }); }}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <span className="view3d-modes" role="group" aria-label={t('View')}>
          <button type="button" className="chip" aria-pressed={mode === 'scene'} onClick={() => switchMode('scene')}>{t('Terrain scene')}</button>
          <button type="button" className="chip" aria-pressed={mode === 'pano'} onClick={() => switchMode('pano')}>{t('Immersive 360°')}</button>
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      {!site && !error && <p role="status">{t('Loading ephemeris…')}</p>}
      {site && series && (
        <>
          <div className="view3d-time">
            <button type="button" className="btn" onClick={() => setPlaying(!playing)}>{playing ? t('Pause') : t('Play')}</button>
            <span className="mono">{fmtUtc(timeAtIndex(site, index))}</span>
            <span className="small muted">
              {t('Sun')} {series.sunEl[index].toFixed(2)}° · {t('Earth')} {series.earthEl[index].toFixed(2)}°
            </span>
          </div>
          <input
            aria-label={t('Ephemeris hour')}
            type="range" min={0} max={site.ephem.n - 1} step={1} value={index}
            onChange={(e) => { setPlaying(false); go(Number(e.target.value)); }}
            className="view3d-slider"
          />
          <Suspense fallback={<p role="status">{t('Loading 3D viewer…')}</p>}>
            <View
              siteId={site.id}
              sunAz={series.sunAz[index]} sunEl={series.sunEl[index]}
              earthAz={series.earthAz[index]} earthEl={series.earthEl[index]}
              horizon={site.horizon.elev_cdeg['2']} horizonStep={site.horizon.az_step_deg}
            />
          </Suspense>
        </>
      )}
    </section>
  );
}
