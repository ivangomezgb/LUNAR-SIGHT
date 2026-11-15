import { t } from '../i18n';
import { useId, useMemo } from 'react';
import { interpolateRgb } from 'd3';
import type { SiteData } from '../lib/types';
import { hourIndex } from '../lib/metrics';
import type { SeriesT } from './series';
import { useElementWidth } from './hooks';
import { fmtDay, HOUR_MS } from './format';

interface Props {
  site: SiteData;
  series: SeriesT;
  startMs: number; // band start (hour aligned)
  days?: number;
  landingUtc: string;
  missionH: number;
  dayFraction: number;
  cursorH?: number | null;
  onPick?: (ms: number) => void;
  onKeyStep?: (deltaH: number) => void;
  compact?: boolean;
  title?: string;
}

const sunColor = interpolateRgb('#111315', '#f4ce72');

export default function Timeline({
  site,
  series,
  startMs,
  days = 30,
  landingUtc,
  missionH,
  dayFraction,
  cursorH,
  onPick,
  onKeyStep,
  compact = false,
  title,
}: Props) {
  const patternId = useId().replace(/:/g, '');
  const nightId = `night-${patternId}`;
  const nodataId = `nodata-${patternId}`;
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const width = Math.max(220, measured || 800);
  const labelW = compact ? 56 : 74;
  const m = { l: labelW, r: 8, t: compact ? 4 : 18, b: 20 };
  const bandH = compact ? 16 : 24;
  const gap = 6;
  const height = m.t + bandH * 2 + gap + m.b;
  const hours = days * 24;
  const pw = width - m.l - m.r;
  const x = (h: number) => m.l + (h / hours) * pw;
  const i0 = hourIndex(site, new Date(startMs));
  const n = site.ephem.n;
  const landRel = (Date.parse(landingUtc) - startMs) / HOUR_MS;

  const { sunRects, earthRects } = useMemo(() => {
    const sr: { x: number; w: number; c: string }[] = [];
    const er: { x: number; w: number }[] = [];
    const cw = pw / hours;
    let runStart = -1;
    for (let h = 0; h < hours; h++) {
      const i = i0 + h;
      if (i < 0 || i >= n) {
        sr.push({ x: m.l + h * cw, w: cw + 0.6, c: `url(#${nodataId})` });
        continue;
      }
      sr.push({ x: m.l + h * cw, w: cw + 0.6, c: series.sunFrac[i] < dayFraction ? `url(#${nightId})` : sunColor(series.sunFrac[i]) });
      const v = series.earthVis[i] > 0;
      if (v && runStart < 0) runStart = h;
      if (!v && runStart >= 0) {
        er.push({ x: m.l + runStart * cw, w: (h - runStart) * cw });
        runStart = -1;
      }
    }
    if (runStart >= 0) er.push({ x: m.l + runStart * cw, w: (hours - runStart) * cw });
    return { sunRects: sr, earthRects: er };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, i0, n, hours, pw, dayFraction, nightId, nodataId]);

  // Daily ticks share an axis with both visibility bands.
  const labelEvery = pw / days < 28 ? 5 : pw / days < 50 ? 2 : 1;
  const ticks = Array.from({ length: days + 1 }, (_, d) => d);

  const yS = m.t;
  const yE = m.t + bandH + gap;

  const handleClick = (e: React.MouseEvent<SVGRectElement>) => {
    if (!onPick) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const h = Math.floor(((e.clientX - rect.left - m.l) / pw) * hours);
    if (h < 0 || h >= hours) return;
    onPick(startMs + h * HOUR_MS);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!onKeyStep) return;
    const step = e.shiftKey ? 24 : 6;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onKeyStep(step);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onKeyStep(-step);
    }
  };

  const winX0 = x(Math.max(0, landRel));
  const winX1 = x(Math.min(hours, landRel + missionH));

  return (
    <div ref={ref} className={`timeline${compact ? ' timeline-compact' : ''}`}>
      <div className="muted small">{t("Hatched = night · crosshatch = no data")}</div>
      {title && <div className="timeline-title">{title}</div>}
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={t("{0}-day timeline of sunlight and Earth visibility{1}", { 0: days, 1: onPick ? t('. Click to set time; arrow keys step 6 h, Shift+arrow 24 h.') : '' })}
        tabIndex={onKeyStep ? 0 : undefined}
        onKeyDown={onKey}
        className="timeline-svg"
      >
        <defs>
          <pattern id={nightId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#1a1d24" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#aab3c3" strokeWidth="1" />
          </pattern>
          <pattern id={nodataId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#111318" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#2a2e38" strokeWidth="2" />
            <line x1="0" y1="0" x2="6" y2="0" stroke="#2a2e38" strokeWidth="2" />
          </pattern>
        </defs>
        <text x={4} y={yS + bandH / 2 + 4} className="tl-label">
          {compact ? t("Sun") : t("Sunlight")}
        </text>
        <text x={4} y={yE + bandH / 2 + 4} className="tl-label"> {t("Earth")} </text>
        <g>
          {sunRects.map((r, k) => (
            <rect key={k} x={r.x} y={yS} width={r.w} height={bandH} fill={r.c} />
          ))}
        </g>
        <rect x={m.l} y={yE} width={pw} height={bandH} className="tl-earth-bg" />
        <g>
          {earthRects.map((r, k) => (
            <rect key={k} x={r.x} y={yE} width={r.w} height={bandH} className="tl-earth-on" />
          ))}
        </g>
        {/* dim outside mission window */}
        {winX1 > winX0 && (
          <>
            <rect x={m.l} y={yS - 2} width={Math.max(0, winX0 - m.l)} height={bandH * 2 + gap + 4} className="tl-dim" />
            <rect x={winX1} y={yS - 2} width={Math.max(0, m.l + pw - winX1)} height={bandH * 2 + gap + 4} className="tl-dim" />
            <rect x={winX0} y={yS - 2} width={winX1 - winX0} height={bandH * 2 + gap + 4} className="tl-window" />
          </>
        )}
        {/* axis */}
        <g className="tl-axis">
          {ticks.map((d) => (
            <g key={d}>
              <line x1={x(d * 24)} x2={x(d * 24)} y1={yE + bandH} y2={yE + bandH + (d % labelEvery === 0 ? 6 : 3)} />
              {d % labelEvery === 0 && d < days && (
                <text x={x(d * 24) + 2} y={yE + bandH + 16}>
                  {fmtDay(startMs + d * 24 * HOUR_MS)}
                </text>
              )}
            </g>
          ))}
        </g>
        {landRel >= 0 && landRel <= hours && (
          <g className="tl-landing">
            <line x1={x(landRel)} x2={x(landRel)} y1={yS - (compact ? 2 : 14)} y2={yE + bandH + 2} />
            {!compact && (
              <>
                <path d={`M${x(landRel)},${yS - 14} l9,4 l-9,4 Z`} />
                <text x={x(landRel) + 12} y={yS - 6}> {t("Landing")} </text>
              </>
            )}
          </g>
        )}
        {cursorH != null && landRel + cursorH >= 0 && landRel + cursorH <= hours && (
          <line className="tl-cursor" x1={x(landRel + cursorH)} x2={x(landRel + cursorH)} y1={yS - 2} y2={yE + bandH + 2} />
        )}
        {!compact && pw >= 560 && (
          <text x={m.l + pw} y={yS - 6} textAnchor="end" className="tl-hint"> {t("Mission window shaded · day = ≥")}{Math.round(dayFraction * 100)}{t("% solar disk")} </text>
        )}
        {onPick && (
          <rect x={m.l} y={yS} width={pw} height={bandH * 2 + gap} fill="transparent" style={{ cursor: 'crosshair' }} onClick={handleClick} />
        )}
      </svg>
    </div>
  );
}
