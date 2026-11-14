import { useApp } from '../state';
import { SUN_RADIUS_DEG } from '../lib/sunFraction';
import { DEFAULT_ASSUMPTIONS } from '../lib/metrics';

export default function AssumptionsPanel({ heights, editable = true }: { heights?: number[]; editable?: boolean }) {
  const { assumptions, setAssumptions } = useApp();
  const hs = heights && heights.length ? heights : [assumptions.heightM];
  const isDefault =
    assumptions.heightM === DEFAULT_ASSUMPTIONS.heightM &&
    assumptions.dayFraction === DEFAULT_ASSUMPTIONS.dayFraction &&
    assumptions.earthMarginDeg === DEFAULT_ASSUMPTIONS.earthMarginDeg;

  return (
    <details className="card assumptions" open>
      <summary>
        <span className="card-title">Assumptions</span>
        {!isDefault && <span className="badge badge-warn">modified</span>}
      </summary>
      <ul className="assume-list">
        <li>
          <span>Sun treated as a disk of radius</span> <b className="mono">{SUN_RADIUS_DEG}°</b>
        </li>
        <li>
          <label htmlFor="as-day">“Day” when visible solar disk ≥</label>
          {editable ? (
            <select
              id="as-day"
              className="select select-sm mono"
              value={assumptions.dayFraction}
              onChange={(e) => setAssumptions({ dayFraction: Number(e.target.value) })}
            >
              {[0.01, 0.25, 0.5, 0.75, 1].map((v) => (
                <option key={v} value={v}>
                  {v === 0.01 ? 'any' : `${v * 100}%`}
                </option>
              ))}
            </select>
          ) : (
            <b className="mono">{assumptions.dayFraction * 100}%</b>
          )}
        </li>
        <li>
          <label htmlFor="as-earth">Earth visible when centre is ≥</label>
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
          <span>above the real horizon</span>
        </li>
        <li>
          <label htmlFor="as-h">Observer / panel height</label>
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
        <li className="muted">Hourly ephemeris (SPICE DE440); horizon sampled every 0.5° of azimuth from LOLA DEMs.</li>
      </ul>
      {editable && !isDefault && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssumptions({ ...DEFAULT_ASSUMPTIONS })}>
          Reset to defaults
        </button>
      )}
    </details>
  );
}
