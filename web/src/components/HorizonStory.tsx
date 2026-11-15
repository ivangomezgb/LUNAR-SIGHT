import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { t } from '../i18n';
import { loadSite, loadSites } from '../lib/data';
import { getSeries, hourIndex } from '../lib/metrics';
import type { SiteData } from '../lib/types';
import { useApp } from '../state';
import { fmtUtc, shortName } from './format';
import { headerOffset, useScrollFx } from '../fx/useScrollFx';
import Icon from './Icon';

const W = 1000, H = 320, PAD = { l: 44, r: 12, t: 16, b: 34 };
const HOURS = 708; // one lunar day ≈ 29.5 Earth days
const SITE = 'connecting-ridge';

/**
 * One real lunar day at a real site, played by scrolling (or with the slider): the site's 2 m
 * horizon, the Sun's and the Earth's real paths and where they are each hour. Elevation is
 * stretched to make degrees visible; the axis shows the real values.
 */
export default function HorizonStory() {
  const section = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const [site, setSite] = useState<SiteData | null>(null);
  const [name, setName] = useState('');
  const { landingUtc, heightM } = useApp(useShallow((s) => ({ landingUtc: s.landingUtc, heightM: s.assumptions.heightM })));

  useEffect(() => {
    let alive = true;
    loadSites().then((index) => {
      const entry = index.find((s) => s.id === SITE) ?? index[0];
      if (!entry) return;
      setName(shortName(entry.name));
      return loadSite(entry.id).then((d) => { if (alive) setSite(d); });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const view = useMemo(() => {
    if (!site) return null;
    const series = getSeries(site, { heightM, dayFraction: 0.5, earthMarginDeg: 0.5 });
    const mask = (site.horizon.elev_cdeg[String(heightM)] ?? site.horizon.elev_cdeg['2']).map((v) => v / 100);
    const i0 = Math.max(0, Math.min(site.ephem.n - HOURS, hourIndex(site, new Date(landingUtc))));
    const idx = Array.from({ length: HOURS }, (_, k) => i0 + k);
    const els = [...mask, ...idx.map((i) => series.sunEl[i]), ...idx.map((i) => series.earthEl[i])];
    const lo = Math.floor(Math.min(...els) - 0.5), hi = Math.ceil(Math.max(...els) + 0.5);
    const x = (az: number) => PAD.l + (((az % 360) + 360) % 360) / 360 * (W - PAD.l - PAD.r);
    const y = (el: number) => H - PAD.b - ((el - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const path = (pts: Array<[number, number]>) => {
      let d = '', prev = -1;
      for (const [az, el] of pts) {
        const px = x(az), py = y(el);
        d += (prev < 0 || Math.abs(px - prev) > (W - PAD.l - PAD.r) / 2 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
        prev = px;
      }
      return d;
    };
    const ground = path(mask.map((e, k) => [k * site.horizon.az_step_deg, e])) + `L${x(359.99)},${H - PAD.b}L${PAD.l},${H - PAD.b}Z`;
    const ticks: number[] = [];
    for (let v = lo; v <= hi; v += (hi - lo > 8 ? 2 : 1)) ticks.push(v);
    return {
      series, i0, x, y, ticks, ground,
      sun: path(idx.map((i) => [series.sunAz[i], series.sunEl[i]])),
      earth: path(idx.map((i) => [series.earthAz[i], series.earthEl[i]])),
      t0: Date.parse(site.ephem.t0_utc), step: site.ephem.step_h,
    };
  }, [site, landingUtc, heightM]);

  // Draw hour k (0..HOURS-1) straight into the SVG: no React render per scroll tick.
  const draw = useRef<(k: number) => void>(() => {});
  draw.current = (k: number) => {
    if (!view || !svg.current) return;
    const i = view.i0 + Math.max(0, Math.min(HOURS - 1, Math.round(k)));
    const s = view.series;
    const sun = svg.current.querySelector<SVGCircleElement>('.hs-sun'), earth = svg.current.querySelector<SVGCircleElement>('.hs-earth');
    const glow = svg.current.querySelector<SVGCircleElement>('.hs-sunglow');
    for (const c of [sun, glow]) { c?.setAttribute('cx', view.x(s.sunAz[i]).toFixed(1)); c?.setAttribute('cy', view.y(s.sunEl[i]).toFixed(1)); }
    earth?.setAttribute('cx', view.x(s.earthAz[i]).toFixed(1)); earth?.setAttribute('cy', view.y(s.earthEl[i]).toFixed(1));
    const lit = s.sunFrac[i], up = s.earthVis[i] === 1;
    svg.current.classList.toggle('is-dark', lit < 0.5);
    if (readout.current) {
      const when = fmtUtc(view.t0 + i * view.step * 3600000);
      readout.current.querySelector('.hs-when')!.textContent = `${t('Day {0}', { 0: Math.floor((i - view.i0) / 24) + 1 })} · ${when}`;
      readout.current.querySelector('.hs-sunv')!.textContent = lit >= 0.999 ? t('Fully up') : lit > 0.001 ? t('{0}% of the disk visible', { 0: Math.round(lit * 100) }) : t('Behind the horizon');
      readout.current.querySelector('.hs-earthv')!.textContent = up ? t('In view') : t('Hidden');
      readout.current.querySelector('.hs-sunbox')!.className = `hs-sunbox ${lit >= 0.5 ? 'is-on' : 'is-off'}`;
      readout.current.querySelector('.hs-earthbox')!.className = `hs-earthbox ${up ? 'is-on' : 'is-off'}`;
    }
    if (slider.current && document.activeElement !== slider.current) slider.current.value = String(Math.round(k));
  };
  useEffect(() => { draw.current(0); }, [view]);

  useScrollFx(section, (gsap, ST) => {
    if (!view) return;
    const state = { k: 0 };
    const mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', () => {
      gsap.to(state, { k: HOURS - 1, ease: 'none', onUpdate: () => draw.current(state.k),
        scrollTrigger: { trigger: '.hs-stage', start: () => `top ${headerOffset()}px`, end: '+=180%', pin: true, scrub: 0.6, refreshPriority: 1 } });
    });
    mm.add('(max-width: 899px)', () => {
      gsap.to(state, { k: HOURS - 1, ease: 'none', onUpdate: () => draw.current(state.k),
        scrollTrigger: { trigger: '.hs-stage', start: 'top 70%', end: 'bottom 10%', scrub: 0.6 } });
    });
    // this pin is created after the page's own triggers (the data loads later): measure it first
    ST.sort();
    ST.refresh();
  }, [view]);

  return (
    <section ref={section} className="hs" aria-labelledby="hs-title">
      <div className="hs-stage">
        <div className="hs-copy">
          <p className="chapter-kicker"><span>01</span> {t('The problem')}</p>
          <h2 id="hs-title">{t('At the pole, the Sun circles the horizon')}</h2>
          <p>{t('Scroll to play one real lunar day at {0}: the line is its real horizon seen from {1} m, gold is the Sun, blue is the Earth. A ridge a few metres high can hide the Sun for days.', { 0: name || '…', 1: heightM })}</p>
          <div ref={readout} className="hs-readout mono" aria-live="off">
            <span className="hs-when">—</span>
            <span className="hs-sunbox"><Icon name="sun" size={14} /> <span className="hs-sunv">—</span></span>
            <span className="hs-earthbox"><Icon name="earth" size={14} /> <span className="hs-earthv">—</span></span>
          </div>
          <label className="hs-scrub">
            <span className="sr-only">{t('Hour of the lunar day')}</span>
            <input ref={slider} type="range" min={0} max={HOURS - 1} defaultValue={0} onInput={(e) => draw.current(Number((e.target as HTMLInputElement).value))} />
          </label>
        </div>
        <figure className="hs-figure">
          {view ? (
            <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Real horizon of {0} with the Sun and Earth paths over one lunar day', { 0: name })}>
              <defs>
                <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1a33" /><stop offset="1" stopColor="#05070c" /></linearGradient>
                <radialGradient id="hs-glow"><stop offset="0" stopColor="#fff4d6" /><stop offset=".35" stopColor="#f5c542" stopOpacity=".7" /><stop offset="1" stopColor="#f5c542" stopOpacity="0" /></radialGradient>
              </defs>
              <rect className="hs-sky" x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="url(#hs-sky)" />
              {view.ticks.map((v) => (
                <g key={v} className="hs-tick"><line x1={PAD.l} x2={W - PAD.r} y1={view.y(v)} y2={view.y(v)} /><text x={PAD.l - 6} y={view.y(v) + 4}>{v}°</text></g>
              ))}
              {['N', 'E', 'S', 'W'].map((c, k) => <text key={c} className="hs-az" x={view.x(k * 90) + 4} y={H - 12}>{t(c)}</text>)}
              <path className="hs-earthpath" d={view.earth} />
              <path className="hs-sunpath" d={view.sun} />
              <path className="hs-ground" d={view.ground} />
              <circle className="hs-earth" r={6} cx={-20} cy={-20} />
              <circle className="hs-sunglow" r={26} cx={-99} cy={-99} fill="url(#hs-glow)" />
              <circle className="hs-sun" r={7} cx={-20} cy={-20} />
            </svg>
          ) : <div className="hs-loading" role="status">{t('Loading the site’s horizon and ephemeris…')}</div>}
          <figcaption className="small muted">{t('Real data: LOLA horizon and JPL DE440 positions. Elevation is stretched to make degrees visible; markers are not to scale.')}</figcaption>
        </figure>
      </div>
    </section>
  );
}
