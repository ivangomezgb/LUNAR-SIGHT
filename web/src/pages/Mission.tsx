import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { t } from '../i18n';
import { loadSite, loadSites } from '../lib/data';
import { getSeries } from '../lib/metrics';
import { loadTerrain, type TerrainData, viewerError } from '../lib/terrain';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import { useApp } from '../state';
import { parseUtc } from '../components/format';
import { shortName } from '../components/format';
import { makeField } from '../game/sim/field';
import { makeHorizon } from '../game/sim/visibility';
import type { Env } from '../game/sim/world';
import { RULES } from '../game/sim/rules';
import '../styles/game.css';

const SurfaceGame = lazy(() => import('../game/ui/SurfaceGame'));

export default function Mission() {
  const [params, setParams] = useSearchParams();
  const store = useApp(useShallow((s) => ({ siteId: s.siteId, landingUtc: s.landingUtc })));
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [site, setSite] = useState<SiteData | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const requested = params.get('site') ?? store.siteId;
  const id = sites.length ? (sites.some((s) => s.id === requested) ? requested! : sites[0].id) : undefined;
  const entry = sites.find((s) => s.id === id);
  const startMs = (parseUtc(params.get('t')) ?? new Date(store.landingUtc)).getTime();

  useEffect(() => { loadSites().then(setSites).catch(() => setError(t('Site index unavailable'))); }, []);
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    setSite(null); setTerrain(null); setError('');
    Promise.all([loadSite(id), loadTerrain(id, setProgress, abort.signal)])
      .then(([s, tr]) => { if (!abort.signal.aborted) { setSite(s); setTerrain(tr); } })
      .catch((e) => { if (!abort.signal.aborted) setError(t(viewerError(e))); });
    return () => abort.abort();
  }, [id]);

  const env = useMemo<Env | null>(() => {
    if (!site || !terrain) return null;
    const mask = site.horizon.elev_cdeg[String(RULES.rover.eyeH)] ?? site.horizon.elev_cdeg['2'];
    const field = makeField(terrain);
    const series = getSeries(site, { heightM: 2, dayFraction: 0.5, earthMarginDeg: RULES.comms.earthMarginDeg });
    return {
      field,
      horizon: makeHorizon(field, mask, site.horizon.az_step_deg, RULES.rover.eyeH),
      ephem: { t0Ms: Date.parse(site.ephem.t0_utc), stepH: site.ephem.step_h, n: site.ephem.n, sunAz: series.sunAz, sunEl: series.sunEl, earthAz: series.earthAz, earthEl: series.earthEl },
    };
  }, [site, terrain]);

  return (
    <section className="mission-page" aria-labelledby="mission-title">
      <header className="mission-head">
        <div>
          <p className="eyebrow">{t('Playable mission · real terrain, real Sun and Earth')}</p>
          <h1 id="mission-title">{t('Drive the south pole')}</h1>
        </div>
        <label className="mission-site">
          <span className="hud-label">{t('Landing site')}</span>
          <select className="select" value={id ?? ''} onChange={(e) => { const next = new URLSearchParams(params); next.set('site', e.target.value); setParams(next, { replace: true }); }}>
            {sites.map((s) => <option key={s.id} value={s.id}>{shortName(s.name)}</option>)}
          </select>
        </label>
      </header>
      {error && <p role="alert" className="status status-error">{error}</p>}
      {!error && !env && <div className="game-loading" role="status">{t('Loading terrain… {0}%', { 0: progress })}<progress max={100} value={progress} /></div>}
      {env && terrain && entry && (
        <Suspense fallback={<div className="game-loading" role="status">{t('Loading 3D viewer…')}</div>}>
          <SurfaceGame key={entry.id} env={env} terrain={terrain} site={{ id: entry.id, name: shortName(entry.name), lat: entry.lat_deg, lon: entry.lon_deg }} startMs={startMs} />
        </Suspense>
      )}
      <details className="card game-rules">
        <summary>{t('Game rules (assumptions)')}</summary>
        <p className="small muted">{t('Terrain, Sun and Earth positions and gravity are real. These rover numbers are declared game assumptions, not mission data:')}</p>
        <ul className="small mono">
          <li>{t('Top speed')} {RULES.rover.maxSpeed} m/s · {t('max climb')} {RULES.rover.maxClimbDeg}° · {t('tips over above')} {RULES.rover.tipDeg}°</li>
          <li>{t('Battery')} {RULES.power.batteryWh} Wh · {t('panel')} {RULES.power.panelW} W · {t('avionics')} {RULES.power.hotelW} W · {t('driving')} {RULES.power.driveW} W · {t('night heater')} {RULES.power.heaterW} W</li>
          <li>{t('Sunlight and Earth link are computed at the rover from LOLA terrain within ±51 km plus the site horizon beyond (≤ 0.1° from the published mask at the site).')}</li>
        </ul>
      </details>
    </section>
  );
}
