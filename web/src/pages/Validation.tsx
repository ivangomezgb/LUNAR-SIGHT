import { useValidation } from '../components/hooks';
import { Loading } from '../components/Status';
import ValidationTable from '../components/ValidationTable';
import CaseStudy from '../components/CaseStudy';
import { fmtUtc } from '../components/format';
import { SUN_RADIUS_DEG } from '../lib/sunFraction';
import { DEFAULT_ASSUMPTIONS } from '../lib/metrics';

function Assumptions() {
  return (
    <section className="card">
      <h2 className="card-title">Assumptions</h2>
      <ul className="bullets">
        <li>
          The Sun is a disk of angular radius <b className="mono">{SUN_RADIUS_DEG}°</b>; we compute the fraction of the disk above the real terrain
          horizon.
        </li>
        <li>
          An hour counts as <b>day</b> when at least <b className="mono">{DEFAULT_ASSUMPTIONS.dayFraction * 100}%</b> of the solar disk is visible.
        </li>
        <li>
          <b>Earth is visible</b> when its centre is at least <b className="mono">{DEFAULT_ASSUMPTIONS.earthMarginDeg}°</b> above the real horizon.
        </li>
        <li>
          Observer / solar panel height <b className="mono">{DEFAULT_ASSUMPTIONS.heightM} m</b> above the ground.
        </li>
        <li>Hourly ephemeris; values between hours are not resolved. Azimuth from local north, clockwise.</li>
        <li>These thresholds are our engineering choices, not NASA requirements — they can be changed in Explore.</li>
      </ul>
    </section>
  );
}

export default function Validation() {
  const v = useValidation();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Validation</h1>
          <p className="muted">Sun and Earth positions from our SPICE pipeline, checked against independent JPL Horizons queries.</p>
        </div>
      </header>

      {v.loading && <Loading label="Loading validation…" />}
      {!v.loading && v.data == null && (
        <section className="card pending">
          <span className="badge badge-pending">Pending</span>
          <h2 className="card-title">Validation results not published yet</h2>
          <p className="muted">
            The pipeline step <code>pipeline/lln/validate.py</code> writes <code>validation.json</code> once the comparison against JPL Horizons has run.
          </p>
          {v.error && <p className="mono small muted">{v.error.message}</p>}
        </section>
      )}
      {v.data && (
        <>
          <section className="card validation-summary">
            <div className={`verdict ${v.data.summary.pass ? 'is-pass' : 'is-fail'}`}>
              <span className="verdict-badge">{v.data.summary.pass ? 'PASS' : 'FAIL'}</span>
              <span className="muted small">threshold {v.data.summary.threshold_deg}°</span>
            </div>
            <div className="vs-stat">
              <div className="ss-label">Max |ΔAz|</div>
              <div className="vs-num mono">
                {v.data.summary.max_abs_d_az_deg.toFixed(4)}
                <span className="unit">°</span>
              </div>
            </div>
            <div className="vs-stat">
              <div className="ss-label">Max |ΔEl|</div>
              <div className="vs-num mono">
                {v.data.summary.max_abs_d_el_deg.toFixed(4)}
                <span className="unit">°</span>
              </div>
            </div>
            <div className="vs-stat">
              <div className="ss-label">Comparisons</div>
              <div className="vs-num mono">{v.data.summary.n}</div>
            </div>
            <p className="muted small vs-method">
              {v.data.method} · generated {fmtUtc(v.data.generated_utc)}
            </p>
          </section>
          <section className="card table-card">
            <h2 className="card-title">Ours vs JPL Horizons</h2>
            <ValidationTable data={v.data} />
          </section>
          {v.data.im2 ? (
            <CaseStudy im2={v.data.im2} />
          ) : (
            <section className="card pending">
              <span className="badge badge-pending">Pending</span> IM-2 case study not available.
            </section>
          )}
        </>
      )}
      <Assumptions />
    </div>
  );
}
