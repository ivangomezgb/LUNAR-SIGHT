import { t } from '../i18n';
import ExplainTip from './ExplainTip';
import type { Metrics, SiteData } from '../lib/types';
import { fmtHours, fmtNum, fmtUtc } from './format';

interface Card {
  key: string;
  label: string;
  value: string;
  unit: string;
  sub?: string;
  tone?: 'sun' | 'earth' | 'night' | 'warn';
}

function metricCards(m: Metrics): Card[] {
  return [
    {
      key: 'light',
      label: t("Sunlight"),
      value: fmtNum(m.lightPct, 0),
      unit: '%',
      sub: t("mean visible solar disk"),
      tone: 'sun',
    },
    { key: 'day', label: t("Longest day"), value: fmtNum(m.longestDayH, 0), unit: 'h', sub: t("{0} d continuous sun", { 0: fmtNum(m.longestDayH / 24, 1) }), tone: 'sun' },
    {
      key: 'night',
      label: t("Longest night"),
      value: fmtNum(m.longestNightH, 0),
      unit: 'h',
      sub: t("{0} d without sun", { 0: fmtNum(m.longestNightH / 24, 1) }),
      tone: m.longestNightH > 72 ? 'warn' : 'night',
    },
    { key: 'earth', label: t("Earth visible"), value: fmtNum(m.earthPct, 0), unit: '%', sub: t("of mission hours (DTE comms)"), tone: 'earth' },
    {
      key: 'sunset',
      label: t("To sunset"),
      value: m.hoursToSunset == null ? t("> data") : m.hoursToSunset === 0 ? t("dark") : fmtNum(m.hoursToSunset, 0),
      unit: m.hoursToSunset == null || m.hoursToSunset === 0 ? '' : 'h',
      sub: m.hoursToSunset === 0 ? t("Sun below horizon at landing") : t("from landing"),
      tone: m.hoursToSunset === 0 ? 'warn' : 'sun',
    },
    {
      key: 'earthset',
      label: t("To Earthset"),
      value: m.hoursToEarthset == null ? t("> data") : m.hoursToEarthset === 0 ? t("hidden") : fmtNum(m.hoursToEarthset, 0),
      unit: m.hoursToEarthset == null || m.hoursToEarthset === 0 ? '' : 'h',
      sub: m.hoursToEarthset === 0 ? t("Earth hidden at landing") : t("from landing"),
      tone: m.hoursToEarthset === 0 ? 'warn' : 'earth',
    },
    {
      key: 'nextEarth',
      label: t("Next Earth window"),
      value: m.nextEarthWindow ? (m.nextEarthWindow.durationH >= 72 ? (m.nextEarthWindow.durationH / 24).toFixed(1) : fmtHours(m.nextEarthWindow.durationH).replace(' h', '')) : '—',
      unit: m.nextEarthWindow ? (m.nextEarthWindow.durationH >= 72 ? t("d long") : t("h long")) : '',
      sub: m.nextEarthWindow ? t("starts {0}", { 0: fmtUtc(m.nextEarthWindow.startUtc, false) }) : t("none in data"),
      tone: 'earth',
    },
    {
      key: 'landingSun',
      label: t("Sun at landing"),
      value: (m.sunElAtLandingDeg >= 0 ? '+' : '−') + Math.abs(m.sunElAtLandingDeg).toFixed(1),
      unit: '°',
      sub: t("above real horizon"),
      tone: m.sunElAtLandingDeg < 0 ? 'warn' : 'sun',
    },
  ];
}

export default function MetricCards({ metrics, site }: { metrics: Metrics; site?: SiteData }) {
  return (
    <section className="metric-grid" aria-label={t("Mission metrics")}>
      {metricCards(metrics).map((c) => (
        <div key={c.key} className={`metric tone-${c.tone ?? 'none'}`}>
          <div className="metric-label">{t(c.label)}</div>
          <div className="metric-value">
            <span className="mv-num">{c.value}</span>
            {c.unit && <span className="mv-unit">{t(c.unit)}</span>}
          </div>
          {c.sub && <div className="metric-sub">{c.sub}</div>}
          {c.key === 'light' && site?.uncertainty && (
            <div className="uncertainty">
              <div>{t('Terrain uncertainty · {0}', { 0: site.uncertainty.window ?? t('reference window') })}</div>
              <span>{t("p5–p95:")} {site.uncertainty.illum_pct_p5.toFixed(1)}–{site.uncertainty.illum_pct_p95.toFixed(1)}%</span>
              <ExplainTip topic="uncertainty" />
              <svg viewBox="0 0 100 8" role="img" aria-label={t('Sunlight uncertainty band')}>
                <line x1={site.uncertainty.illum_pct_p5} x2={site.uncertainty.illum_pct_p95} y1="4" y2="4" stroke="var(--sun)" strokeWidth="4" />
                <circle cx={site.uncertainty.illum_pct_p50} cy="4" r="3" fill="var(--text)" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
