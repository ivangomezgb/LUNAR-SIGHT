import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { loadSite, loadSites } from '../lib/data';
import { dataUrl } from '../components/hooks';

/**
 * First-visit intro: while the real data loads (site index, the first site's horizon and
 * ephemerides, the basemap), the site's real 2 m horizon is drawn as a line of grazing light.
 * The counter follows actual loading steps. Shown once per browser session; skipped under
 * prefers-reduced-motion. Never blocks for more than MAX_MS.
 */
const MAX_MS = 7000;
const KEY = 'lln.preloaded';

function shouldShow(): boolean {
  try { if (sessionStorage.getItem(KEY)) return false; } catch { /* storage blocked: show once per load */ }
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function horizonPath(maskCdeg: number[], w = 720, h = 120): { line: string; fill: string } {
  const el = maskCdeg.map((v) => v / 100);
  const lo = Math.min(...el), hi = Math.max(...el), span = Math.max(0.5, hi - lo);
  const pts = el.map((e, i) => `${((i / (el.length - 1)) * w).toFixed(1)},${(h - 12 - ((e - lo) / span) * (h - 30)).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  return { line, fill: `${line}L${w},${h}L0,${h}Z` };
}

export default function Preloader() {
  const [show] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(!show);
  const [target, setTarget] = useState(4);
  const [shown, setShown] = useState(0);
  const [steps, setSteps] = useState<Array<{ at: number; label: string }>>([{ at: 0, label: t('Reading the site index…') }]);
  const [site, setSite] = useState<{ name: string; mask: number[] } | null>(null);

  useEffect(() => {
    if (!show) return;
    let alive = true;
    const bump = (v: number, label: string) => { if (alive) { setTarget((x) => Math.max(x, v)); setSteps((l) => (l.some((x) => x.label === label) ? l : [...l, { at: v - 1, label }])); } };
    const fonts = document.fonts?.ready.then(() => bump(15, t('Typesetting…'))) ?? Promise.resolve();
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const work = loadSites().then(async (index) => {
      bump(30, t('{0} candidate sites indexed', { 0: index.length }));
      const id = index.some((s) => s.id === params.get('site')) ? params.get('site')! : index[0]?.id;
      const entry = index.find((s) => s.id === id);
      const img = new Promise<void>((res) => { const i = new Image(); i.onload = i.onerror = () => res(); i.src = dataUrl('basemap.png'); });
      if (!id) return;
      const s = await loadSite(id);
      if (alive) setSite({ name: entry?.name ?? id, mask: s.horizon.elev_cdeg['2'] ?? Object.values(s.horizon.elev_cdeg)[0] });
      bump(80, t('Horizon of {0}: 720 azimuths · {1} hours of Sun and Earth', { 0: entry?.name ?? id, 1: s.ephem.n.toLocaleString('en-US') }));
      await img;
      bump(100, t('Lunar south pole ready'));
    });
    const timeout = new Promise<void>((res) => setTimeout(res, MAX_MS));
    Promise.race([Promise.all([fonts, work]), timeout]).catch(() => {}).finally(() => bump(100, t('Lunar south pole ready')));
    return () => { alive = false; };
  }, [show]);

  // Smoothly chase the target so the counter never jumps; leave once it reaches 100.
  useEffect(() => {
    if (!show || gone) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // frame-rate independent ease toward the real progress, at least 40 %/s
      setShown((v) => Math.min(target, v + (target - v) * (1 - Math.exp(-dt * 5)) + dt * 40));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show, gone, target]);

  useEffect(() => {
    if (!show || leaving || shown < 99.5) return;
    const a = setTimeout(() => setLeaving(true), 450);
    return () => clearTimeout(a);
  }, [show, shown, leaving]);
  useEffect(() => {
    if (!leaving) return;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    document.documentElement.classList.add('pre-done');
    const b = setTimeout(() => setGone(true), 950);
    return () => clearTimeout(b);
  }, [leaving]);

  const paths = useMemo(() => (site ? horizonPath(site.mask) : null), [site]);
  useEffect(() => {
    if (gone) document.documentElement.classList.add('pre-done');
    else document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = ''; };
  }, [gone]);

  if (gone) return null;
  const pct = Math.round(shown);
  const step = [...steps].sort((a, b) => a.at - b.at).filter((x) => x.at <= shown).pop()?.label ?? '';
  return (
    <div className={`preloader${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" aria-label={t('Loading real lunar data, {0}%', { 0: pct })}>
      <div className="pre-top">
        <span>{t('Lunar Landing Site Navigator')}</span>
        <span>NASA Space Apps · 2026</span>
      </div>
      <div className="pre-mid">
        <p className="pre-title">{t('Where the Sun')}<br /><span className="display-accent">{t('never sets high.')}</span></p>
        <svg className="pre-horizon" viewBox="0 0 720 120" preserveAspectRatio="none" aria-hidden>
          {paths && <path className="fill" d={paths.fill} style={{ opacity: shown / 100 }} />}
          <path
            d={paths?.line ?? 'M0,96L720,96'}
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: 1 - shown / 100 }}
          />
        </svg>
        <span className="pre-step mono">{site ? t('Real 2 m horizon of {0}', { 0: site.name }) : ' '}</span>
      </div>
      <div className="pre-bottom">
        <span className="pre-step">{step}</span>
        <span className="pre-count">{String(pct).padStart(3, '0')}</span>
      </div>
    </div>
  );
}
