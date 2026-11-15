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
import { OrbitScene } from '../render/OrbitScene';

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

/** Mission stage 1: pick a site and a landing hour from orbit, with a forecast from the real data. */
export default function OrbitPicker({ sites, basemap, siteId, startMs, onSite, onStart, onDescend, saved, onContinue }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrbitScene | null>(null);
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [diving, setDiving] = useState(false);
  const [label, setLabel] = useState<{ x: number; y: number } | null>(null);
  const [far, setFar] = useState(true);
  const entry = sites.find((s) => s.id === siteId);
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
      scene.onPick = (id) => pick.current(id);
      scene.onHover = (id, x, y) => {
        const r = node.getBoundingClientRect();
        setHover(id ? { id, x: x - r.left, y: y - r.top } : null);
      };
      sceneRef.current = scene;
      scene.onFar = setFar;
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
  useEffect(() => { sceneRef.current?.select(siteId); }, [siteId]);

  // keep the selected site's label glued to its pin
  useEffect(() => {
    let raf = 0;
    const tick = () => { setLabel(sceneRef.current?.screenOf(siteId) ?? null); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [siteId]);

  const descend = () => {
    const ms = forecast?.ms ?? startMs;
    if (!sceneRef.current) { onDescend(siteId, ms); return; }
    setDiving(true);
    sceneRef.current.descend(siteId, () => onDescend(siteId, ms));
  };
  const shift = (days: number) => onStart(startMs + days * DAY);
  const riskText = forecast?.risk ? t(forecast.risk.level === 'low' ? 'Low' : forecast.risk.level === 'medium' ? 'Medium' : 'High') : '—';

  return (
    <div className={`orbit${diving ? ' is-diving' : ''}`}>
      <div ref={host} className="orbit-canvas" aria-label={t('The lunar south pole seen from orbit, with the candidate landing sites')} />
      {error && <div className="game-overlay" role="alert">{error}</div>}
      <div className="globe-nav" role="group" aria-label={t('Globe navigation')}>
        <button type="button" onClick={() => sceneRef.current?.zoomOut()}>🌕 {t('Whole Moon')}</button>
        <button type="button" onClick={() => sceneRef.current?.zoomToPole()}>⬇ {t('South pole')}</button>
        <button type="button" onClick={() => sceneRef.current?.select(siteId, true)}>◎ {entry ? shortName(entry.name) : ''}</button>
      </div>
      <p className="globe-hint" aria-hidden>
        <span className="ctl-keys">{t('Drag to spin the Moon · scroll to zoom · click a pin to choose')}</span>
        <span className="ctl-touch">{t('Drag to spin · pinch to zoom · tap a pin')}</span>
      </p>
      {far && !diving && (
        <button type="button" className="globe-callout" onClick={() => sceneRef.current?.zoomToPole()}>
          <strong>{t('The candidate sites are at the south pole')}</strong>
          <span>{t('Zoom in, or tap here to fly there')} ↓</span>
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

      <aside className="orbit-panel" aria-label={t('Choose a landing site')}>
        <p className="eyebrow">{t('Stage 1 · From orbit')}</p>
        <h2>{t('Choose where to land')}</h2>
        <p className="small muted">{t('Real LOLA relief of the south pole. Pick a site on the globe or in the list, then a landing hour: the forecast uses the published horizon and Sun/Earth positions of that site.')}</p>

        {saved && (
          <button type="button" className="btn btn-sm btn-ghost orbit-continue" onClick={onContinue}>↺ {t('Continue saved mission')} · {saved.label}</button>
        )}

        <ul className="orbit-sites" role="listbox" aria-label={t('Landing site')}>
          {sites.map((s) => (
            <li key={s.id}>
              <button type="button" role="option" aria-selected={s.id === siteId} className={s.id === siteId ? 'is-on' : ''} onClick={() => { onSite(s.id); sceneRef.current?.select(s.id, true); }}>
                <i className="dot" style={{ background: groupColor(s.group) }} aria-hidden /> {shortName(s.name)}
              </button>
            </li>
          ))}
        </ul>

        {entry && (
          <div className="orbit-forecast">
            <div className="orbit-site mono small">{fmtLatLon({ lat: entry.lat_deg, lon: entry.lon_deg }, 3)} · {t('slope')} {entry.slope_deg_50m.toFixed(1)}°</div>
            <div className="orbit-time">
              <label htmlFor="orbit-t" className="hud-label">{t('Landing (UTC)')}</label>
              <div className="hud-row">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => shift(-1)} aria-label={t('One day earlier')}>−1 d</button>
                <input id="orbit-t" type="datetime-local" step={3600} className="input mono" value={toLocalInput(new Date(startMs).toISOString())}
                  min={forecast ? toLocalInput(new Date(forecast.range[0]).toISOString()) : undefined}
                  max={forecast ? toLocalInput(new Date(forecast.range[1]).toISOString()) : undefined}
                  onChange={(e) => { const v = fromLocalInput(e.target.value); if (v) onStart(Date.parse(v)); }} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => shift(1)} aria-label={t('One day later')}>+1 d</button>
              </div>
            </div>
            {forecast ? (
              <div className="brief-stats mono">
                <div><span className="hud-label">☀ {t('Sun at landing')}</span><strong>{forecast.margin >= 0 ? '+' : ''}{forecast.margin.toFixed(2)}°</strong><em>{t('over the real horizon')}</em></div>
                <div><span className="hud-label">{t('Sunlight, 14 d')}</span><strong>{forecast.m.lightPct.toFixed(0)}%</strong></div>
                <div><span className="hud-label">⊕ {t('Earth visible, 14 d')}</span><strong>{forecast.m.earthPct.toFixed(0)}%</strong></div>
                <div className={`risk-${forecast.risk?.level ?? 'none'}`}><span className="hud-label">{t('Landing light risk')}</span><strong>{riskText}</strong></div>
              </div>
            ) : <p className="small muted" role="status">{t('Loading the site’s horizon and ephemeris…')}</p>}
            {forecast && forecast.ms !== startMs && <p className="small hud-note">{t('Moved into the data coverage: {0}', { 0: fmtUtc(forecast.ms) })}</p>}
            <button type="button" className="btn btn-primary orbit-go" disabled={diving} onClick={descend}>{t('Descend to {0}', { 0: shortName(entry.name) })} ↓</button>
          </div>
        )}
      </aside>
    </div>
  );
}
