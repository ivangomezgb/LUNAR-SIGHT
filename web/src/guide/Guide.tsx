import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { t } from '../i18n';
import { useApp } from '../state';
import { STOPS, stopOf } from './stops';
import { nextStop, useGuide } from './useGuide';
import Icon from '../components/Icon';

/**
 * Explorer guide: a welcome card on the first visit, then a small dock that says what this tab is
 * for, one thing to try, how many tabs you have seen, and the next stop (also lit in the menu).
 */
export default function Guide() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { visited, mode, visit, setMode, reset } = useGuide();
  const [expandedHere, setExpandedHere] = useState(false);
  useEffect(() => setExpandedHere(false), [pathname]);
  const { lang, heightM } = useApp(useShallow((s) => ({ lang: s.lang, heightM: s.assumptions.heightM })));
  const here = stopOf(pathname);
  const next = nextStop(here?.path ?? '/', visited);
  const done = visited.length >= STOPS.length;
  const immersive = pathname === '/mission' || pathname === '/3d';

  useEffect(() => { if (here) visit(here.path); }, [here, visit]);

  // Light the suggested tab in the menu (and scroll it into view on phones).
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('header nav a.nav-link')];
    const pathOf = (a: HTMLAnchorElement) => (a.getAttribute('href') ?? '').replace(/^#/, '').split('?')[0] || '/';
    for (const a of links) {
      const p = pathOf(a);
      a.classList.toggle('nav-next', mode !== 'hidden' && !done && p === next.path);
      a.classList.toggle('nav-new', mode !== 'hidden' && !visited.includes(p) && STOPS.some((s) => s.path === p));
    }
    const lit = links.find((a) => a.classList.contains('nav-next'));
    if (lit && window.matchMedia('(max-width: 720px)').matches) lit.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [next, visited, mode, done, pathname]);

  const go = (path: string) => {
    navigate(`${path}?h=${heightM}&lang=${lang}`);
    if (mode === 'welcome') setMode('open');
  };

  if (mode === 'hidden') {
    return <button type="button" className="guide-pill guide-pill-min" onClick={() => setMode('pill')} aria-label={t('Show the explorer guide')}><Icon name="compass" size={18} /></button>;
  }

  if (mode === 'welcome') {
    return (
      <div className="guide-welcome" role="dialog" aria-modal="false" aria-labelledby="guide-welcome-title">
        <p className="eyebrow">{t('Welcome, explorer')}</p>
        <h2 id="guide-welcome-title">{t('Find a safe, sunny place to land on the Moon.')}</h2>
        <p>{t('At the lunar south pole the Sun only grazes the horizon: a few metres of terrain decide light, power and radio contact. This site lets you explore it with real NASA data.')}</p>
        <ol className="guide-route" aria-label={t('The route')}>
          {STOPS.map((s) => <li key={s.path} title={t(s.title)}><Icon name={s.icon} /><em>{t(s.title)}</em></li>)}
        </ol>
        <div className="hud-row">
          <button type="button" className="btn btn-primary" onClick={() => setMode('open')}>{t('Start the tour')} →</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode('pill')}>{t('I’ll explore on my own')}</button>
        </div>
      </div>
    );
  }

  if (mode === 'pill' || (immersive && mode === 'open' && !expandedHere)) {
    return (
      <button type="button" className="guide-pill" onClick={() => { setMode('open'); setExpandedHere(true); }} aria-label={t('Open the explorer guide')}>
        <Icon name="compass" /> {t('Guide')} <b>{visited.length}/{STOPS.length}</b>
        {!done && <span className="guide-pill-next">· {t('Next')}: <Icon name={next.icon} size={13} /> {t(next.title)}</span>}
      </button>
    );
  }

  return (
    <aside className="guide-dock" aria-label={t('Explorer guide')}>
      <div className="guide-head">
        <span className="hud-label">{t('Explorer guide')} · {t('{0} of {1} tabs', { 0: visited.length, 1: STOPS.length })}</span>
        <div className="guide-progress" aria-hidden>{STOPS.map((s) => <i key={s.path} className={visited.includes(s.path) ? 'is-on' : ''} />)}</div>
        <button type="button" className="guide-x" onClick={() => { setMode('pill'); setExpandedHere(false); }} aria-label={t('Minimise the guide')}><Icon name="minus" size={14} /></button>
      </div>
      {here ? (
        <div className="guide-here">
          <strong><Icon name={here.icon} /> {t(here.title)}</strong>
          <p>{t(here.what)}</p>
          <p className="guide-try"><b>{t('Try:')}</b> {t(here.tryIt)}</p>
          <p className="guide-why"><b>{t('Did you know?')}</b> {t(here.why.q)} {t(here.why.a)}</p>
        </div>
      ) : <div className="guide-here"><p>{t('This page is part of the route; use the menu or the next stop below.')}</p></div>}
      {done ? (
        <div className="guide-done">
          <p><Icon name="award" /> {t('You have visited every tab. Now plan your own mission!')}</p>
          <div className="hud-row">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => go('/mission')}><Icon name="rocket" /> {t('Play mission')}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>{t('Restart the tour')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-primary guide-next" onClick={() => go(next.path)}>
          <span>{t('Next stop')}</span> <Icon name={next.icon} /> {t(next.title)} <Icon name="chevronRight" />
        </button>
      )}
      <button type="button" className="guide-hide" onClick={() => setMode('hidden')}>{t('Hide the guide')}</button>
    </aside>
  );
}
