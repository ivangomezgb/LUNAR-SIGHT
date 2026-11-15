import { t } from './i18n';
import { HashRouter, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Explore from './pages/Explore';
import Compare from './pages/Compare';
import Replan from './pages/Replan';
import Validation from './pages/Validation';
import About from './pages/About';
import Team from './pages/Team';
import { useApp } from './state';
import { useShallow } from 'zustand/react/shallow';
import { isoShort } from './components/format';
import { DATA_DIR } from './components/hooks';

const View3D = lazy(() => import('./pages/View3D'));
const Report = lazy(() => import('./pages/Report'));
const FreePointExplorer = lazy(() => import('./components/FreePointPanel').then((m) => ({ default: m.FreePointExplorer })));

function Nav() {
  const { siteId, landingUtc, lang, setLang, assumptions } = useApp(useShallow((s) => ({ siteId: s.siteId, landingUtc: s.landingUtc, lang: s.lang, setLang: s.setLang, assumptions: s.assumptions })));
  const shared = `h=${assumptions.heightM}&lang=${lang}`;
  const to = (path: string) => `${path}?${shared}`;
  const exploreTo = siteId ? `/?site=${encodeURIComponent(siteId)}&t=${isoShort(landingUtc)}` : '/';
  const exploreLink = `${exploreTo}${exploreTo.includes('?') ? '&' : '?'}${shared}`;
  const cls = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' is-active' : ''}`;
  return (
    <header className="topbar">
      <a href="#main" className="skip-link"> {t("Skip to content")} </a>
      <NavLink to={exploreLink} className="brand" aria-label={t("Lunar Landing Site Navigator, home")}>
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
          <path d="M2 24 L9 17 L13 20 L19 12 L30 22 L30 30 L2 30 Z" fill="var(--terrain-hi)" />
          <circle cx="23" cy="8" r="4" fill="var(--sun)" />
          <circle cx="8" cy="8" r="2.6" fill="var(--earth)" />
        </svg>
        <span className="brand-text">
          <span className="brand-name">{t("Lunar Landing Site Navigator")}</span>
          <span className="brand-sub">{t("South pole · Sun & Earth visibility")}</span>
        </span>
      </NavLink>
      <nav aria-label={t("Main")}>
        <NavLink to={exploreLink} end className={({ isActive }) => cls({ isActive })}> {t("Explore")} </NavLink>
        <NavLink to={to('/compare')} className={cls}> {t("Compare")} </NavLink>
        <NavLink to={to('/replan')} className={cls}> {t("Mission delayed")} </NavLink>
        <NavLink to={to('/free')} className={cls}> {t('Any point')} </NavLink>
        <NavLink to={to('/validation')} className={cls}> {t("Validation")} </NavLink>
        <NavLink to={to('/about')} className={cls}> {t("About")} </NavLink>
        <NavLink to={to('/team')} className={cls}>Apolo404</NavLink>
        <NavLink to={`/3d?${shared}${siteId ? `&site=${encodeURIComponent(siteId)}&t=${isoShort(landingUtc)}` : ''}`} className={cls}> {t('3D')} </NavLink>
        <span className="lang-toggle" role="group" aria-label={t('Language')}>
          <button type="button" className="chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          <span aria-hidden>|</span>
          <button type="button" className="chip" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>ES</button>
        </span>
      </nav>
    </header>
  );
}

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** URL changes restore preferences; control changes update the current route's query. */
function PreferencesUrl() {
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  const { lang, assumptions: { heightM }, setLang, setAssumptions } = useApp(useShallow((s) => ({ lang: s.lang, assumptions: s.assumptions, setLang: s.setLang, setAssumptions: s.setAssumptions })));
  const previous = useRef<string | null>(null);
  useEffect(() => {
    let nextLang = lang, nextHeight = heightM;
    if (previous.current !== search) {
      const urlLang = params.get('lang');
      const urlHeight = Number(params.get('h'));
      if (urlLang === 'en' || urlLang === 'es') nextLang = urlLang;
      if ([1, 2, 5, 10].includes(urlHeight)) nextHeight = urlHeight;
      previous.current = search;
      if (nextLang !== lang) setLang(nextLang);
      if (nextHeight !== heightM) setAssumptions({ heightM: nextHeight });
    }
    const next = new URLSearchParams(params);
    next.set('lang', nextLang);
    next.set('h', String(nextHeight));
    if (next.toString() !== params.toString()) {
      previous.current = `?${next}`;
      setParams(next, { replace: true });
    }
  }, [search, params, setParams, lang, heightM, setLang, setAssumptions]);
  return null;
}

/** A crash in one view must not follow the user to the next route. */
function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

export default function App() {
  const lang = useApp((state) => state.lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PreferencesUrl />
      <ScrollTop />
      <Nav />
      {DATA_DIR !== 'data' && (
        <div className="dev-banner" role="note"> {t("Development fixtures from")} <code>/{DATA_DIR}</code> {t("— synthetic data, not real results.")} </div>
      )}
      <main id="main" className="main">
        <RouteBoundary>
          <Suspense fallback={<div role="status">{t('Loading data…')}</div>}>
            <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/replan" element={<Replan />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/3d" element={<View3D />} />
          <Route path="/about" element={<About />} />
          <Route path="/team" element={<Team />} />
          <Route path="/report" element={<Report />} />
          <Route path="/free" element={<FreePointExplorer />} />
          <Route path="*" element={<Explore />} />
            </Routes>
          </Suspense>
        </RouteBoundary>
      </main>
      <footer className="footer">
        <span>{t("NASA Space Apps 2026 · LOLA (PGDA) · NAIF SPICE DE440 · JPL Horizons")}</span>
        <span className="mono">{t("All times UTC")}</span>
      </footer>
    </HashRouter>
  );
}
