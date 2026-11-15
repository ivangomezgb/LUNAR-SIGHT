// The site as one journey: every tab knows its stop number and points to the next one.
import { Link, useLocation } from 'react-router-dom';
import { t } from '../i18n';
import Icon from '../components/Icon';
import { STOPS } from './stops';

const indexOf = (pathname: string) => STOPS.findIndex((s) => s.path === (pathname || '/'));

/** "Stop 04 of 09 · Compare" for the page header. */
export function StopBadge() {
  const { pathname } = useLocation();
  const i = indexOf(pathname);
  if (i < 0) return null;
  const here = STOPS[i];
  return (
    <p className="stop-badge">
      <span className="mono">{t('Stop {0} of {1}', { 0: String(i + 1).padStart(2, '0'), 1: String(STOPS.length).padStart(2, '0') })}</span>
      <Icon name={here.icon} size={14} /> {t(here.title)}
    </p>
  );
}

/** Big link to the next tab at the bottom of every page, with the route as dots. */
export function NextStop() {
  const { pathname } = useLocation();
  const i = indexOf(pathname);
  if (i < 0 || pathname === '/mission') return null;
  const next = STOPS[(i + 1) % STOPS.length];
  const last = i === STOPS.length - 1;
  return (
    <nav className="next-stop" aria-label={t('Next stop')}>
      <ol className="ns-route" aria-label={t('The route')}>
        {STOPS.map((s, k) => (
          <li key={s.path} className={k === i ? 'is-here' : k < i ? 'is-past' : ''}>
            <Link to={s.path} title={t(s.title)} aria-current={k === i ? 'page' : undefined}><Icon name={s.icon} size={14} /><span className="sr-only">{t(s.title)}</span></Link>
          </li>
        ))}
      </ol>
      <Link to={next.path} className="ns-link">
        <span className="ns-kicker mono">{last ? t('Back to the start') : t('Next stop')} · {String(((i + 1) % STOPS.length) + 1).padStart(2, '0')}</span>
        <span className="ns-title"><Icon name={next.icon} size={30} /> {t(next.title)}</span>
        <span className="ns-what">{t(next.what)}</span>
        <span className="ns-arrow" aria-hidden><Icon name="chevronRight" size={34} /></span>
      </Link>
    </nav>
  );
}
