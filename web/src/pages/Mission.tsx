import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { climbLimitDeg, holdLimitDeg } from '../game/sim/rover';
import { peekSave } from '../game/ui/save';
import Icon from '../components/Icon';
import '../styles/game.css';
import { sfx } from '../game/audio/sfx';

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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [muted, setMuted] = useState(sfx.muted);
  useEffect(() => sfx.onMute(setMuted), []);
  // Browsers only let sound start after a gesture: unlock on the first click, tap or key.
  useEffect(() => {
    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); sfx.stopLoops(); };
  }, []);
  const navigate = useNavigate();
  const shell = useRef<HTMLElement>(null);
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else shell.current?.requestFullscreen().catch(() => {});
  };

  // The mission fills the whole window (no page scroll); the site header comes back on exit.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('mission-open');
    return () => { root.classList.remove('mission-open'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!rulesOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRulesOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rulesOpen]);

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

  return createPortal(
    <section className="mission-page is-immersive" ref={shell} aria-labelledby="mission-title">
      <header className="mission-bar">
        <button type="button" className="mission-btn" onClick={() => navigate('/')}><Icon name="exit" size={18} /> <span>{t('Exit')}</span></button>
        <div className="mission-title">
          <h1 id="mission-title">{stage === 'orbit' ? t('Choose where to land') : t('Land and drive')}</h1>
          {entry && <span className="small muted">{shortName(entry.name)}</span>}
        </div>
        <div className="mission-bar-actions">
          {stage === 'surface' && <button type="button" className="mission-btn" onClick={() => go({ stage: null, start: null })}><Icon name="moon" size={18} /> <span>{t('Back to orbit')}</span></button>}
          <button type="button" className="mission-btn" aria-pressed={!muted} onClick={() => { sfx.unlock(); sfx.setMuted(!muted); }} aria-label={muted ? t('Turn sound on') : t('Turn sound off')} title={muted ? t('Turn sound on') : t('Turn sound off')}>
            <Icon name={muted ? 'volumeOff' : 'volume'} size={18} /> <span>{muted ? t('Sound off') : t('Sound on')}</span>
          </button>
          <button type="button" className="mission-btn" onClick={() => setRulesOpen(true)}><Icon name="info" size={18} /> <span>{t('Rules')}</span></button>
          {canFullscreen && <button type="button" className="mission-btn" onClick={toggleFullscreen} aria-label={t('Toggle fullscreen')} title={t('Toggle fullscreen')}><Icon name="maximize" size={18} /></button>}
        </div>
      </header>

      <div className="mission-stage">
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
      </div>

      {rulesOpen && (
        <div className="game-overlay mission-rules" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(e) => { if (e.target === e.currentTarget) setRulesOpen(false); }}>
          <div className="brief-card">
            <p className="eyebrow">{t('Game rules (assumptions)')}</p>
            <h2 id="rules-title">{t('What is real and what is a game choice')}</h2>
            <p className="small muted">{t('Terrain, Sun and Earth positions and gravity are real. These rover numbers are declared game assumptions, not mission data:')}</p>
            <ul className="small mono">
          <li>{t('Rover')} {RULES.rover.massKg} kg · {t('top speed')} {RULES.rover.maxSpeed} m/s · {t('wheel grip')} μ {RULES.rover.mu}, {t('rolling resistance')} {RULES.rover.crr} → {t('climbs up to')} {climbLimitDeg().toFixed(1)}°, {t('slides above')} {holdLimitDeg().toFixed(1)}° · {t('tips over above')} {RULES.rover.tipDeg}°</li>
          <li>{t('Battery')} {RULES.power.batteryWh} Wh · {t('panel')} {RULES.power.panelAreaM2} m² × {(RULES.power.panelEff * 100).toFixed(0)}% ({(RULES.power.solarWm2 * RULES.power.panelAreaM2 * RULES.power.panelEff).toFixed(0)} W {t('facing the Sun')}, {(RULES.power.panelTempCoef * 100).toFixed(1)}%/°C) · {t('avionics')} {RULES.power.hotelW} W · {t('drives')} {RULES.rover.motorW} W {t('max')} · {t('heater')} {RULES.power.heaterW} W</li>
          <li>{t('Thermal')}: {t('radiator')} {RULES.thermal.radiatorM2} m², ε {RULES.thermal.emissivity}, α {RULES.thermal.absorptivity} · {t('heater on below')} {RULES.thermal.heaterOnC} °C · {t('lost below')} {RULES.thermal.freezeC} °C · {t('drives stop above')} {RULES.thermal.hotC} °C</li>
          <li>{t('Lander')} {RULES.lander.dryKg + RULES.lander.fuelKg} kg · {RULES.lander.maxThrustN} N · {t('touchdown')} &lt; {RULES.lander.maxTouchVz} m/s, {t('drift')} &lt; {RULES.lander.maxTouchVh} m/s, {t('slope')} &lt; {RULES.lander.maxSlopeDeg}°</li>
          <li>{t('Kicked-up dust flies on ballistic arcs: with no air it falls back at 1.62 m/s² instead of hanging in a cloud.')}</li>
          <li>{t('Sunlight and Earth link are computed at the rover from LOLA terrain within ±51 km plus the site horizon beyond (≤ 0.1° from the published mask at the site).')}</li>
        </ul>
            <button type="button" className="btn btn-primary" autoFocus onClick={() => setRulesOpen(false)}>{t('Back to the mission')}</button>
          </div>
        </div>
      )}
    </section>,
    document.body,
  );
}
