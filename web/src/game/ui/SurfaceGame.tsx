import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../i18n';
import { fmtUtc } from '../../components/format';
import type { TerrainData } from '../../lib/terrain';
import { viewerError } from '../../lib/terrain';
import { MAX_DRIVE_WARP, WARPS } from '../sim/clock';
import { fmtLatLon, type LatLon, latLonToLocal, localToLatLon, parseLatLon, route } from '../sim/geo';
import { allDone, type MissionState, newMission, type ObjectiveId, OBJECTIVES, score, updateMission } from '../sim/mission';
import { netPowerW } from '../sim/power';
import { RULES } from '../sim/rules';
import { type Env, newWorld, scan, scanBlocker, stepWorld, type World } from '../sim/world';
import { type CameraMode, SurfaceScene } from '../render/SurfaceScene';
import { LESSONS } from './lessons';

interface Props {
  env: Env;
  terrain: TerrainData;
  site: { id: string; name: string } & LatLon;
  startMs: number;
  /** Published metrics of this site for 14 days from startMs (shown in the mission report). */
  published: { lightPct: number; earthPct: number } | null;
}

const KEYS = { up: ['w', 'arrowup'], down: ['s', 'arrowdown'], left: ['a', 'arrowleft'], right: ['d', 'arrowright'] };
const objectiveTitle = (id: ObjectiveId) =>
  t(LESSONS[id].title, { 0: id === 'drive' ? RULES.mission.driveM : id === 'downlink' ? RULES.mission.downlinkMB : RULES.mission.surviveH });

export default function SurfaceGame({ env, terrain, site, startMs, published }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World>({ ...newWorld(env, startMs), paused: true });
  const mission = useRef<MissionState>(newMission(env.field, startMs));
  const sceneRef = useRef<SurfaceScene | null>(null);
  const keys = useRef(new Set<string>());
  const touch = useRef({ throttle: 0, steer: 0 });
  const [hud, setHud] = useState<World>(world.current);
  const [m, setM] = useState<MissionState>(mission.current);
  const [briefing, setBriefing] = useState(true);
  const [debrief, setDebrief] = useState(false);
  const [toast, setToast] = useState<ObjectiveId | null>(null);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState<CameraMode>('chase');
  const [navText, setNavText] = useState('');
  const [navMsg, setNavMsg] = useState('');
  const [nav, setNav] = useState<{ x: number; y: number } | null>(null);
  const [scanMsg, setScanMsg] = useState('');
  const [alert, setAlert] = useState<World['alert']>('');
  const [navOpen, setNavOpen] = useState(() => !window.matchMedia('(max-width: 699px)').matches);
  const [compact] = useState(() => window.matchMedia('(max-width: 699px)').matches);

  const doScan = () => {
    const why = scanBlocker(world.current);
    if (why) { setScanMsg(t(why === 'moving' ? 'Stop the rover to scan' : 'Not enough battery to scan')); return; }
    world.current = scan(world.current);
    setScanMsg(t('Scan done: +{0} MB waiting for an Earth link', { 0: RULES.science.scanMB }));
  };
  const scanRef = useRef(doScan);
  scanRef.current = doScan;

  useEffect(() => {
    const node = host.current!;
    let scene: SurfaceScene;
    try {
      const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
      scene = new SurfaceScene(node, env.field, env.horizon, terrain, lowEnd);
    } catch (e) {
      setError(t(viewerError(e)));
      return;
    }
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __surface?: SurfaceScene }).__surface = scene;
    let frame = 0, last = performance.now(), lastHud = 0, toastTimer = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const k = keys.current, any = (names: string[]) => names.some((n) => k.has(n));
      const input = {
        throttle: (any(KEYS.up) ? 1 : 0) - (any(KEYS.down) ? 1 : 0) + touch.current.throttle,
        steer: (any(KEYS.right) ? 1 : 0) - (any(KEYS.left) ? 1 : 0) + touch.current.steer,
      };
      const wasEnded = world.current.ended;
      world.current = stepWorld(env, world.current, input, dt);
      const r = updateMission(mission.current, world.current);
      if (r.completed.length) {
        mission.current = r.mission;
        setM(r.mission);
        setToast(r.completed[r.completed.length - 1]);
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setToast(null), 9000);
        if (allDone(r.mission)) { world.current = { ...world.current, paused: true }; setDebrief(true); }
      }
      if (world.current.ended && !wasEnded) setDebrief(true);
      if (world.current.alert) {
        setAlert(world.current.alert);
        world.current = { ...world.current, alert: '' };
        window.setTimeout(() => setAlert(''), 8000);
      }
      scene.render(world.current, dt);
      if (now - lastHud > 120) { setHud(world.current); lastHud = now; }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const typing = (e: KeyboardEvent) => e.target instanceof Element && !!e.target.closest('input, textarea, select');
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (Object.values(KEYS).flat().includes(key)) { e.preventDefault(); keys.current.add(key); }
      if (key === 'p') world.current = { ...world.current, paused: !world.current.paused };
      if (key === 'e') scanRef.current();
      if (key === '[' || key === ']') {
        const i = WARPS.indexOf(world.current.warp as (typeof WARPS)[number]);
        const next = WARPS[Math.max(0, Math.min(WARPS.length - 1, i + (key === ']' ? 1 : -1)))];
        world.current = { ...world.current, warp: next };
      }
      if (key === 'c') setCamera((c) => (c === 'chase' ? 'mast' : c === 'mast' ? 'top' : 'chase'));
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(toastTimer);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [env, terrain]);

  useEffect(() => { if (sceneRef.current) sceneRef.current.mode = camera; }, [camera]);
  useEffect(() => { sceneRef.current?.setBeacon(nav); }, [nav]);
  useEffect(() => {
    if (!scanMsg) return;
    const id = setTimeout(() => setScanMsg(''), 5000);
    return () => clearTimeout(id);
  }, [scanMsg]);

  const set = (patch: Partial<World>) => { world.current = { ...world.current, ...patch }; setHud(world.current); };
  const start = () => { setBriefing(false); set({ paused: false }); sceneRef.current?.renderer.domElement.focus(); };
  const resume = () => { setDebrief(false); set({ paused: false }); };
  const restart = () => {
    world.current = newWorld(env, startMs);
    mission.current = newMission(env.field, startMs);
    setM(mission.current); setHud(world.current); setNav(null); setDebrief(false); setToast(null);
  };
  const here = localToLatLon(site, hud.rover.x, hud.rover.y);
  const battery = hud.power.chargeWh / RULES.power.batteryWh;
  const net = netPowerW(hud.sunFrac, Math.abs(hud.rover.speed) > 1e-3);
  const sunMargin = hud.sky.sunEl - hud.sunHorizon;
  const nr = nav ? route(hud.rover.x, hud.rover.y, nav.x, nav.y) : null;
  const turn = nr ? ((nr.bearing - hud.rover.heading + 540) % 360) - 180 : 0;
  const drivable = hud.warp <= MAX_DRIVE_WARP;
  const next = OBJECTIVES.find((id) => m.done[id] === undefined);
  const doneCount = OBJECTIVES.filter((id) => m.done[id] !== undefined).length;
  const elapsedH = (hud.tMs - startMs) / 3600000;

  const goTo = (p: LatLon | null) => {
    if (!p) { setNavMsg(t('Type a coordinate like "-89.45, -137.2"')); return; }
    const local = latLonToLocal(site, p);
    const limit = env.field.near.half - RULES.rover.edgeMarginM;
    if (Math.max(Math.abs(local.x), Math.abs(local.y)) > limit) {
      setNavMsg(t('Outside the drivable area (±{0} km of real 10 m terrain around this site)', { 0: (limit / 1000).toFixed(1) }));
      return;
    }
    setNavMsg('');
    setNav(local);
  };
  const hold = (patch: Partial<{ throttle: number; steer: number }>) => {
    const release = () => Object.assign(touch.current, Object.fromEntries(Object.keys(patch).map((k) => [k, 0])));
    return {
      onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); Object.assign(touch.current, patch); },
      onPointerUp: release, onPointerLeave: release, onPointerCancel: release,
    };
  };

  return (
    <div className="game">
      <div ref={host} className="game-canvas" aria-label={t('Rover on the real lunar terrain')} />
      {error && <div className="game-overlay" role="alert">{error}</div>}

      <div className="game-hud game-top">
        <div className="hud-col">
        <div className="hud-card">
          <div className="hud-label">{site.name} · {t('simulated time')}</div>
          <div className="hud-big mono">{fmtUtc(hud.tMs)}</div>
          <div className="hud-warp" role="group" aria-label={t('Time warp')}>
            {WARPS.map((x) => (
              <button key={x} type="button" aria-pressed={hud.warp === x} onClick={() => set({ warp: x })} title={t('Time runs {0}× faster', { 0: x })}>{x}×</button>
            ))}
            <button type="button" aria-pressed={hud.paused} onClick={() => set({ paused: !hud.paused })}>{hud.paused ? t('Resume') : t('Pause')}</button>
          </div>
          {!drivable && <div className="hud-note">{t('Rover parked during fast time warp (> {0}×)', { 0: MAX_DRIVE_WARP })}</div>}
          <button type="button" className="hud-link hud-help" onClick={() => { set({ paused: true }); setBriefing(true); }}>? {t('How to play')}</button>
        </div>

        <details className="hud-card hud-objectives" open={!compact}>
          <summary className="hud-label">{t('Objectives')} {doneCount}/{OBJECTIVES.length}</summary>
          <ol>
            {OBJECTIVES.map((id) => (
              <li key={id} className={m.done[id] !== undefined ? 'is-done' : id === next ? 'is-next' : ''}>
                <span aria-hidden>{m.done[id] !== undefined ? '✓' : id === next ? '▸' : '○'}</span> {objectiveTitle(id)}
                {id === 'waypoint' && m.done.waypoint === undefined && (
                  <button type="button" className="hud-link" onClick={() => setNav(m.waypoint)}>{t('Guide me')}</button>
                )}
              </li>
            ))}
          </ol>
          {next && <p className="hud-how"><strong>{t('How:')}</strong> {t(LESSONS[next].how)}</p>}
          {next && <p className="hud-lesson">{t(LESSONS[next].lesson)}</p>}
        </details>
        </div>

        <div className="hud-card hud-right">
          <div className="hud-label">{t('Position')}</div>
          <div className="mono">{fmtLatLon(here)}</div>
          <div className="mono small">{t('Heading')} {hud.rover.heading.toFixed(0)}° · {(hud.rover.odometer / 1000).toFixed(2)} km</div>
        </div>
      </div>

      {alert && (
        <div className="game-alert" role="alert">
          {t(alert === 'sunset'
            ? 'Sunset at the rover! Time slowed to 60×. Drive back into the light before the battery runs out.'
            : 'Battery below 25%! Time slowed to 60×. Find sunlight to recharge.')}
        </div>
      )}
      {toast && (
        <div className="game-toast" role="status">
          <strong>✓ {objectiveTitle(toast)}</strong>
          <span>{t(LESSONS[toast].lesson)}</span>
        </div>
      )}

      <div className="game-hud game-bottom">
        <div className="hud-card hud-gauges">
          <div className="gauge">
            <span className="hud-label">{t('Battery')}</span>
            <meter min={0} max={1} low={0.25} optimum={1} value={battery} aria-label={t('Battery')} />
            <span className="mono small">{(battery * 100).toFixed(0)}% · {net >= 0 ? '+' : ''}{net.toFixed(0)} W</span>
          </div>
          <div className={`gauge ${hud.sunFrac > 0.5 ? 'is-on' : 'is-off'}`}>
            <span className="hud-label">☀ {t('Sun')}</span>
            <span className="mono small">{hud.sunFrac > 0.01 ? t('{0}% of the disk visible', { 0: (hud.sunFrac * 100).toFixed(0) }) : t('In shadow')}</span>
            <span className="mono small gauge-sub">{sunMargin >= 0 ? '+' : ''}{sunMargin.toFixed(2)}° {t('vs real horizon')}</span>
          </div>
          <div className={`gauge ${hud.earthUp ? 'is-on' : 'is-off'}`}>
            <span className="hud-label">⊕ {t('Earth link')}</span>
            <span className="mono small">{hud.earthUp ? t('Connected') : t('No line of sight')}</span>
            <span className="mono small gauge-sub">{t('{0} MB waiting · {1} MB sent', { 0: hud.power.dataMB.toFixed(1), 1: hud.power.sentMB.toFixed(1) })}</span>
            {!hud.earthUp && hud.power.dataMB > 0 && <span className="hud-note small gauge-sub">{t('Data waits until the Earth rises: try ] to speed up time')}</span>}
          </div>
          <div className="gauge">
            <span className="hud-label">{t('Rover')}</span>
            <span className="mono small gauge-sub">{hud.rover.speed.toFixed(2)} m/s {t('real')}</span>
            <span className="mono small">≈ {(Math.abs(hud.rover.speed) * hud.warp * 3.6).toFixed(0)} km/h <span className="gauge-sub">{t('on screen')}</span></span>
            {hud.rover.blocked && <span className="hud-warn small">{t(hud.rover.blocked === 'slope' ? 'Too steep to climb' : hud.rover.blocked === 'edge' ? 'Edge of the mapped area' : 'Rover tipped over')}</span>}
          </div>
          <div className="gauge gauge-actions">
            <button type="button" className="btn btn-sm hud-scan" onClick={doScan}>🔬 {t('Scan')} <span className="ctl-keys">(E)</span></button>
            <button type="button" className="btn btn-sm btn-ghost hud-navtoggle" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>📍 {t('Navigate')}</button>
            {scanMsg && <span className="small" role="status">{scanMsg}</span>}
          </div>
        </div>

        <form className="hud-card hud-nav" hidden={!navOpen} onSubmit={(e) => { e.preventDefault(); goTo(parseLatLon(navText)); }}>
          <label className="hud-label" htmlFor="nav-to">{t('Navigate to (lat, lon)')}</label>
          <div className="hud-row">
            <input id="nav-to" className="input mono" value={navText} placeholder="-89.45, -137.20" onChange={(e) => setNavText(e.target.value)} />
            <button type="submit" className="btn btn-sm">{t('Go')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNav({ x: 0, y: 0 })}>{t('Landing site')}</button>
          </div>
          {navMsg && <div className="hud-warn small" role="status">{navMsg}</div>}
          {nr && (
            <div className="hud-route mono small" aria-live="polite">
              <span className="hud-arrow" style={{ transform: `rotate(${turn}deg)` }} aria-hidden>↑</span>
              {nr.dist < 15 ? t('Arrived') : t('{0} m · bearing {1}° · ETA {2} h at full speed', { 0: nr.dist.toFixed(0), 1: nr.bearing.toFixed(0), 2: (nr.dist / RULES.rover.maxSpeed / 3600).toFixed(1) })}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNav(null)} aria-label={t('Clear route')}>✕</button>
            </div>
          )}
        </form>

        <div className="hud-card hud-cams" role="group" aria-label={t('Camera')}>
          {(['chase', 'mast', 'top'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={camera === c} onClick={() => setCamera(c)}>{t(c === 'chase' ? 'Chase' : c === 'mast' ? 'Mast camera' : 'Top')}</button>
          ))}
        </div>
      </div>

      <div className="game-touch">
        <button type="button" aria-label={t('Forward')} {...hold({ throttle: 1 })}>▲</button>
        <div>
          <button type="button" aria-label={t('Turn left')} {...hold({ steer: -1 })}>◀</button>
          <button type="button" aria-label={t('Reverse')} {...hold({ throttle: -1 })}>▼</button>
          <button type="button" aria-label={t('Turn right')} {...hold({ steer: 1 })}>▶</button>
        </div>
      </div>

      {briefing && (
        <div className="game-overlay game-briefing" role="dialog" aria-modal="true" aria-labelledby="brief-title">
          <div className="brief-card">
            <p className="eyebrow">{t('Mission briefing')}</p>
            <h2 id="brief-title">{t('You command a solar rover at {0}', { 0: site.name })}</h2>
            <p>{t('Near the lunar south pole the Sun never climbs high: it circles just above the horizon, so every ridge decides who gets light and who freezes. Your rover lives on sunlight and talks to Earth only when it can see it.')}</p>
            <ul className="brief-facts">
              <li><strong>{t('Real:')}</strong> {t('NASA LOLA terrain, Sun and Earth positions for {0} (JPL SPICE), lunar gravity.', { 0: fmtUtc(startMs) })}</li>
              <li><strong>{t('Game:')}</strong> {t('Battery size, speed and objectives are game assumptions (see Game rules below the view).')}</li>
              <li><strong>{t('Goal:')}</strong> {t('Complete {0} objectives. Each one explains why landing sites are chosen where they are.', { 0: OBJECTIVES.length })}</li>
            </ul>
            <div className="brief-controls">
              <div className="ctl-keys"><span className="hud-label">{t('Keyboard')}</span><span>{t('W/S or ↑/↓ drive · A/D or ←/→ steer · E scan · [ ] time warp · C camera · P pause · drag to look')}</span></div>
              <div className="ctl-touch"><span className="hud-label">{t('Touch')}</span><span>{t('Arrow pad to drive · Scan button · drag to look around')}</span></div>
            </div>
            <button type="button" className="btn btn-primary" onClick={start} autoFocus>{hud.tMs > startMs ? t('Continue') : t('Start mission')}</button>
          </div>
        </div>
      )}

      {debrief && (
        <div className="game-overlay game-briefing" role="dialog" aria-modal="true" aria-labelledby="debrief-title">
          <div className="brief-card">
            <p className="eyebrow">{t('Mission report')}</p>
            <h2 id="debrief-title">
              {allDone(m) ? t('Mission complete!') : hud.ended === 'battery' ? t('Battery depleted') : t('End of ephemeris coverage')}
            </h2>
            {hud.ended === 'battery' && <p>{t('The rover froze in the lunar night. Stay where the real horizon lets the Sun through.')}</p>}
            <div className="brief-stats mono">
              <div><span className="hud-label">{t('Score')}</span><strong>{score(m, hud)}</strong></div>
              <div><span className="hud-label">{t('Objectives')}</span><strong>{doneCount}/{OBJECTIVES.length}</strong></div>
              <div><span className="hud-label">{t('Distance')}</span><strong>{(hud.rover.odometer / 1000).toFixed(2)} km</strong></div>
              <div><span className="hud-label">{t('Data sent')}</span><strong>{hud.power.sentMB.toFixed(1)} MB</strong></div>
              <div><span className="hud-label">{t('Time on the Moon')}</span><strong>{elapsedH.toFixed(0)} h</strong></div>
            </div>
            {published && (
              <p className="small">
                {t('Published analysis of this site for 14 days from your start: sunlight {0}% · Earth visible {1}% of the hours.', { 0: published.lightPct.toFixed(0), 1: published.earthPct.toFixed(0) })}{' '}
                <Link className="link" to={`/?site=${encodeURIComponent(site.id)}`}>{t('Open it in Explore')} →</Link>
              </p>
            )}
            <div className="hud-row">
              <button type="button" className="btn btn-primary" onClick={restart}>{t('Play again')}</button>
              {!hud.ended && <button type="button" className="btn btn-ghost" onClick={resume}>{t('Keep exploring')}</button>}
              <Link className="btn btn-ghost" to="/replan">{t('Find a better landing date')}</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
