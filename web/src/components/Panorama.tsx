import { t } from '../i18n';
import { maskFor } from './series';
import ExplainTip from './ExplainTip';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteData } from '../lib/types';
import { useApp } from '../state';
import PanoramaChart, { type BodyMarker, type PathPoint } from './PanoramaChart';
import { seriesFor, hoursToChange, lerpAngle, assumptionsFor } from './series';
import { hourIndex } from '../lib/metrics';
import { fmtHours, fmtUtc, HOUR_MS } from './format';

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
      label: sunVis ? t("Sun") : t("Sun (hidden)"),
      detail: t("{0}° vs horizon · {1}% disk", { 0: sgn(sunAboveHorizon), 1: Math.round(series.sunFrac[k] * 100) }),
    };
    earth = {
      az: lerpAngle(series.earthAz[k], series.earthAz[k + 1], f),
      el: eEl,
      vis: earthVis,
      label: earthVis ? t("Earth") : t("Earth (hidden)"),
      detail: t("{0}° vs horizon", { 0: sgn(eEl - hE) }),
    };
    sunState = hoursToChange((i) => series.sunFrac[i] >= df, pos, n);
    earthState = hoursToChange((i) => series.earthVis[i] > 0, pos, n);
  }

  const cursorTime = new Date(Date.parse(landingUtc) + Math.floor(cursorH) * HOUR_MS);
  const sunText = !inRange
    ? t("Outside data coverage")
    : sunState.on
      ? sunState.hours == null ? t("No sunset in data") : t("Sunset in {0}", { 0: fmtHours(sunState.hours) })
      : sunState.hours == null ? t("No sunrise in data") : t("Sunrise in {0}", { 0: fmtHours(sunState.hours) });
  const earthText = !inRange
    ? ''
    : earthState.on
      ? earthState.hours == null ? t("No Earthset in data") : t("Earthset in {0}", { 0: fmtHours(earthState.hours) })
      : earthState.hours == null ? t("No Earthrise in data") : t("Earthrise in {0}", { 0: fmtHours(earthState.hours) });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (!playing && cursorH >= totalH) setCursorH(0);
      setPlaying(!playing);
    }
  };

  return (
    <section className="card pano-card" aria-label={t("Horizon panorama")} onKeyDown={onKey}>
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
        ariaLabel={t("Horizon panorama for {0}. {1}. {2}.", { 0: site.id, 1: sunText, 2: earthText })}
      />

      <div className="pano-legend">
        <ExplainTip topic="vertical" />
        <span aria-hidden><i className="lg-sun" /> {t("Sun path (visible)")}</span>
        <span aria-hidden><i className="lg-earth" /> {t("Earth path (visible, dashed)")}</span>
        <span aria-hidden><i className="lg-hidden" /> {t("Below terrain")}</span>
        <span><i className="lg-terrain" /> {t("Terrain horizon at")} {assumptionsFor(site, assumptions).heightM} m <ExplainTip topic="horizon" /></span>
        <span className="centre-toggle" role="group" aria-label={t("Panorama centre")}> {t("Centre on")} {(['N', 'S'] as const).map((c) => (
            <button key={c} type="button" className={`chip${centre === c ? ' is-on' : ''}`} aria-pressed={centre === c} onClick={() => setCentre(c)}>
              {c === 'N' ? t("North (Earth side)") : t("South")}
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
          aria-label={playing ? t("Pause animation") : t("Play animation")}
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
            aria-label={t("Time after landing")}
            aria-valuetext={t("T+{0} hours, {1}", { 0: Math.round(cursorH), 1: fmtUtc(cursorTime) })}
            className="time-slider"
            style={{ ['--pct' as string]: `${(cursorH / totalH) * 100}%` }}
          />
          <div className="slider-ends mono">
            <span>{t("Landing")}</span>
            <span>+{missionDays} d</span>
          </div>
        </div>
        <div className="time-readout mono">
          <div className="tr-main">T+{Math.floor(cursorH)} h</div>
          <div className="tr-sub">{fmtUtc(cursorTime)}</div>
        </div>
        <label className="speed">
          <span className="sr-only">{t("Playback speed")}</span>
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
