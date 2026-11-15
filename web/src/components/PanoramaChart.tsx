import { t } from '../i18n';
import { useId, useMemo, useState } from 'react';
import { area, line, curveLinear } from 'd3';
import { useElementWidth } from './hooks';

export interface PathPoint {
  az: number; // deg
  el: number; // deg
  vis: boolean;
  tick?: string; // optional label for a day tick at this point
}

export interface BodyMarker {
  az: number;
  el: number;
  vis: boolean;
  label: string; // e.g. "Sun"
  detail?: string; // e.g. "+1.2° above horizon"
}

interface Props {
  maskCdeg: number[];
  stepDeg: number;
  sunPath?: PathPoint[];
  earthPath?: PathPoint[];
  sun?: BodyMarker | null;
  earth?: BodyMarker | null;
  height?: number;
  compact?: boolean;
  elMin?: number;
  elMax?: number;
  ariaLabel?: string;
  /** azimuth shown at the left edge (0 = N at edges, 180 = N in the centre) */
  azStart?: number;
}

const CARDINAL: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

interface Segment {
  vis: boolean;
  pts: [number, number][];
}

/** Split a path into runs of equal visibility, breaking (with edge interpolation) at the 0/360 wrap. */
function buildSegments(points: PathPoint[]): Segment[] {
  const segs: Segment[] = [];
  if (!points.length) return segs;
  let cur: Segment = { vis: points[0].vis, pts: [[points[0].az, points[0].el]] };
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1];
    const q = points[k];
    const d = q.az - p.az;
    if (Math.abs(d) > 180) {
      // crossing the wrap: unwrap q, interpolate at the edge
      const qa = d > 0 ? q.az - 360 : q.az + 360;
      const edge = d > 0 ? 0 : 360;
      const f = (edge - p.az) / (qa - p.az || 1);
      const eEl = p.el + f * (q.el - p.el);
      cur.pts.push([edge, eEl]);
      segs.push(cur);
      cur = { vis: p.vis, pts: [[360 - edge, eEl]] };
    }
    if (q.vis !== cur.vis) {
      cur.pts.push([q.az, q.el]);
      segs.push(cur);
      cur = { vis: q.vis, pts: [] };
    }
    cur.pts.push([q.az, q.el]);
  }
  if (cur.pts.length) segs.push(cur);
  return segs.filter((s) => s.pts.length > 1);
}

export default function PanoramaChart({
  maskCdeg,
  stepDeg,
  sunPath = [],
  earthPath = [],
  sun,
  earth,
  height = 360,
  compact = false,
  elMin = -5,
  elMax = 10,
  ariaLabel = t("Horizon panorama"),
  azStart = 180,
}: Props) {
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const width = Math.max(220, measured || 900);
  const m = compact
    ? { l: 34, r: 10, t: 14, b: 24 }
    : { l: 44, r: 16, t: 26, b: 34 };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  // x() takes an azimuth RELATIVE to azStart (0..360)
  const x = (r: number) => m.l + (r / 360) * pw;
  const rel = (az: number) => ((((az - azStart) % 360) + 360) % 360);
  const y = (el: number) => m.t + ((elMax - el) / (elMax - elMin)) * ph;
  // vertical exaggeration = (deg per px horizontally) / (deg per px vertically)
  const ve = 360 / pw / ((elMax - elMin) / ph);
  const [hover, setHover] = useState<number | null>(null);

  const horizonAtAz = (az: number) => {
    const n = maskCdeg.length;
    const xx = ((((az % 360) + 360) % 360) / stepDeg);
    const i = Math.floor(xx) % n;
    const j = (i + 1) % n;
    const f = xx - Math.floor(xx);
    return ((1 - f) * maskCdeg[i] + f * maskCdeg[j]) / 100;
  };

  const terrain = useMemo(() => {
    const nS = maskCdeg.length;
    const pts: [number, number][] = [];
    for (let k = 0; k <= nS; k++) {
      const r = k * stepDeg;
      pts.push([r, horizonAtAz(azStart + r)]);
    }
    const a = area<[number, number]>()
      .x((d) => x(d[0]))
      .y0(m.t + ph)
      .y1((d) => y(Math.max(elMin - 1, d[1])))
      .curve(curveLinear);
    const l = line<[number, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]));
    return { area: a(pts) ?? '', ridge: l(pts) ?? '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskCdeg, stepDeg, width, height, elMin, elMax, azStart]);

  const pathGen = line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(d[1]));

  const toRel = (pts: PathPoint[]) => pts.map((p) => ({ ...p, az: rel(p.az) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sunRel = useMemo(() => toRel(sunPath), [sunPath, azStart]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const earthRel = useMemo(() => toRel(earthPath), [earthPath, azStart]);
  const sunSegs = useMemo(() => buildSegments(sunRel), [sunRel]);
  const earthSegs = useMemo(() => buildSegments(earthRel), [earthRel]);

  const vLines: number[] = [];
  for (let a = 0; a <= 360; a += compact ? 45 : 30) vLines.push(a);
  const hLines: number[] = [];
  for (let e = Math.ceil(elMin); e <= elMax; e += 1) hLines.push(e);

  const clipId = `clip-${uid}`;

  function renderMarker(b: BodyMarker, kind: 'sun' | 'earth') {
    const off = b.el > elMax ? 'above' : b.el < elMin ? 'below' : null;
    const cx = x(rel(b.az));
    const cy = off === 'above' ? m.t + 10 : off === 'below' ? m.t + ph - 10 : y(b.el);
    const r = compact ? 6 : 10;
    const labelLeft = cx > m.l + pw - 140;
    const tx = labelLeft ? cx - r - 8 : cx + r + 8;
    return (
      <g className={`pano-marker pano-marker-${kind}${b.vis ? '' : ' is-hidden'}`} key={kind}>
        {off ? (
          <path
            d={off === 'above' ? `M${cx - 7},${cy + 4} L${cx},${cy - 6} L${cx + 7},${cy + 4} Z` : `M${cx - 7},${cy - 4} L${cx},${cy + 6} L${cx + 7},${cy - 4} Z`}
            className="pano-offscale"
          />
        ) : kind === 'sun' ? (
          <>
            {b.vis && <circle cx={cx} cy={cy} r={r * 2.6} fill={`url(#sunglow-${uid})`} />}
            <circle cx={cx} cy={cy} r={r} className="pano-sun-dot" />
          </>
        ) : (
          <>
            <circle cx={cx} cy={cy} r={r} className="pano-earth-dot" fill={b.vis ? `url(#earthgrad-${uid})` : undefined} />
            <path d={`M${cx - r},${cy} A${r},${r} 0 0 0 ${cx + r},${cy}`} className="pano-earth-shade" />
          </>
        )}
        {!compact && (
          <text x={tx} y={cy - 2} textAnchor={labelLeft ? 'end' : 'start'} className="pano-marker-label">
            <tspan>{t(b.label)}</tspan>
            {b.detail && (
              <tspan x={tx} dy="1.25em" className="pano-marker-detail">
                {b.detail}
              </tspan>
            )}
          </text>
        )}
      </g>
    );
  }

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const az = ((px - m.l) / pw) * 360;
    setHover(az >= 0 && az <= 360 ? az : null); // relative
  };

  return (
    <div ref={ref} className={`pano${compact ? ' pano-compact' : ''}`}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="pano-svg">
        <defs>
          <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky-top)" />
            <stop offset="1" stopColor="var(--sky-bottom)" />
          </linearGradient>
          <linearGradient id={`terrain-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--terrain-hi)" />
            <stop offset="1" stopColor="var(--terrain-lo)" />
          </linearGradient>
          <radialGradient id={`sunglow-${uid}`}>
            <stop offset="0" stopColor="#f5c542" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#f5c542" stopOpacity="0.15" />
            <stop offset="1" stopColor="#f5c542" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`earthgrad-${uid}`} cx="0.35" cy="0.35">
            <stop offset="0" stopColor="#9fd0ff" />
            <stop offset="0.6" stopColor="#3b8bea" />
            <stop offset="1" stopColor="#1d4f99" />
          </radialGradient>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={pw} height={ph} />
          </clipPath>
        </defs>

        <rect x={m.l} y={m.t} width={pw} height={ph} fill={`url(#sky-${uid})`} />

        {/* grid */}
        <g className="pano-grid">
          {hLines.map((e) => (
            <line key={`h${e}`} x1={m.l} x2={m.l + pw} y1={y(e)} y2={y(e)} className={e === 0 ? 'pano-zero' : e % 5 === 0 ? 'pano-major' : 'pano-minor'} />
          ))}
          {vLines.map((a) => (
            <line key={`v${a}`} x1={x(a)} x2={x(a)} y1={m.t} y2={m.t + ph} className={a % 90 === 0 ? 'pano-major' : 'pano-minor'} />
          ))}
        </g>

        <g clipPath={`url(#${clipId})`}>
          {/* paths behind terrain so hidden parts read as "behind the ridge" */}
          {sunSegs.map((s, k) => (
            <path key={`s${k}`} d={pathGen(s.pts) ?? ''} className={s.vis ? 'pano-sun-path' : 'pano-hidden-path'} />
          ))}
          {earthSegs.map((s, k) => (
            <path key={`e${k}`} d={pathGen(s.pts) ?? ''} className={s.vis ? 'pano-earth-path' : 'pano-hidden-path pano-hidden-earth'} />
          ))}
          <path d={terrain.area} fill={`url(#terrain-${uid})`} className="pano-terrain" />
          <path d={terrain.ridge} className="pano-ridge" />
          {/* re-draw hidden segments faintly over terrain so the full path is readable */}
          {sunSegs.filter((s) => !s.vis).map((s, k) => (
            <path key={`sh${k}`} d={pathGen(s.pts) ?? ''} className="pano-hidden-path pano-over" />
          ))}
          {earthSegs.filter((s) => !s.vis).map((s, k) => (
            <path key={`eh${k}`} d={pathGen(s.pts) ?? ''} className="pano-hidden-path pano-hidden-earth pano-over" />
          ))}
          {!compact &&
            sunRel
              .filter((p) => p.tick)
              .map((p, k) => (
                <g key={`t${k}`} className="pano-tick">
                  <circle cx={x(p.az)} cy={y(p.el)} r={2.5} />
                  <text x={x(p.az)} y={y(p.el) - 7} textAnchor="middle">
                    {p.tick}
                  </text>
                </g>
              ))}
        </g>

        {/* axes */}
        <g className="pano-axis">
          {vLines.filter((a) => pw >= 520 || (a + azStart) % 90 === 0).map((a) => (
            <text key={a} x={x(a)} y={m.t + ph + (compact ? 15 : 20)} textAnchor="middle" className={CARDINAL[(a + azStart) % 360] ? 'pano-cardinal' : ''}>
              {CARDINAL[(a + azStart) % 360] ?? `${(a + azStart) % 360}°`}
            </text>
          ))}
          {hLines
            .filter((e) => e % (compact ? 5 : 1) === 0 && (compact || e % 5 === 0 || ph > 260))
            .map((e) => (
              <text key={e} x={m.l - 6} y={y(e) + 4} textAnchor="end" className={e % 5 === 0 ? '' : 'pano-axis-minor'}>
                {e > 0 ? `+${e}°` : `${e}°`}
              </text>
            ))}
        </g>

        {earth && renderMarker(earth, 'earth')}
        {sun && renderMarker(sun, 'sun')}

        {!compact && (
          <text x={m.l + pw} y={m.t - 9} textAnchor="end" className="pano-ve">
            {pw >= 560 ? t("Vertical exaggeration ×{0} · elevation {1}° to +{2}°", { 0: ve.toFixed(1), 1: elMin, 2: elMax }) : t("Vertical exag. ×{0}", { 0: ve.toFixed(1) })}
          </text>
        )}
        {!compact && pw >= 560 && (
          <text x={m.l} y={m.t - 9} className="pano-ve"> {t("Azimuth from north, clockwise")} </text>
        )}

        {hover != null && (
          <g className="pano-hover" pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ph} />
            <text x={x(hover) + (x(hover) > m.l + pw - 150 ? -6 : 6)} y={m.t + 14} textAnchor={x(hover) > m.l + pw - 150 ? 'end' : 'start'}> {t("Az")} {((hover + azStart) % 360).toFixed(1)}{t("° · horizon")} {horizonAtAz(hover + azStart) >= 0 ? '+' : ''}
              {horizonAtAz(hover + azStart).toFixed(2)}°
            </text>
          </g>
        )}
        <rect
          x={m.l}
          y={m.t}
          width={pw}
          height={ph}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
    </div>
  );
}
