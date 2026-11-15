import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { fmtUtc } from '../../components/format';
import type { TerrainData } from '../../lib/terrain';
import { viewerError } from '../../lib/terrain';
import { MAX_DRIVE_WARP, WARPS } from '../sim/clock';
import type { Field } from '../sim/field';
import { fmtLatLon, type LatLon, latLonToLocal, localToLatLon, parseLatLon, route } from '../sim/geo';
import { RULES } from '../sim/rules';
import { type Env, newWorld, stepWorld, type World } from '../sim/world';
import { type CameraMode, SurfaceScene } from '../render/SurfaceScene';
import { netPowerW } from '../sim/power';

interface Props {
  env: Env;
  terrain: TerrainData;
  site: { id: string; name: string } & LatLon;
  startMs: number;
}

const KEYS = { up: ['w', 'arrowup'], down: ['s', 'arrowdown'], left: ['a', 'arrowleft'], right: ['d', 'arrowright'] };

export default function SurfaceGame({ env, terrain, site, startMs }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World>(newWorld(env, startMs));
  const sceneRef = useRef<SurfaceScene | null>(null);
  const keys = useRef(new Set<string>());
  const touch = useRef({ throttle: 0, steer: 0 });
  const target = useRef<{ x: number; y: number } | null>(null);
  const [hud, setHud] = useState<World>(world.current);
  const [error, setError] = useState('');
  const [camera, setCamera] = useState<CameraMode>('chase');
  const [navText, setNavText] = useState('');
  const [navMsg, setNavMsg] = useState('');
  const [nav, setNav] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const node = host.current!;
    let scene: SurfaceScene;
    try {
      const lowEnd = matchMedia('(max-width: 699px)').matches || navigator.hardwareConcurrency <= 4;
      scene = new SurfaceScene(node, env.field as Field, env.horizon, terrain, lowEnd);
    } catch (e) {
      setError(t(viewerError(e)));
      return;
    }
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __surface?: SurfaceScene }).__surface = scene;
    let frame = 0, last = performance.now(), lastHud = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const k = keys.current, any = (names: string[]) => names.some((n) => k.has(n));
      const input = {
        throttle: (any(KEYS.up) ? 1 : 0) - (any(KEYS.down) ? 1 : 0) + touch.current.throttle,
        steer: (any(KEYS.right) ? 1 : 0) - (any(KEYS.left) ? 1 : 0) + touch.current.steer,
      };
      world.current = stepWorld(env, world.current, input, dt);
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
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [env, terrain]);

  useEffect(() => { if (sceneRef.current) sceneRef.current.mode = camera; }, [camera]);
  useEffect(() => { sceneRef.current?.setBeacon(nav); target.current = nav; }, [nav]);

  const set = (patch: Partial<World>) => { world.current = { ...world.current, ...patch }; setHud(world.current); };
  const here = localToLatLon(site, hud.rover.x, hud.rover.y);
  const battery = hud.power.chargeWh / RULES.power.batteryWh;
  const net = netPowerW(hud.sunFrac, Math.abs(hud.rover.speed) > 1e-3);
  const sunMargin = hud.sky.sunEl - hud.sunHorizon;
  const nr = nav ? route(hud.rover.x, hud.rover.y, nav.x, nav.y) : null;
  const turn = nr ? ((nr.bearing - hud.rover.heading + 540) % 360) - 180 : 0;
  const drivable = hud.warp <= MAX_DRIVE_WARP;

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
  const hold = (patch: Partial<{ throttle: number; steer: number }>) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); Object.assign(touch.current, patch); },
    onPointerUp: () => Object.assign(touch.current, Object.fromEntries(Object.keys(patch).map((k) => [k, 0]))),
    onPointerLeave: () => Object.assign(touch.current, Object.fromEntries(Object.keys(patch).map((k) => [k, 0]))),
  });

  return (
    <div className="game">
      <div ref={host} className="game-canvas" aria-label={t('Rover on the real lunar terrain')} />
      {error && <div className="game-overlay" role="alert">{error}</div>}

      <div className="game-hud game-top">
        <div className="hud-card">
          <div className="hud-label">{site.name}</div>
          <div className="hud-big mono">{fmtUtc(hud.tMs)}</div>
          <div className="hud-warp" role="group" aria-label={t('Time warp')}>
            {WARPS.map((x) => (
              <button key={x} type="button" aria-pressed={hud.warp === x} onClick={() => set({ warp: x })}>{x}×</button>
            ))}
            <button type="button" aria-pressed={hud.paused} onClick={() => set({ paused: !hud.paused })}>{hud.paused ? t('Resume') : t('Pause')}</button>
          </div>
          {!drivable && <div className="hud-note">{t('Rover parked during fast time warp (> {0}×)', { 0: MAX_DRIVE_WARP })}</div>}
        </div>
        <div className="hud-card hud-right">
          <div className="hud-label">{t('Position')}</div>
          <div className="mono">{fmtLatLon(here)}</div>
          <div className="mono small">{t('Heading')} {hud.rover.heading.toFixed(0)}° · {(hud.rover.odometer / 1000).toFixed(2)} km</div>
        </div>
      </div>

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
            <span className="mono small">{sunMargin >= 0 ? '+' : ''}{sunMargin.toFixed(2)}° {t('vs real horizon')}</span>
          </div>
          <div className={`gauge ${hud.earthUp ? 'is-on' : 'is-off'}`}>
            <span className="hud-label">⊕ {t('Earth link')}</span>
            <span className="mono small">{hud.earthUp ? t('Connected') : t('No line of sight')}</span>
            <span className="mono small">{t('{0} MB sent', { 0: hud.power.sentMB.toFixed(1) })}</span>
          </div>
          <div className="gauge">
            <span className="hud-label">{t('Rover')}</span>
            <span className="mono small">{hud.rover.speed.toFixed(2)} m/s</span>
            {hud.rover.blocked && <span className="hud-warn small">{t(hud.rover.blocked === 'slope' ? 'Too steep to climb' : hud.rover.blocked === 'edge' ? 'Edge of the mapped area' : 'Rover tipped over')}</span>}
          </div>
        </div>

        <form className="hud-card hud-nav" onSubmit={(e) => { e.preventDefault(); goTo(parseLatLon(navText)); }}>
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNav(null)}>✕</button>
            </div>
          )}
        </form>

        <div className="hud-card hud-cams" role="group" aria-label={t('Camera')}>
          {(['chase', 'mast', 'top'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={camera === m} onClick={() => setCamera(m)}>{t(m === 'chase' ? 'Chase' : m === 'mast' ? 'Mast camera' : 'Top')}</button>
          ))}
        </div>
      </div>

      <div className="game-touch" aria-hidden>
        <button type="button" {...hold({ throttle: 1 })}>▲</button>
        <div>
          <button type="button" {...hold({ steer: -1 })}>◀</button>
          <button type="button" {...hold({ throttle: -1 })}>▼</button>
          <button type="button" {...hold({ steer: 1 })}>▶</button>
        </div>
      </div>

      {hud.ended && (
        <div className="game-overlay" role="alert">
          <h2>{t(hud.ended === 'battery' ? 'Battery depleted' : 'End of ephemeris coverage')}</h2>
          <p>{t(hud.ended === 'battery' ? 'The rover froze in the lunar night. Stay where the real horizon lets the Sun through.' : 'The published Sun and Earth positions end here.')}</p>
          <button type="button" className="btn btn-primary" onClick={() => { world.current = newWorld(env, startMs); setHud(world.current); setNav(null); }}>{t('Restart')}</button>
        </div>
      )}
      <p className="game-help small">{t('Drive: WASD / arrows · Camera: drag, wheel, C · Time warp: [ ] · Pause: P')}</p>
    </div>
  );
}
