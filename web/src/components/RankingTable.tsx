import { t, reasonText } from '../i18n';
import type { Assumptions, RankedOption, SiteData, SiteIndexEntry } from '../lib/types';
import { getSeries, hourIndex } from '../lib/metrics';
import { computeLandingRisk, RISK_MASK_HEIGHT_M, type LandingLightRisk } from '../lib/landingRisk';
import '../styles/report.css'; // .risk-level styles shared with the landing-risk card
import { fmtNum, fmtUtc } from './format';
import { groupColor, shortName } from './format';

interface Props {
  options: RankedOption[];
  index: SiteIndexEntry[];
  onView: (o: RankedOption) => void;
  /** When given, each option shows the landing light risk (same rule as the Explore card). */
  sites?: Map<string, SiteData>;
  assumptions?: Assumptions;
}

function riskOf(o: RankedOption, sites?: Map<string, SiteData>, assumptions?: Assumptions): LandingLightRisk | null {
  const site = sites?.get(o.siteId);
  if (!site || !assumptions) return null;
  try {
    return computeLandingRisk(getSeries(site, { ...assumptions, heightM: RISK_MASK_HEIGHT_M }), hourIndex(site, o.landingUtc), site.ephem.step_h);
  } catch {
    return null;
  }
}

export default function RankingTable({ options, index, onView, sites, assumptions }: Props) {
  const name = (id: string) => shortName(index.find((s) => s.id === id)?.name ?? id);
  const group = (id: string) => index.find((s) => s.id === id)?.group ?? '';
  return (
    <ol className="ranking" aria-label={t("Top alternatives")}>
      {options.map((o, k) => {
        const risk = riskOf(o, sites, assumptions);
        return (
        <li key={`${o.siteId}-${o.landingUtc}`} className={`rank-row${k === 0 ? ' is-top' : ''}`}>
          <div className="rank-n mono" aria-hidden>
            {k + 1}
          </div>
          <div className="rank-main">
            <div className="rank-title">
              <i className="dot" style={{ background: groupColor(group(o.siteId)) }} aria-hidden />
              <span className="rank-site">{name(o.siteId)}</span>
              <span className="rank-time mono">{fmtUtc(o.landingUtc)}</span>
              {risk && <span className={`risk-level risk-${risk.level}`}>● {risk.level === 'high' ? t('High light risk') : risk.level === 'medium' ? t('Medium light risk') : t('Low light risk')}</span>}
            </div>
            <div className="score-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(o.score)} aria-label={t("Score")}>
              <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, o.score))}%` }} />
              <span className="score-num mono">{o.score.toFixed(1)}</span>
            </div>
            <ul className="reasons">
              {o.reasons.slice(0, 3).map((r) => (
                <li key={r.kind}>{reasonText(r)}</li>
              ))}
            </ul>
          </div>
          <div className="rank-metrics mono">
            <span>
              <b>{fmtNum(o.metrics.lightPct, 0)}</b>{t("% light")} </span>
            <span>
              <b>{fmtNum(o.metrics.earthPct, 0)}</b>{t("% Earth")} </span>
            <span>
              <b>{fmtNum(o.metrics.longestNightH, 0)}</b> {t("h night")} </span>
            <span>
              <b>{(o.metrics.sunElAtLandingDeg >= 0 ? '+' : '−') + Math.abs(o.metrics.sunElAtLandingDeg).toFixed(1)}</b>{t("° sun")} </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onView(o)}> {t("View in panorama →")} </button>
        </li>
        );
      })}
    </ol>
  );
}
