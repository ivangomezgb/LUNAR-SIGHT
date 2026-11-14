import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Explore from './pages/Explore';
import Compare from './pages/Compare';
import Replan from './pages/Replan';
import Validation from './pages/Validation';
import About from './pages/About';
import { useApp } from './state';
import { isoShort } from './components/format';
import { DATA_DIR } from './components/hooks';

function Nav() {
  const { siteId, landingUtc } = useApp();
  const exploreTo = siteId ? `/?site=${encodeURIComponent(siteId)}&t=${isoShort(landingUtc)}` : '/';
  const cls = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' is-active' : ''}`;
  return (
    <header className="topbar">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <NavLink to={exploreTo} className="brand" aria-label="Lunar Landing Site Navigator, home">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
          <path d="M2 24 L9 17 L13 20 L19 12 L30 22 L30 30 L2 30 Z" fill="var(--terrain-hi)" />
          <circle cx="23" cy="8" r="4" fill="var(--sun)" />
          <circle cx="8" cy="8" r="2.6" fill="var(--earth)" />
        </svg>
        <span className="brand-text">
          <span className="brand-name">Lunar Landing Site Navigator</span>
          <span className="brand-sub">South pole · Sun &amp; Earth visibility</span>
        </span>
      </NavLink>
      <nav aria-label="Main">
        <NavLink to={exploreTo} end className={({ isActive }) => cls({ isActive })}>
          Explore
        </NavLink>
        <NavLink to="/compare" className={cls}>
          Compare
        </NavLink>
        <NavLink to="/replan" className={cls}>
          Mission delayed
        </NavLink>
        <NavLink to="/validation" className={cls}>
          Validation
        </NavLink>
        <NavLink to="/about" className={cls}>
          About
        </NavLink>
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

export default function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollTop />
      <Nav />
      {DATA_DIR !== 'data' && (
        <div className="dev-banner" role="note">
          Development fixtures from <code>/{DATA_DIR}</code> — synthetic data, not real results.
        </div>
      )}
      <main id="main" className="main">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/replan" element={<Replan />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Explore />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <footer className="footer">
        <span>NASA Space Apps 2026 · LOLA (PGDA) · NAIF SPICE DE440 · JPL Horizons</span>
        <span className="mono">All times UTC</span>
      </footer>
    </HashRouter>
  );
}
