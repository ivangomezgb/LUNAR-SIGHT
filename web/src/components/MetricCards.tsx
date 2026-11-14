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

export function metricCards(m: Metrics, site?: SiteData): Card[] {
  const u = site?.uncertainty;
  return [
    {
      key: 'light',
      label: 'Sunlight',
      value: fmtNum(m.lightPct, 0),
      unit: '%',
      sub: u ? `DEM spread ${u.illum_pct_p5.toFixed(0)}–${u.illum_pct_p95.toFixed(0)} %` : 'mean visible solar disk',
      tone: 'sun',
    },
    { key: 'day', label: 'Longest day', value: fmtNum(m.longestDayH, 0), unit: 'h', sub: `${fmtNum(m.longestDayH / 24, 1)} d continuous sun`, tone: 'sun' },
    {
      key: 'night',
      label: 'Longest night',
      value: fmtNum(m.longestNightH, 0),
      unit: 'h',
      sub: `${fmtNum(m.longestNightH / 24, 1)} d without sun`,
      tone: m.longestNightH > 72 ? 'warn' : 'night',
    },
    { key: 'earth', label: 'Earth visible', value: fmtNum(m.earthPct, 0), unit: '%', sub: 'of mission hours (DTE comms)', tone: 'earth' },
    {
      key: 'sunset',
      label: 'To sunset',
      value: m.hoursToSunset == null ? '> data' : m.hoursToSunset === 0 ? 'dark' : fmtNum(m.hoursToSunset, 0),
      unit: m.hoursToSunset == null || m.hoursToSunset === 0 ? '' : 'h',
      sub: m.hoursToSunset === 0 ? 'Sun below horizon at landing' : 'from landing',
      tone: m.hoursToSunset === 0 ? 'warn' : 'sun',
    },
    {
      key: 'earthset',
      label: 'To Earthset',
      value: m.hoursToEarthset == null ? '> data' : m.hoursToEarthset === 0 ? 'hidden' : fmtNum(m.hoursToEarthset, 0),
      unit: m.hoursToEarthset == null || m.hoursToEarthset === 0 ? '' : 'h',
      sub: m.hoursToEarthset === 0 ? 'Earth hidden at landing' : 'from landing',
      tone: m.hoursToEarthset === 0 ? 'warn' : 'earth',
    },
    {
      key: 'nextEarth',
      label: 'Next Earth window',
      value: m.nextEarthWindow ? (m.nextEarthWindow.durationH >= 72 ? (m.nextEarthWindow.durationH / 24).toFixed(1) : fmtHours(m.nextEarthWindow.durationH).replace(' h', '')) : '—',
      unit: m.nextEarthWindow ? (m.nextEarthWindow.durationH >= 72 ? 'd long' : 'h long') : '',
      sub: m.nextEarthWindow ? `starts ${fmtUtc(m.nextEarthWindow.startUtc, false)}` : 'none in data',
      tone: 'earth',
    },
    {
      key: 'landingSun',
      label: 'Sun at landing',
      value: (m.sunElAtLandingDeg >= 0 ? '+' : '−') + Math.abs(m.sunElAtLandingDeg).toFixed(1),
      unit: '°',
      sub: 'above real horizon',
      tone: m.sunElAtLandingDeg < 0 ? 'warn' : 'sun',
    },
  ];
}

export default function MetricCards({ metrics, site }: { metrics: Metrics; site?: SiteData }) {
  return (
    <section className="metric-grid" aria-label="Mission metrics">
      {metricCards(metrics, site).map((c) => (
        <div key={c.key} className={`metric tone-${c.tone ?? 'none'}`}>
          <div className="metric-label">{c.label}</div>
          <div className="metric-value">
            <span className="mv-num">{c.value}</span>
            {c.unit && <span className="mv-unit">{c.unit}</span>}
          </div>
          {c.sub && <div className="metric-sub">{c.sub}</div>}
        </div>
      ))}
    </section>
  );
}
