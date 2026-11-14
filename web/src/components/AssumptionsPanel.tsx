import { t } from '../i18n';
import ExplainTip from './ExplainTip';
import { useApp } from '../state';
import { useShallow } from 'zustand/react/shallow';
import { SUN_RADIUS_DEG } from '../lib/sunFraction';
import { DEFAULT_ASSUMPTIONS } from '../lib/metrics';

export default function AssumptionsPanel({ heights, editable = true }: { heights?: number[]; editable?: boolean }) {
  const { assumptions, setAssumptions } = useApp(useShallow((s) => ({ assumptions: s.assumptions, setAssumptions: s.setAssumptions })));
  const hs = heights && heights.length ? heights : [1, 2, 5, 10];
  const isDefault =
    assumptions.heightM === DEFAULT_ASSUMPTIONS.heightM &&
    assumptions.dayFraction === DEFAULT_ASSUMPTIONS.dayFraction &&
    assumptions.earthMarginDeg === DEFAULT_ASSUMPTIONS.earthMarginDeg;

  return (
    <details className="card assumptions" open>
      <summary>
        <span className="card-title">{t("Assumptions")}</span>
        {!isDefault && <span className="badge badge-warn">{t("modified")}</span>}
      </summary>
      <ul className="assume-list">
        <li>
          <ExplainTip topic="solar" /><span>{t("Sun treated as a disk of radius")}</span> <b className="mono">{SUN_RADIUS_DEG}°</b>
        </li>
        <li>
          <label htmlFor="as-day">{t("“Day” when visible solar disk ≥")}</label>
          {editable ? (
            <select
              id="as-day"
              className="select select-sm mono"
              value={assumptions.dayFraction}
              onChange={(e) => setAssumptions({ dayFraction: Number(e.target.value) })}
            >
              {[0.01, 0.25, 0.5, 0.75, 1].map((v) => (
                <option key={v} value={v}>
                  {v === 0.01 ? t("any") : `${v * 100}%`}
                </option>
              ))}
            </select>
          ) : (
            <b className="mono">{assumptions.dayFraction * 100}%</b>
          )}
        </li>
        <li>
          <ExplainTip topic="earth" /><label htmlFor="as-earth">{t("Earth visible when centre is ≥")}</label>
          {editable ? (
            <select
              id="as-earth"
              className="select select-sm mono"
              value={assumptions.earthMarginDeg}
              onChange={(e) => setAssumptions({ earthMarginDeg: Number(e.target.value) })}
            >
              {[0, 0.5, 1, 2].map((v) => (
                <option key={v} value={v}>
                  {v}°
                </option>
              ))}
            </select>
          ) : (
            <b className="mono">{assumptions.earthMarginDeg}°</b>
          )}
          <span>{t("above the real horizon")}</span>
        </li>
        <li>
          <label htmlFor="as-h">{t("Observer / panel height")}</label>
          {editable && hs.length > 1 ? (
            <select id="as-h" className="select select-sm mono" value={assumptions.heightM} onChange={(e) => setAssumptions({ heightM: Number(e.target.value) })}>
              {hs.map((h) => (
                <option key={h} value={h}>
                  {h} m
                </option>
              ))}
            </select>
          ) : (
            <b className="mono">{assumptions.heightM} m</b>
          )}
        </li>
        <li className="muted">{t("Hourly ephemeris (SPICE DE440); horizon sampled every 0.5° of azimuth from LOLA DEMs.")}</li>
      </ul>
      {editable && !isDefault && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssumptions({ ...DEFAULT_ASSUMPTIONS })}> {t("Reset to defaults")} </button>
      )}
    </details>
  );
}
