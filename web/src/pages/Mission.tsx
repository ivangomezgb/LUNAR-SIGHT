import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { t } from '../i18n';
import { loadBasemap, loadSite, loadSites } from '../lib/data';
import { computeMetrics, getSeries } from '../lib/metrics';
import { loadTerrain, type TerrainData, viewerError } from '../lib/terrain';
import { loadIllum, type IllumMap } from '../lib/illum';
import type { Basemap, SiteData, SiteIndexEntry } from '../lib/types';
import { useApp } from '../state';
import { isoShort, parseUtc, shortName } from '../components/format';
import { makeField } from '../game/sim/field';
import { makeHorizon } from '../game/sim/visibility';
import type { Env } from '../game/sim/world';
import { RULES } from '../game/sim/rules';
import { peekSave } from '../game/ui/save';
import '../styles/game.css';

const SurfaceGame = lazy(() => import('../game/ui/SurfaceGame'));
const OrbitPicker = lazy(() => import('../game/ui/OrbitPicker'));

/**
 * The playable mission. Stage 1 (`stage` absent): choose a site and landing hour from orbit.
 * Stage 2 (`stage=surface`): pilot the descent onto that site's real terrain, then the rover.
 */
export default function Mission() {
  const [params, setParams] = useSearchParams();
  const store = useApp(useShallow((s) => ({ siteId: s.siteId, landingUtc: s.landingUtc })));
  const [sites, setSites] = useState<SiteIndexEntry[]>([]);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [site, setSite] = useState<SiteData | null>(null);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [illum, setIllum] = useState<IllumMap | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [saved] = useState(peekSave);

  const stage = params.get('stage') === 'surface' ? 'surface' : 'orbit';
  const autostart = params.get('start') === 'continue' ? 'continue' : params.get('start') === 'descent' ? 'descent' : undefined;
  const requested = params.get('site') ?? store.siteId;
  const id = sites.length ? (sites.some((s) => s.id === requested) ? requested! : sites[0].id) : undefined;
  const entry = sites.find((s) => s.id === id);
  const startMs = (parseUtc(params.get('t')) ?? new Date(store.landingUtc)).getTime();

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null) next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };

  useEffect(() => { loadSites().then(setSites).catch(() => setError(t('Site index unavailable'))); }, []);
  useEffect(() => { loadBasemap().then(setBasemap).catch(() => setError(t('Basemap unavailable'))); }, []);
  useEffect(() => {
    if (!id || stage !== 'surface') return;
    const abort = new AbortController();
    setSite(null); setTerrain(null); setIllum(null); setError('');
    Promise.all([loadSite(id), loadTerrain(id, setProgress, abort.signal), loadIllum(id, abort.signal).catch(() => null)])
      .then(([s, tr, il]) => { if (!abort.signal.aborted) { setSite(s); setTerrain(tr); setIllum(il); } })
      .catch((e) => { if (!abort.signal.aborted) setError(t(viewerError(e))); });
    return () => abort.abort();
  }, [id, stage]);

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
  const published = useMemo(() => {
    if (!site) return null;
    try {
      const m = computeMetrics(site, new Date(startMs), 14 * 24, { heightM: 2, dayFraction: 0.5, earthMarginDeg: RULES.comms.earthMarginDeg });
      return { lightPct: m.lightPct, earthPct: m.earthPct };
    } catch { return null; }
  }, [site, startMs]);

  const savedSite = saved ? sites.find((s) => s.id === saved.site) : undefined;

  return (
    <section className="mission-page" aria-labelledby="mission-title">
      <header className="mission-head">
        <div>
          <p className="eyebrow">{t('Playable mission · real terrain, real Sun and Earth')}</p>
          <h1 id="mission-title">{stage === 'orbit' ? t('Plan the landing from orbit') : t('Drive the south pole')}</h1>
          <p className="muted mission-intro">{t('A short game on real data: choose a site from orbit, pilot the lander down, then drive a solar rover: find light, avoid the cold shadows and send your science home.')}</p>
        </div>
        {stage === 'surface' && (
          <div className="mission-site">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ stage: null, start: null })}>↑ {t('Back to orbit')}</button>
            {entry && <span className="small muted">{shortName(entry.name)}</span>}
          </div>
        )}
      </header>
      {error && <p role="alert" className="status status-error">{error}</p>}

      {stage === 'orbit' && sites.length > 0 && basemap && id && (
        <Suspense fallback={<div className="game-loading" role="status">{t('Loading 3D viewer…')}</div>}>
          <OrbitPicker
            sites={sites} basemap={basemap} siteId={id} startMs={startMs}
            onSite={(s) => go({ site: s })}
            onStart={(ms) => go({ t: isoShort(new Date(ms).toISOString()) })}
            onDescend={(s, ms) => go({ site: s, t: isoShort(new Date(ms).toISOString()), stage: 'surface', start: 'descent' })}
            saved={saved && savedSite ? { site: saved.site, label: `${shortName(savedSite.name)} · ${Object.keys(saved.mission.done).length}/6` } : null}
            onContinue={() => saved && go({ site: saved.site, t: isoShort(new Date(saved.startMs).toISOString()), stage: 'surface', start: 'continue' })}
          />
        </Suspense>
      )}

      {stage === 'surface' && (<>
        {!error && !env && <div className="game-loading" role="status">{t('Loading terrain… {0}%', { 0: progress })}<progress max={100} value={progress} /></div>}
        {env && terrain && entry && (
          <Suspense fallback={<div className="game-loading" role="status">{t('Loading 3D viewer…')}</div>}>
            <SurfaceGame key={`${entry.id}-${startMs}`} env={env} terrain={terrain} site={{ id: entry.id, name: shortName(entry.name), lat: entry.lat_deg, lon: entry.lon_deg }}
              startMs={startMs} published={published} autostart={autostart} illum={illum} />
          </Suspense>
        )}
      </>)}

      <details className="card game-rules">
        <summary>{t('Game rules (assumptions)')}</summary>
        <p className="small muted">{t('Terrain, Sun and Earth positions and gravity are real. These rover numbers are declared game assumptions, not mission data:')}</p>
        <ul className="small mono">
          <li>{t('Top speed')} {RULES.rover.maxSpeed} m/s · {t('max climb')} {RULES.rover.maxClimbDeg}° · {t('tips over above')} {RULES.rover.tipDeg}°</li>
          <li>{t('Battery')} {RULES.power.batteryWh} Wh · {t('panel')} {RULES.power.panelW} W · {t('avionics')} {RULES.power.hotelW} W · {t('driving')} {RULES.power.driveW} W · {t('night heater')} {RULES.power.heaterW} W</li>
          <li>{t('Lander')} {RULES.lander.dryKg + RULES.lander.fuelKg} kg · {RULES.lander.maxThrustN} N · {t('touchdown')} &lt; {RULES.lander.maxTouchVz} m/s, {t('drift')} &lt; {RULES.lander.maxTouchVh} m/s, {t('slope')} &lt; {RULES.lander.maxSlopeDeg}°</li>
          <li>{t('Sunlight and Earth link are computed at the rover from LOLA terrain within ±51 km plus the site horizon beyond (≤ 0.1° from the published mask at the site).')}</li>
        </ul>
      </details>
    </section>
  );
}
