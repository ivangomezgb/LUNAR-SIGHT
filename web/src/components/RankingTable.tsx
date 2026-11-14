import type { RankedOption, SiteIndexEntry } from '../lib/types';
import { fmtNum, fmtUtc } from './format';
import { groupColor, shortName } from './SiteMap';

interface Props {
  options: RankedOption[];
  index: SiteIndexEntry[];
  onView: (o: RankedOption) => void;
}

export default function RankingTable({ options, index, onView }: Props) {
  const name = (id: string) => shortName(index.find((s) => s.id === id)?.name ?? id);
  const group = (id: string) => index.find((s) => s.id === id)?.group ?? '';
  return (
    <ol className="ranking" aria-label="Top alternatives">
      {options.map((o, k) => (
        <li key={`${o.siteId}-${o.landingUtc}`} className={`rank-row${k === 0 ? ' is-top' : ''}`}>
          <div className="rank-n mono" aria-hidden>
            {k + 1}
          </div>
          <div className="rank-main">
            <div className="rank-title">
              <i className="dot" style={{ background: groupColor(group(o.siteId)) }} aria-hidden />
              <span className="rank-site">{name(o.siteId)}</span>
              <span className="rank-time mono">{fmtUtc(o.landingUtc)}</span>
            </div>
            <div className="score-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(o.score)} aria-label="Score">
              <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, o.score))}%` }} />
              <span className="score-num mono">{o.score.toFixed(1)}</span>
            </div>
            <ul className="reasons">
              {o.reasons.slice(0, 3).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div className="rank-metrics mono">
            <span>
              <b>{fmtNum(o.metrics.lightPct, 0)}</b>% light
            </span>
            <span>
              <b>{fmtNum(o.metrics.earthPct, 0)}</b>% Earth
            </span>
            <span>
              <b>{fmtNum(o.metrics.longestNightH, 0)}</b> h night
            </span>
            <span>
              <b>{(o.metrics.sunElAtLandingDeg >= 0 ? '+' : '−') + Math.abs(o.metrics.sunElAtLandingDeg).toFixed(1)}</b>° sun
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onView(o)}>
            View in panorama →
          </button>
        </li>
      ))}
    </ol>
  );
}
