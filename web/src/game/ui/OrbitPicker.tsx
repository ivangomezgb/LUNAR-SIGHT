import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { loadSite } from '../../lib/data';
import { computeMetrics, getSeries, hourIndex } from '../../lib/metrics';
import { computeLandingRisk } from '../../lib/landingRisk';
import type { Basemap, SiteData, SiteIndexEntry } from '../../lib/types';
import { fmtUtc, fromLocalInput, groupColor, shortName, toLocalInput } from '../../components/format';
import { coverage } from '../../components/series';
import { dataUrl } from '../../components/hooks';
import { viewerError } from '../../lib/terrain';
import { fmtLatLon } from '../sim/geo';
import { localToPolarDir } from '../sim/polar';
import { RULES } from '../sim/rules';
import { stationAfter, stationOrder } from '../sim/stations';
import { OrbitScene } from '../render/OrbitScene';
import Icon from '../../components/Icon';
import { actionOf, isTyping } from './controls';
import { sfx } from '../audio/sfx';

interface Props {
  sites: SiteIndexEntry[];
  basemap: Basemap;
  siteId: string;
  startMs: number;
  onSite: (id: string) => void;
  onStart: (ms: number) => void;
  onDescend: (id: string, ms: number) => void;
  saved: { site: string; label: string } | null;
  onContinue: () => void;
}

const DAY = 86400000;

/**
 * Mission stage 1, from orbit: the ship hops between the candidate sites ("stations") over the
 * real Moon; each station shows a forecast from the real data and a single "Land here" action.
 */
export default function OrbitPicker({ sites, basemap, siteId, startMs, onSite, onStart, onDescend, saved, onContinue }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrbitScene | null>(null);
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [diving, setDiving] = useState(false);
  const [label, setLabel] = useState<{ x: number; y: number } | null>(null);
  const [far, setFar] = useState(true);
  const [drawer, setDrawer] = useState<null | 'date' | 'stations'>(null);
  // Tour: the ship visits every station in turn, pausing at each, until the player takes over.
  const [touring, setTouring] = useState(false);
  const tourLeft = useRef(0);
  const tourTimer = useRef(0);
  const entry = sites.find((s) => s.id === siteId);
  const order = useMemo(() => stationOrder(sites), [sites]);
  const index = Math.max(0, order.indexOf(siteId));
  const pick = useRef(onSite);
  pick.current = onSite;
  const siteRef = useRef(siteId);
  siteRef.current = siteId;
  const skyRef = useRef<{ sun: [number, number, number]; earth: [number, number, number] } | null>(null);

  useEffect(() => {
    const node = host.current!;
    let scene: OrbitScene | null = null, alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      try {
        const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
        scene = new OrbitScene(node, img, basemap, sites, groupColor, lowEnd);
      } catch (e) { setError(t(viewerError(e))); return; }
      scene.onPick = (id) => { if (!scene?.traveling) pick.current(id); };
      scene.onHover = (id, x, y) => {
        const r = node.getBoundingClientRect();
        setHover(id ? { id, x: x - r.left, y: y - r.top } : null);
      };
      sceneRef.current = scene;
      scene.onFar = setFar;
      scene.onArrive = () => { sfx.chime(); arrived.current(); };
      scene.onFlight = (ms) => sfx.whoosh(ms);
      scene.select(siteRef.current);
      scene.playIntro();
      if (skyRef.current) scene.setSky(skyRef.current);
    };
    img.onerror = () => setError(t('Basemap unavailable'));
    img.src = dataUrl(basemap.image);
    return () => { alive = false; scene?.dispose(); sceneRef.current = null; };
  }, [basemap, sites]);

  useEffect(() => {
    let alive = true;
    setData(null);
    loadSite(siteId).then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [siteId]);

  // forecast + real Sun/Earth directions at the chosen hour
  const forecast = useMemo(() => {
    if (!data || !entry) return null;
    const [c0, c1] = coverage(data);
    const ms = Math.min(Math.max(startMs, c0), c1 - 14 * DAY);
    const a = { heightM: 2, dayFraction: 0.5, earthMarginDeg: RULES.comms.earthMarginDeg };
    const series = getSeries(data, a);
    const i = Math.max(0, Math.min(data.ephem.n - 1, hourIndex(data, new Date(ms))));
    const m = computeMetrics(data, new Date(ms), 14 * 24, a);
    let risk: ReturnType<typeof computeLandingRisk> | null = null;
    try { risk = computeLandingRisk(series, i, data.ephem.step_h); } catch { risk = null; }
    return {
      ms, m, risk,
      sky: { sun: localToPolarDir(series.sunAz[i], series.sunEl[i], entry.lon_deg), earth: localToPolarDir(series.earthAz[i], series.earthEl[i], entry.lon_deg) },
      margin: series.sunEl[i] - series.horizonSunEl[i],
      range: [c0, c1 - 14 * DAY] as const,
    };
  }, [data, entry, startMs]);

  useEffect(() => { if (forecast) { skyRef.current = forecast.sky; sceneRef.current?.setSky(forecast.sky); } }, [forecast]);
  // a new station (arrows, list, a pin on the globe): the ship flies there
  useEffect(() => { sceneRef.current?.goToStation(siteId); }, [siteId]);

  // keep the selected site's label glued to its pin
  useEffect(() => {
    let raf = 0;
    const tick = () => { setLabel(sceneRef.current?.screenOf(siteId) ?? null); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [siteId]);

  const descend = () => {
    if (diving) return;
    const ms = forecast?.ms ?? startMs;
    if (!sceneRef.current) { onDescend(siteId, ms); return; }
    setDiving(true); setDrawer(null);
    sceneRef.current.descend(siteId, () => onDescend(siteId, ms));
  };
  const travel = (step: number) => {
    if (diving || sceneRef.current?.traveling) return;
    onSite(stationAfter(order, siteId, step));
  };
  const stopTour = () => { clearTimeout(tourTimer.current); setTouring(false); };
  const startTour = () => {
    if (diving) return;
    setDrawer(null);
    tourLeft.current = order.length - 1;
    setTouring(true);
    if (sceneRef.current?.traveling) return; // the next arrival continues the tour
    tourTimer.current = window.setTimeout(() => travel(1), 600);
  };
  const arrived = useRef(() => {});
  arrived.current = () => {
    if (!touring) return;
    if (tourLeft.current <= 0) { setTouring(false); return; }
    tourLeft.current -= 1;
    tourTimer.current = window.setTimeout(() => act.current.travel(1), 3800);
  };
  useEffect(() => () => clearTimeout(tourTimer.current), []);
  const act = useRef({ descend, travel, stopTour });
  act.current = { descend, travel, stopTour };

  // keyboard: ← → (or A D) travel between stations, Space or Enter lands
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const a = actionOf(e);
      if (a === 'left' || a === 'right') { e.preventDefault(); act.current.stopTour(); act.current.travel(a === 'left' ? -1 : 1); }
      else if (a === 'thrust' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); act.current.stopTour(); act.current.descend(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shift = (days: number) => onStart(startMs + days * DAY);
  const riskText = forecast?.risk ? t(forecast.risk.level === 'low' ? 'Low' : forecast.risk.level === 'medium' ? 'Medium' : 'High') : '—';

  return (
    <div className={`orbit${diving ? ' is-diving' : ''}`}>
      <div ref={host} className="orbit-canvas" onPointerDown={() => { if (touring) stopTour(); }} aria-label={t('The lunar south pole seen from orbit, with the candidate landing sites')} />
      {error && <div className="game-overlay" role="alert">{error}</div>}
      <div className="globe-nav" role="group" aria-label={t('Globe navigation')}>
        <button type="button" onClick={() => sceneRef.current?.zoomOut()}><Icon name="moon" /> {t('Whole Moon')}</button>
        <button type="button" onClick={() => sceneRef.current?.goToStation(siteId)}><Icon name="target" /> {t('Back to the ship')}</button>
      </div>
      {far && !diving && (
        <button type="button" className="globe-callout" onClick={() => sceneRef.current?.goToStation(siteId)}>
          <strong>{t('The landing sites are at the south pole')}</strong>
          <span>{t('Tap here to fly your ship there')} <Icon name="arrowDown" size={13} /></span>
        </button>
      )}
      {label && entry && !diving && !far && (
        <div className="orbit-label" style={{ transform: `translate(${label.x}px, ${label.y}px)` }} aria-hidden>{shortName(entry.name)}</div>
      )}
      {hover && hover.id !== siteId && !diving && (
        <div className="orbit-label is-hover" style={{ transform: `translate(${hover.x + 12}px, ${hover.y - 8}px)` }} aria-hidden>
          {shortName(sites.find((s) => s.id === hover.id)?.name ?? '')}
        </div>
      )}

      {entry && (
        <section className="station-card" aria-label={t('Landing station')}>
          {drawer === 'date' && (
            <div className="station-drawer">
              <label htmlFor="orbit-t" className="hud-label">{t('Landing (UTC)')}</label>
              <div className="hud-row">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => shift(-1)} aria-label={t('One day earlier')}>−1 d</button>
                <input id="orbit-t" type="datetime-local" step={3600} className="input mono" value={toLocalInput(new Date(startMs).toISOString())}
                  min={forecast ? toLocalInput(new Date(forecast.range[0]).toISOString()) : undefined}
                  max={forecast ? toLocalInput(new Date(forecast.range[1]).toISOString()) : undefined}
                  onChange={(e) => { const v = fromLocalInput(e.target.value); if (v) onStart(Date.parse(v)); }} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => shift(1)} aria-label={t('One day later')}>+1 d</button>
              </div>
              {forecast && forecast.ms !== startMs && <p className="small hud-note">{t('Moved into the data coverage: {0}', { 0: fmtUtc(forecast.ms) })}</p>}
              <p className="small muted">{t('The forecast uses the real horizon of the site and the Sun and Earth positions at that hour.')}</p>
            </div>
          )}
          {drawer === 'stations' && (
            <ul className="station-drawer orbit-sites" role="listbox" aria-label={t('Landing site')}>
              {order.map((id, k) => {
                const s = sites.find((x) => x.id === id)!;
                return (
                  <li key={id}>
                    <button type="button" role="option" aria-selected={id === siteId} className={id === siteId ? 'is-on' : ''} onClick={() => { if (!sceneRef.current?.traveling) { onSite(id); setDrawer(null); } }}>
                      <i className="dot" style={{ background: groupColor(s.group) }} aria-hidden /> <span className="mono small">{k + 1}</span> {shortName(s.name)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <ol className="flow-steps" aria-label={t('The mission')}>
            <li className="is-on">{t('1 Choose a site')}</li><li>{t('2 Land')}</li><li>{t('3 Drive the rover')}</li>
          </ol>
          <div className="station-top">
            <div className="station-id">
              <p className="eyebrow">{t('Stage 1 · Station {0} of {1}', { 0: index + 1, 1: order.length })}</p>
              <h2>{shortName(entry.name)}</h2>
              <p className="mono small muted">{fmtLatLon({ lat: entry.lat_deg, lon: entry.lon_deg }, 2)} · {t('slope')} {entry.slope_deg_50m.toFixed(1)}°</p>
            </div>
            {forecast ? (
              <div className="station-stats mono">
                <div><span className="hud-label"><Icon name="sun" size={12} /> {t('Sun now')}</span><strong>{forecast.margin >= 0 ? '+' : ''}{forecast.margin.toFixed(1)}°</strong></div>
                <div><span className="hud-label">{t('Sunlight, 14 d')}</span><strong>{forecast.m.lightPct.toFixed(0)}%</strong></div>
                <div><span className="hud-label"><Icon name="earth" size={12} /> {t('Earth, 14 d')}</span><strong>{forecast.m.earthPct.toFixed(0)}%</strong></div>
                <div className={`risk-${forecast.risk?.level ?? 'none'}`}><span className="hud-label">{t('Landing risk')}</span><strong>{riskText}</strong></div>
              </div>
            ) : <p className="small muted station-stats" role="status">{t('Loading the site’s horizon and ephemeris…')}</p>}
          </div>

          <div className="station-actions">
            <button type="button" className="btn btn-ghost station-step" onClick={() => { stopTour(); travel(-1); }} disabled={diving} aria-label={t('Previous station')}>
              <Icon name="chevronLeft" size={20} /><span>{t('Previous')}</span>
            </button>
            <button type="button" className="btn btn-primary station-land" onClick={() => { stopTour(); descend(); }} disabled={diving}>
              <Icon name="arrowDown" size={18} /> {t('Land here')}
            </button>
            <button type="button" className="btn btn-ghost station-step" onClick={() => { stopTour(); travel(1); }} disabled={diving} aria-label={t('Next station')}>
              <span>{t('Next')}</span><Icon name="chevronRight" size={20} />
            </button>
          </div>

          <div className="station-more">
            {touring
              ? <button type="button" className="hud-link station-tour is-on" onClick={stopTour}><Icon name="close" size={14} /> {t('Stop the tour')}</button>
              : <button type="button" className="hud-link station-tour" onClick={startTour}><Icon name="play" size={14} /> {t('Tour all {0} stations', { 0: order.length })}</button>}
            <button type="button" className="hud-link" aria-expanded={drawer === 'date'} onClick={() => setDrawer((d) => (d === 'date' ? null : 'date'))}><Icon name="calendar" size={14} /> {fmtUtc(forecast?.ms ?? startMs)}</button>
            <button type="button" className="hud-link" aria-expanded={drawer === 'stations'} onClick={() => setDrawer((d) => (d === 'stations' ? null : 'stations'))}><Icon name="list" size={14} /> {t('All stations')}</button>
            {saved && <button type="button" className="hud-link" onClick={onContinue}><Icon name="rotate" size={14} /> {t('Continue saved mission')} · {saved.label}</button>}
          </div>
          <p className="station-keys ctl-keys">
            <kbd className="keycap">←</kbd><kbd className="keycap">→</kbd> {t('travel')} · <kbd className="keycap is-wide">{t('SPACE')}</kbd> {t('land')} · {t('drag to look around')}
          </p>
          <p className="station-keys ctl-touch">{t('Previous / Next to travel · drag to look around · ship not to scale')}</p>
        </section>
      )}
    </div>
  );
}
