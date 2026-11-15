import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { illumAt, type IllumMap } from '../../lib/illum';
import { Link } from 'react-router-dom';
import { t } from '../../i18n';
import { fmtUtc } from '../../components/format';
import type { TerrainData } from '../../lib/terrain';
import { viewerError } from '../../lib/terrain';
import { MAX_DRIVE_WARP, WARPS } from '../sim/clock';
import { heightAt } from '../sim/field';
import { fmtLatLon, type LatLon, latLonToLocal, localToLatLon, parseLatLon, route } from '../sim/geo';
import { allDone, type MissionState, newMission, type ObjectiveId, OBJECTIVES, score, updateMission } from '../sim/mission';
import { RULES } from '../sim/rules';
import { type Env, newWorld, scan, scanBlocker, stepWorld, type World } from '../sim/world';
import { type CameraMode, SurfaceScene } from '../render/SurfaceScene';
import { LESSONS } from './lessons';
import { newLander, stepLander, type LanderState } from '../sim/lander';
import { newRover } from '../sim/rover';
import { sunFraction } from '../../lib/sunFraction';
import { skyAt } from '../sim/clock';
import Minimap from './Minimap';
import DescentPanel from './DescentPanel';
import KeyHints from './KeyHints';
import { type Action, actionOf, isTyping, letterOf, warpStepOf } from './controls';
import { clearSave, loadSave, writeSave } from './save';
import Icon from '../../components/Icon';

interface Props {
  env: Env;
  terrain: TerrainData;
  site: { id: string; name: string } & LatLon;
  startMs: number;
  /** Published metrics of this site for 14 days from startMs (shown in the mission report). */
  published: { lightPct: number; earthPct: number } | null;
  /** Coming from the orbit stage: start the descent (or the saved mission) without the briefing. */
  autostart?: 'descent' | 'continue';
  /** Yearly sunlight / Earth map of the site (null when not generated). */
  illum?: IllumMap | null;
}

type Phase = 'brief' | 'descent' | 'surface';
const TARGET = { x: 0, y: 0 };
const objectiveTitle = (id: ObjectiveId) =>
  t(LESSONS[id].title, { 0: id === 'drive' ? RULES.mission.driveM : id === 'downlink' ? RULES.mission.downlinkMB : RULES.mission.surviveH });

export default function SurfaceGame({ env, terrain, site, startMs, published, autostart, illum = null }: Props) {
  const lightAt = useMemo(() => (illum ? (x: number, y: number) => illumAt(illum, 'light', x, y) : undefined), [illum]);
  const earthAt = useMemo(() => (illum ? (x: number, y: number) => illumAt(illum, 'earth', x, y) : undefined), [illum]);
  const [layer, setLayer] = useState<'now' | 'light' | 'earth'>('now');
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World>({ ...newWorld(env, startMs), paused: true });
  const mission = useRef<MissionState>(newMission(env.field, startMs, illum ? (x, y) => illumAt(illum, 'light', x, y) : undefined));
  const sceneRef = useRef<SurfaceScene | null>(null);
  const keys = useRef(new Set<Action>());
  // The descent waits for the player's first control, so nobody starts it already falling.
  const waitingRef = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const touch = useRef({ throttle: 0, steer: 0, thrust: 0 });
  const [hud, setHud] = useState<World>(world.current);
  const [m, setM] = useState<MissionState>(mission.current);
  const [briefing, setBriefing] = useState(!autostart);
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
  const [saved, setSaved] = useState(() => loadSave(site.id, startMs));
  const phaseRef = useRef<Phase>('brief');
  const [phase, setPhaseState] = useState<Phase>('brief');
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const landerRef = useRef<LanderState | null>(null);
  const [landerHud, setLanderHud] = useState<LanderState | null>(null);
  const landingRef = useRef<{ x: number; y: number } | null>(null);
  const [landing, setLanding] = useState<{ ok: boolean; reason: string; vz: number; vh: number; slope: number; dist: number; fuelPct: number; lit: boolean } | null>(null);
  const [bakeVersion, setBakeVersion] = useState(0);
  const [keysOpen, setKeysOpen] = useState(true);
  const idleSince = useRef(performance.now());
  const sunlitAt = useCallback((x: number, y: number) => sceneRef.current?.sunlitAt(x, y) ?? 1, []);
  const sunBelow = useCallback((l: LanderState) => {
    const sky = skyAt(env.ephem, world.current.tMs);
    return sunFraction(sky.sunEl, env.horizon.at(l.x, l.y, sky.sunAz));
  }, [env]);

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
    if (import.meta.env.DEV) Object.assign(window, { __surface: scene, __lander: landerRef });
    let frame = 0, last = performance.now(), lastHud = 0, toastTimer = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const k = keys.current;
      const input = {
        throttle: (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0) + touch.current.throttle,
        steer: (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0) + touch.current.steer,
      };
      if (phaseRef.current === 'descent' && landerRef.current) {
        const lin = { throttle: k.has('thrust') || touch.current.thrust ? 1 : 0, east: input.steer, north: (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0) + touch.current.throttle };
        if (waitingRef.current) {
          if (k.size || touch.current.thrust || touch.current.throttle || touch.current.steer) { waitingRef.current = false; setWaiting(false); }
          else { scene.render(world.current, dt, landerRef.current, true); frame = requestAnimationFrame(loop); return; }
        }
        let l = landerRef.current;
        for (let t2 = 0; t2 < dt && !l.landed; t2 += 0.02) l = stepLander(env.field, l, lin, Math.min(0.02, dt - t2));
        if (l.landed && !landerRef.current.landed) {
          const tc = l.touch!;
          const lit = sunBelow(l) > 0.5;
          setLanding({ ok: l.landed === 'ok', reason: l.reason, vz: tc.vz, vh: tc.vh, slope: tc.slope, dist: Math.hypot(l.x - TARGET.x, l.y - TARGET.y), fuelPct: (l.fuelKg / RULES.lander.fuelKg) * 100, lit });
          if (l.landed === 'ok') landingRef.current = { x: l.x, y: l.y };
        }
        landerRef.current = l;
        scene.render(world.current, dt, l, true);
        if (now - lastHud > 100) { setLanderHud(l); lastHud = now; }
        frame = requestAnimationFrame(loop);
        return;
      }
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
      scene.render(world.current, dt, landerRef.current, false);
      if (input.throttle || input.steer) idleSince.current = now;
      if (now - lastHud > 120) {
        setHud(world.current); setBakeVersion(scene.bakeVersion); lastHud = now;
        if (now - idleSince.current > 8000 && !world.current.paused) { setKeysOpen(true); idleSince.current = now; }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const action = actionOf(e);
      if (action && phaseRef.current !== 'brief') {
        e.preventDefault(); // no page scroll, and Space never presses a focused button
        keys.current.add(action);
      }
      if (phaseRef.current !== 'surface' || e.ctrlKey || e.metaKey || e.altKey) return;
      const letter = letterOf(e), step = warpStepOf(e);
      if (letter === 'p') world.current = { ...world.current, paused: !world.current.paused };
      if (letter === 'e') scanRef.current();
      if (step) {
        const i = WARPS.indexOf(world.current.warp as (typeof WARPS)[number]);
        const next = WARPS[Math.max(0, Math.min(WARPS.length - 1, i + step))];
        world.current = { ...world.current, warp: next };
      }
      if (letter === 'c') setCamera((c) => (c === 'chase' ? 'mast' : c === 'mast' ? 'top' : 'chase'));
    };
    const up = (e: KeyboardEvent) => {
      // release by both mappings: a key pressed with Ctrl down may come back without it
      const a = actionOf({ code: e.code, key: e.key }), b = actionOf({ key: e.key });
      if (a) keys.current.delete(a);
      if (b) keys.current.delete(b);
    };
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
  }, [env, terrain, sunBelow]);

  useEffect(() => { if (sceneRef.current) sceneRef.current.mode = camera; }, [camera]);
  useEffect(() => {
    if (phase !== 'surface') return;
    const save = () => {
      const w = world.current;
      if (w.ended) return;
      writeSave({ site: site.id, startMs, savedAt: Date.now(), landing: landingRef.current, world: { tMs: w.tMs, warp: w.warp, rover: w.rover, power: w.power, thermal: w.thermal, scans: w.scans }, mission: mission.current });
    };
    const id = window.setInterval(save, 5000);
    window.addEventListener('pagehide', save);
    return () => { clearInterval(id); window.removeEventListener('pagehide', save); save(); };
  }, [phase, site.id, startMs]);
  useEffect(() => { sceneRef.current?.setBeacon(nav); }, [nav]);
  useEffect(() => { sceneRef.current?.setOverlay(layer === 'light' ? lightAt ?? null : layer === 'earth' ? earthAt ?? null : null); }, [layer, lightAt, earthAt, phase]);
  useEffect(() => {
    if (!scanMsg) return;
    const id = setTimeout(() => setScanMsg(''), 5000);
    return () => clearTimeout(id);
  }, [scanMsg]);

  const set = (patch: Partial<World>) => { world.current = { ...world.current, ...patch }; setHud(world.current); };
  const focusView = () => {
    // a button that keeps focus would also react to Space: hand the keyboard to the 3D view
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    sceneRef.current?.renderer.domElement.focus({ preventScroll: true });
  };
  const beginSurface = (at: { x: number; y: number } | null) => {
    landingRef.current = at;
    const spot = at ? { x: at.x + 5, y: at.y - 3 } : { x: 0, y: 0 };
    world.current = { ...world.current, rover: newRover(spot.x, spot.y, 0), paused: false };
    setHud(world.current);
    setPhase('surface');
  };
  const startDescent = () => {
    setBriefing(false); setLanding(null);
    landerRef.current = newLander(env.field, TARGET);
    setLanderHud(landerRef.current);
    keys.current.clear();
    waitingRef.current = true; setWaiting(true);
    setPhase('descent');
    focusView();
  };
  const skipToSurface = () => { setBriefing(false); landerRef.current = { ...newLander(env.field, TARGET), x: TARGET.x - 6, y: TARGET.y + 4, z: 0, landed: 'ok' }; landerRef.current.z = heightAtSite(landerRef.current.x, landerRef.current.y); beginSurface({ x: landerRef.current.x, y: landerRef.current.y }); focusView(); };
  const continueSaved = () => {
    if (!saved) return;
    setBriefing(false);
    const base = newWorld(env, saved.world.tMs);
    // saves from before the thermal model lack some fields: fill them from a fresh world
    world.current = { ...base, ...saved.world, rover: { ...newRover(), ...saved.world.rover }, thermal: saved.world.thermal ?? base.thermal, paused: false };
    mission.current = saved.mission;
    setM(saved.mission);
    if (saved.landing) landerRef.current = { ...newLander(env.field, TARGET), x: saved.landing.x, y: saved.landing.y, z: heightAtSite(saved.landing.x, saved.landing.y), landed: 'ok' };
    landingRef.current = saved.landing;
    setHud(world.current);
    setPhase('surface');
    focusView();
  };
  const start = () => { setBriefing(false); set({ paused: false }); focusView(); };
  const auto = useRef({ startDescent, continueSaved });
  auto.current = { startDescent, continueSaved };
  useEffect(() => {
    if (!autostart) return;
    const id = window.setTimeout(() => {
      if (autostart === 'continue' && loadSave(site.id, startMs)) auto.current.continueSaved();
      else auto.current.startDescent();
    }, 60);
    return () => clearTimeout(id);
  }, [autostart, site.id, startMs]);
  const resume = () => { setDebrief(false); set({ paused: false }); };
  const restart = () => {
    clearSave(); setSaved(null);
    world.current = { ...newWorld(env, startMs), paused: true };
    mission.current = newMission(env.field, startMs, lightAt);
    landerRef.current = null; landingRef.current = null; setLanding(null);
    setM(mission.current); setHud(world.current); setNav(null); setDebrief(false); setToast(null);
    setPhase('brief'); setBriefing(true);
  };
  const heightAtSite = (x: number, y: number) => heightAt(env.field, x, y);
  const here = localToLatLon(site, hud.rover.x, hud.rover.y);
  const battery = hud.power.chargeWh / RULES.power.batteryWh;
  const net = hud.power.dead ? hud.panelW : hud.panelW - hud.loadW;
  const temp = hud.thermal.tempC;
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
  const hold = (patch: Partial<{ throttle: number; steer: number; thrust: number }>) => {
    const release = () => Object.assign(touch.current, Object.fromEntries(Object.keys(patch).map((k) => [k, 0])));
    return {
      onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); Object.assign(touch.current, patch); },
      onPointerUp: release, onPointerLeave: release, onPointerCancel: release,
    };
  };

  return (
    <div className="game" data-phase={phase}>
      <div ref={host} className="game-canvas" aria-label={t('Rover on the real lunar terrain')} />
      {error && <div className="game-overlay" role="alert">{error}</div>}

      {phase === 'surface' && (<>
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
                <Icon name={m.done[id] !== undefined ? 'check' : id === next ? 'chevronRight' : 'dot'} size={13} className="obj-mark" /> {objectiveTitle(id)}
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
          <Minimap field={env.field} sunlitAt={layer === 'light' && lightAt ? lightAt : layer === 'earth' && earthAt ? earthAt : sunlitAt}
            bakeVersion={layer === 'now' ? bakeVersion : 0} tint={layer === 'earth' ? 'earth' : 'sun'} size={compact ? 110 : 156}
            rover={{ x: hud.rover.x, y: hud.rover.y, heading: hud.rover.heading }}
            waypoint={m.done.waypoint === undefined ? m.waypoint : null} nav={nav} lander={landingRef.current} />
          {illum && (
            <div className="map-layers" role="group" aria-label={t('Map layer')}>
              <button type="button" aria-pressed={layer === 'now'} onClick={() => setLayer('now')} title={t('Sunlight at the current simulated hour')}>{t('Now')}</button>
              <button type="button" aria-pressed={layer === 'light'} onClick={() => setLayer('light')} title={t('Share of {0} with the Sun above the real horizon', { 0: illum.meta.window })}><Icon name="sun" size={13} /> {illum.meta.window}</button>
              <button type="button" aria-pressed={layer === 'earth'} onClick={() => setLayer('earth')} title={t('Share of {0} with the Earth in view', { 0: illum.meta.window })}><Icon name="earth" size={13} /> {illum.meta.window}</button>
            </div>
          )}
          {illum && layer !== 'now' && (
            <div className="map-legend mono" aria-live="polite">
              <span className={`map-ramp ${layer}`} aria-hidden />
              <span>0%</span><span>{t('{0} of the year', { 0: layer === 'light' ? t('Sunlight') : t('Earth in view') })}</span><span>100%</span>
              <span className="map-here">{t('Here: {0}%', { 0: Math.round(100 * (illumAt(illum, layer, hud.rover.x, hud.rover.y) || 0)) })}</span>
            </div>
          )}
        </div>
      </div>

      {alert && (
        <div className="game-alert" role="alert">
          {t(alert === 'sunset'
            ? 'Sunset at the rover! Time slowed to 60×. Drive back into the light before the battery runs out.'
            : alert === 'cold' ? 'The electronics are getting cold! Time slowed to 60×. Below −40 °C the rover is lost: find sunlight.'
              : 'Battery below 25%! Time slowed to 60×. Find sunlight to recharge.')}
        </div>
      )}
      {toast && (
        <div className="game-toast" role="status">
          <strong><Icon name="checkCircle" /> {objectiveTitle(toast)}</strong>
          <span>{t(LESSONS[toast].lesson)}</span>
        </div>
      )}

      <div className="game-hud game-bottom">
        <div className="hud-card hud-gauges">
          <div className="gauge">
            <span className="hud-label">{t('Battery')}</span>
            <meter min={0} max={1} low={0.25} optimum={1} value={battery} aria-label={t('Battery')} />
            <span className="mono small">{(battery * 100).toFixed(0)}% · {net >= 0 ? '+' : ''}{net.toFixed(0)} W</span>
            <span className="mono small gauge-sub">{t('panel {0} W · load {1} W', { 0: hud.panelW.toFixed(0), 1: (hud.power.dead ? 0 : hud.loadW).toFixed(0) })}</span>
            {hud.power.dead && <span className="hud-warn small">{t('Dormant: recharging to 5% before waking')}</span>}
          </div>
          <div className={`gauge ${temp < RULES.thermal.heaterOnC || temp > RULES.thermal.hotC - 10 ? 'is-off' : 'is-on'}`}>
            <span className="hud-label"><Icon name="thermometer" size={13} /> {t('Electronics')}</span>
            <span className="mono small">{temp.toFixed(0)} °C</span>
            <span className="mono small gauge-sub">{hud.thermal.heaterOn && !hud.power.dead ? t('Heater on ({0} W)', { 0: RULES.power.heaterW }) : t('Heater off')}</span>
            {hud.overheated && <span className="hud-warn small">{t('Too hot: drives stopped to cool down')}</span>}
            {temp < RULES.thermal.freezeC + 15 && <span className="hud-warn small">{t('Freezes below {0} °C', { 0: RULES.thermal.freezeC })}</span>}
          </div>
          <div className={`gauge ${hud.sunFrac > 0.5 ? 'is-on' : 'is-off'}`}>
            <span className="hud-label"><Icon name="sun" size={13} /> {t('Sun')}</span>
            <span className="mono small">{hud.sunFrac > 0.01 ? t('{0}% of the disk visible', { 0: (hud.sunFrac * 100).toFixed(0) }) : t('In shadow')}</span>
            <span className="mono small gauge-sub">{sunMargin >= 0 ? '+' : ''}{sunMargin.toFixed(2)}° {t('vs real horizon')}</span>
          </div>
          <div className={`gauge ${hud.earthUp ? 'is-on' : 'is-off'}`}>
            <span className="hud-label"><Icon name="earth" size={13} /> {t('Earth link')}</span>
            <span className="mono small">{hud.earthUp ? t('Connected') : t('No line of sight')}</span>
            <span className="mono small gauge-sub">{t('{0} MB waiting · {1} MB sent', { 0: hud.power.dataMB.toFixed(1), 1: hud.power.sentMB.toFixed(1) })}</span>
            {!hud.earthUp && hud.power.dataMB > 0 && <span className="hud-note small gauge-sub">{t('Data waits until the Earth rises: press + to speed up time')}</span>}
          </div>
          <div className="gauge">
            <span className="hud-label">{t('Rover')}</span>
            <span className="mono small gauge-sub">{hud.rover.speed.toFixed(2)} m/s {t('real')}</span>
            <span className="mono small">≈ {(Math.abs(hud.rover.speed) * hud.warp * 3.6).toFixed(0)} km/h <span className="gauge-sub">{t('on screen')}</span></span>
            {hud.rover.blocked
              ? <span className="hud-warn small">{t(hud.rover.blocked === 'slope' ? 'Wheels spinning: too steep to climb'
                : hud.rover.blocked === 'sliding' ? 'Sliding: the slope is steeper than the wheels can hold'
                  : hud.rover.blocked === 'edge' ? 'Edge of the mapped area' : 'Rover tipped over')}</span>
              : hud.rover.slip && <span className="hud-note small">{t('Wheels at the traction limit')}</span>}
          </div>
          <div className="gauge gauge-actions">
            <button type="button" className="btn btn-sm hud-scan" onClick={doScan}><Icon name="scan" /> {t('Scan')} <span className="ctl-keys">(E)</span></button>
            <button type="button" className="btn btn-sm btn-ghost hud-navtoggle" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}><Icon name="pin" /> {t('Navigate')}</button>
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
              <span className="hud-arrow" style={{ transform: `rotate(${turn}deg)` }} aria-hidden><Icon name="navigation" size={14} /></span>
              {nr.dist < 15 ? t('Arrived') : t('{0} m · bearing {1}° · ETA {2} h at full speed', { 0: nr.dist.toFixed(0), 1: nr.bearing.toFixed(0), 2: (nr.dist / RULES.rover.maxSpeed / 3600).toFixed(1) })}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNav(null)} aria-label={t('Clear route')}><Icon name="close" /></button>
            </div>
          )}
        </form>

        <div className="hud-card hud-cams" role="group" aria-label={t('Camera')}>
          {(['chase', 'mast', 'top'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={camera === c} onClick={() => setCamera(c)}>{t(c === 'chase' ? 'Chase' : c === 'mast' ? 'Mast camera' : 'Top')}</button>
          ))}
        </div>
      </div>

      </>)}

      {(phase === 'descent' || phase === 'surface') && !briefing && !debrief && !landing && (
        keysOpen
          ? <KeyHints phase={phase} onClose={() => setKeysOpen(false)} />
          : <button type="button" className="key-hints-toggle ctl-keys" onClick={() => setKeysOpen(true)} aria-label={t('Show the keyboard controls')}><Icon name="keyboard" size={18} /></button>
      )}

      {phase === 'descent' && waiting && !landing && (
        <div className="descent-ready" role="dialog" aria-labelledby="ready-title">
          <p className="eyebrow">{t('Stage 2 · Descent')}</p>
          <h2 id="ready-title">{t('Ready to land at {0}', { 0: site.name })}</h2>
          <p>{t('You are {0} m above the landing spot and falling. Brake with the main engine and touch down gently.', { 0: Math.round(landerHud ? landerHud.z - heightAtSite(landerHud.x, landerHud.y) : 900) })}</p>
          <div className="ready-keys ctl-keys">
            <kbd className="keycap is-wide">{t('SPACE')}</kbd><span>{t('hold to brake')}</span>
            <kbd className="keycap">W</kbd><kbd className="keycap">A</kbd><kbd className="keycap">S</kbd><kbd className="keycap">D</kbd><span>{t('slide sideways')}</span>
          </div>
          <p className="ctl-touch small">{t('Hold THRUST to brake; the arrows slide sideways.')}</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => { waitingRef.current = false; setWaiting(false); focusView(); }}>
            <Icon name="play" size={14} /> {t('Start the descent')}
          </button>
          <p className="small muted ctl-keys">{t('or just press SPACE')}</p>
        </div>
      )}

      {phase === 'descent' && landerHud && (
        <DescentPanel field={env.field} lander={landerHud} target={TARGET} sunBelow={sunBelow(landerHud)} />
      )}

      {phase !== 'brief' && (
        <div className="game-touch">
          <button type="button" aria-label={t(phase === 'descent' ? 'Slide north' : 'Forward')} {...hold({ throttle: 1 })}><Icon name="chevronUp" size={22} /></button>
          <div>
            <button type="button" aria-label={t(phase === 'descent' ? 'Slide west' : 'Turn left')} {...hold({ steer: -1 })}><Icon name="chevronLeft" size={22} /></button>
            <button type="button" aria-label={t(phase === 'descent' ? 'Slide south' : 'Reverse')} {...hold({ throttle: -1 })}><Icon name="chevronDown" size={22} /></button>
            <button type="button" aria-label={t(phase === 'descent' ? 'Slide east' : 'Turn right')} {...hold({ steer: 1 })}><Icon name="chevronRight" size={22} /></button>
          </div>
          {phase === 'descent' && <button type="button" className="touch-thrust" {...hold({ thrust: 1 })}>{t('THRUST')}</button>}
        </div>
      )}

      {landing && phase === 'descent' && (
        <div className="game-overlay game-briefing" role="dialog" aria-modal="true" aria-labelledby="landing-title">
          <div className="brief-card">
            <p className="eyebrow">{t('Touchdown report')}</p>
            <h2 id="landing-title">{landing.ok ? t('Touchdown! Safe landing.') : t('Crash')}</h2>
            {!landing.ok && (
              <p>{t(landing.reason === 'speed' ? 'Too fast: you hit the ground at {0} m/s (limit {1}).' : landing.reason === 'drift' ? 'Sliding sideways at {0} m/s tipped the lander (limit {1}).' : 'The ground was too steep for the legs: {0}° (limit {1}°).',
                { 0: (landing.reason === 'speed' ? -landing.vz : landing.reason === 'drift' ? landing.vh : landing.slope).toFixed(1), 1: landing.reason === 'speed' ? RULES.lander.maxTouchVz : landing.reason === 'drift' ? RULES.lander.maxTouchVh : RULES.lander.maxSlopeDeg })}</p>
            )}
            <div className="brief-stats mono">
              <div><span className="hud-label">{t('Vertical speed')}</span><strong>{(-landing.vz).toFixed(1)} m/s</strong></div>
              <div><span className="hud-label">{t('Drift')}</span><strong>{landing.vh.toFixed(1)} m/s</strong></div>
              <div><span className="hud-label">{t('Slope')}</span><strong>{landing.slope.toFixed(1)}°</strong></div>
              <div><span className="hud-label">{t('From target')}</span><strong>{landing.dist.toFixed(0)} m</strong></div>
              <div><span className="hud-label">{t('Fuel left')}</span><strong>{landing.fuelPct.toFixed(0)}%</strong></div>
            </div>
            {landing.ok && (
              <p>{landing.lit ? t('You landed in sunlight: the rover starts charging right away.') : t('You landed in shadow: the rover must drive to the light before its battery runs out. Real missions avoid this by timing the landing.')}</p>
            )}
            <div className="hud-row">
              {landing.ok
                ? <button type="button" className="btn btn-primary" autoFocus onClick={() => { beginSurface(landingRef.current); setLanding(null); focusView(); }}>{t('Deploy the rover')}</button>
                : <button type="button" className="btn btn-primary" autoFocus onClick={startDescent}>{t('Try again')}</button>}
              {!landing.ok && <button type="button" className="btn btn-ghost" onClick={() => { setLanding(null); skipToSurface(); }}>{t('Skip to the surface')}</button>}
            </div>
          </div>
        </div>
      )}

      {briefing && (
        <div className="game-overlay game-briefing" role="dialog" aria-modal="true" aria-labelledby="brief-title">
          <div className="brief-card">
            <p className="eyebrow">{t('Mission briefing')}</p>
            <h2 id="brief-title">{t('You command a solar rover at {0}', { 0: site.name })}</h2>
            <p>{t('Near the lunar south pole the Sun never climbs high: it circles just above the horizon, so every ridge decides who gets light and who freezes. Your rover lives on sunlight and talks to Earth only when it can see it.')}</p>
            {phase === 'brief' && <p>{t('First, pilot the lander down onto the real terrain, or skip straight to the surface.')}</p>}
            <ul className="brief-facts">
              <li><strong>{t('Real:')}</strong> {t('NASA LOLA terrain, Sun and Earth positions for {0} (JPL SPICE), lunar gravity.', { 0: fmtUtc(startMs) })}</li>
              <li><strong>{t('Game:')}</strong> {t('Battery size, speed and objectives are game assumptions (see Game rules below the view).')}</li>
              <li><strong>{t('Goal:')}</strong> {t('Complete {0} objectives. Each one explains why landing sites are chosen where they are.', { 0: OBJECTIVES.length })}</li>
            </ul>
            <div className="brief-controls">
              {phase === 'brief' && <div className="ctl-keys"><span className="hud-label">{t('Landing')}</span><span>{t('SPACE engine · arrows / WASD slide sideways')}</span></div>}
              <div className="ctl-keys"><span className="hud-label">{t('Keyboard')}</span><span>{t('W/S or ↑/↓ drive · A/D or ←/→ steer · E scan · − + time warp · C camera · P pause · drag to look')}</span></div>
              <div className="ctl-touch"><span className="hud-label">{t('Touch')}</span><span>{t('Arrow pad to drive · Scan button · drag to look around')}</span></div>
            </div>
            {phase === 'surface' ? (
              <button type="button" className="btn btn-primary" onClick={start} autoFocus>{t('Continue')}</button>
            ) : (
              <div className="hud-row">
                {saved && <button type="button" className="btn btn-primary" onClick={continueSaved} autoFocus>{t('Continue saved mission ({0}/{1})', { 0: Object.keys(saved.mission.done).length, 1: OBJECTIVES.length })}</button>}
                <button type="button" className={`btn ${saved ? 'btn-ghost' : 'btn-primary'}`} onClick={startDescent} autoFocus={!saved}>{t('Land it yourself')}</button>
                <button type="button" className="btn btn-ghost" onClick={skipToSurface}>{t('Skip to the surface')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {debrief && (
        <div className="game-overlay game-briefing" role="dialog" aria-modal="true" aria-labelledby="debrief-title">
          <div className="brief-card">
            <p className="eyebrow">{t('Mission report')}</p>
            <h2 id="debrief-title">
              {allDone(m) ? t('Mission complete!') : hud.ended === 'frozen' ? t('Rover frozen') : t('End of ephemeris coverage')}
            </h2>
            {hud.ended === 'frozen' && <p>{t('With the battery empty the heater stopped and the electronics fell below −40 °C. Stay where the real horizon lets the Sun through.')}</p>}
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
