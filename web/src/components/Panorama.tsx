import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteData } from '../lib/types';
import { useApp } from '../state';
import PanoramaChart, { type BodyMarker, type PathPoint } from './PanoramaChart';
import { seriesFor, hoursToChange, lerpAngle, assumptionsFor } from './series';
import { hourIndex } from '../lib/metrics';
import { fmtHours, fmtUtc, HOUR_MS } from './format';

export function maskFor(site: SiteData, heightM: number): number[] {
  const e = site.horizon.elev_cdeg;
  return e[String(heightM)] ?? e['2'] ?? Object.values(e)[0] ?? new Array(720).fill(0);
}

const SPEEDS = [6, 24, 72];

export default function Panorama({ site }: { site: SiteData }) {
  const { landingUtc, missionDays, cursorH, setCursorH, playing, setPlaying, assumptions } = useApp();
  const series = useMemo(() => seriesFor(site, assumptions), [site, assumptions]);
  const n = site.ephem.n;
  const totalH = missionDays * 24;
  const i0 = hourIndex(site, landingUtc);
  const mask = maskFor(site, assumptionsFor(site, assumptions).heightM);
  const df = assumptions.dayFraction;
  const [speed, setSpeed] = useState(24);
  const [centre, setCentre] = useState<'N' | 'S'>('N');

  // playback
  const last = useRef<number | null>(null);
  const cursorRef = useRef(cursorH);
  cursorRef.current = cursorH;
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (t: number) => {
      if (last.current != null) {
        const next = cursorRef.current + ((t - last.current) / 1000) * speed;
        if (next >= totalH) {
          setCursorH(totalH);
          setPlaying(false);
          return;
        }
        setCursorH(next);
      }
      last.current = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, totalH, setCursorH, setPlaying]);

  const { sunPath, earthPath } = useMemo(() => {
    const sp: PathPoint[] = [];
    const ep: PathPoint[] = [];
    const a = Math.max(0, i0);
    const b = Math.min(n - 1, i0 + totalH);
    const tickEvery = totalH > 24 * 20 ? 48 : 24;
    for (let i = a; i <= b; i++) {
      const rel = i - i0;
      sp.push({
        az: series.sunAz[i],
        el: series.sunEl[i],
        vis: series.sunFrac[i] >= df,
        tick: rel > 0 && rel % tickEvery === 0 ? `D${rel / 24}` : undefined,
      });
      ep.push({ az: series.earthAz[i], el: series.earthEl[i], vis: series.earthVis[i] > 0 });
    }
    return { sunPath: sp, earthPath: ep };
  }, [series, i0, n, totalH, df]);

  const pos = i0 + cursorH;
  const inRange = pos >= 0 && pos < n - 1;
  const k = Math.floor(pos);
  const f = pos - k;
  let sun: BodyMarker | null = null;
  let earth: BodyMarker | null = null;
  let sunState = { on: false, hours: null as number | null };
  let earthState = { on: false, hours: null as number | null };
  let sunAboveHorizon = 0;
  if (inRange) {
    const sEl = series.sunEl[k] * (1 - f) + series.sunEl[k + 1] * f;
    const eEl = series.earthEl[k] * (1 - f) + series.earthEl[k + 1] * f;
    const hS = series.horizonSunEl[k] * (1 - f) + series.horizonSunEl[k + 1] * f;
    const hE = series.horizonEarthEl[k] * (1 - f) + series.horizonEarthEl[k + 1] * f;
    sunAboveHorizon = sEl - hS;
    const sunVis = series.sunFrac[k] >= df;
    const earthVis = series.earthVis[k] > 0;
    const sgn = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
    sun = {
      az: lerpAngle(series.sunAz[k], series.sunAz[k + 1], f),
      el: sEl,
      vis: sunVis,
      label: sunVis ? 'Sun' : 'Sun (hidden)',
      detail: `${sgn(sunAboveHorizon)}° vs horizon · ${Math.round(series.sunFrac[k] * 100)}% disk`,
    };
    earth = {
      az: lerpAngle(series.earthAz[k], series.earthAz[k + 1], f),
      el: eEl,
      vis: earthVis,
      label: earthVis ? 'Earth' : 'Earth (hidden)',
      detail: `${sgn(eEl - hE)}° vs horizon`,
    };
    sunState = hoursToChange((i) => series.sunFrac[i] >= df, pos, n);
    earthState = hoursToChange((i) => series.earthVis[i] > 0, pos, n);
  }

  const cursorTime = new Date(Date.parse(landingUtc) + Math.floor(cursorH) * HOUR_MS);
  const sunText = !inRange
    ? 'Outside data coverage'
    : sunState.on
      ? sunState.hours == null ? 'No sunset in data' : `Sunset in ${fmtHours(sunState.hours)}`
      : sunState.hours == null ? 'No sunrise in data' : `Sunrise in ${fmtHours(sunState.hours)}`;
  const earthText = !inRange
    ? ''
    : earthState.on
      ? earthState.hours == null ? 'No Earthset in data' : `Earthset in ${fmtHours(earthState.hours)}`
      : earthState.hours == null ? 'No Earthrise in data' : `Earthrise in ${fmtHours(earthState.hours)}`;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (!playing && cursorH >= totalH) setCursorH(0);
      setPlaying(!playing);
    }
  };

  return (
    <section className="card pano-card" aria-label="Horizon panorama" onKeyDown={onKey}>
      <div className="headline" aria-live="polite">
        <span className={`hl-sun${sunState.on ? '' : ' is-off'}`}>
          <span className="hl-icon sun" aria-hidden />
          {sunText}
        </span>
        {earthText && <span className="hl-sep" aria-hidden>·</span>}
        {earthText && (
          <span className={`hl-earth${earthState.on ? '' : ' is-off'}`}>
            <span className="hl-icon earth" aria-hidden />
            {earthText}
          </span>
        )}
      </div>

      <PanoramaChart
        maskCdeg={mask}
        stepDeg={site.horizon.az_step_deg}
        sunPath={sunPath}
        earthPath={earthPath}
        sun={sun}
        earth={earth}
        height={380}
        azStart={centre === 'N' ? 180 : 0}
        ariaLabel={`Horizon panorama for ${site.id}. ${sunText}. ${earthText}.`}
      />

      <div className="pano-legend">
        <span aria-hidden><i className="lg-sun" /> Sun path (visible)</span>
        <span aria-hidden><i className="lg-earth" /> Earth path (visible, dashed)</span>
        <span aria-hidden><i className="lg-hidden" /> Below terrain</span>
        <span aria-hidden><i className="lg-terrain" /> Terrain horizon at {assumptions.heightM} m</span>
        <span className="centre-toggle" role="group" aria-label="Panorama centre">
          Centre on
          {(['N', 'S'] as const).map((c) => (
            <button key={c} type="button" className={`chip${centre === c ? ' is-on' : ''}`} aria-pressed={centre === c} onClick={() => setCentre(c)}>
              {c === 'N' ? 'North (Earth side)' : 'South'}
            </button>
          ))}
        </span>
      </div>

      <div className="time-controls">
        <button
          type="button"
          className="btn btn-play"
          onClick={() => {
            if (!playing && cursorH >= totalH) setCursorH(0);
            setPlaying(!playing);
          }}
          aria-label={playing ? 'Pause animation' : 'Play animation'}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 2 L14 8 L4 14 Z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="slider-wrap">
          <input
            type="range"
            min={0}
            max={totalH}
            step={1}
            value={Math.round(cursorH)}
            onChange={(e) => {
              setPlaying(false);
              setCursorH(Number(e.target.value));
            }}
            aria-label="Time after landing"
            aria-valuetext={`T+${Math.round(cursorH)} hours, ${fmtUtc(cursorTime)}`}
            className="time-slider"
            style={{ ['--pct' as string]: `${(cursorH / totalH) * 100}%` }}
          />
          <div className="slider-ends mono">
            <span>Landing</span>
            <span>+{missionDays} d</span>
          </div>
        </div>
        <div className="time-readout mono">
          <div className="tr-main">T+{Math.floor(cursorH)} h</div>
          <div className="tr-sub">{fmtUtc(cursorTime)}</div>
        </div>
        <label className="speed">
          <span className="sr-only">Playback speed</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="select">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} h/s
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
