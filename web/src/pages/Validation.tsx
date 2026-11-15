import { t, sourceText } from '../i18n';
import { useValidation } from '../components/hooks';
import { Loading } from '../components/Status';
import ValidationTable from '../components/ValidationTable';
import CaseStudy from '../components/CaseStudy';
import LiteratureTable from '../components/LiteratureTable';
import { fmtErr, fmtUtc } from '../components/format';
import { SUN_RADIUS_DEG } from '../lib/sunFraction';
import { DEFAULT_ASSUMPTIONS } from '../lib/metrics';

function Assumptions() {
  return (
    <section className="card">
      <h2 className="card-title">{t("Assumptions")}</h2>
      <ul className="bullets">
        <li> {t("The Sun is a disk of angular radius")} <b className="mono">{SUN_RADIUS_DEG}°</b>{t("; we compute the fraction of the disk above the real terrain horizon.")} </li>
        <li> {t("An hour counts as")} <b>{t("day")}</b> {t("when at least")} <b className="mono">{DEFAULT_ASSUMPTIONS.dayFraction * 100}%</b> {t("of the solar disk is visible.")} </li>
        <li>
          <b>{t("Earth is visible")}</b> {t("when its centre is at least")} <b className="mono">{DEFAULT_ASSUMPTIONS.earthMarginDeg}°</b> {t("above the real horizon.")} </li>
        <li> {t("Observer / solar panel height")} <b className="mono">{DEFAULT_ASSUMPTIONS.heightM} m</b> {t("above the ground.")} </li>
        <li>{t("Hourly ephemeris; values between hours are not resolved. Azimuth from local north, clockwise.")}</li>
        <li>{t("These thresholds are our engineering choices, not NASA requirements — they can be changed in Explore.")}</li>
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
          <h1>{t("Validation")}</h1>
          <p className="muted">{t("Sun and Earth positions from our SPICE pipeline, checked against independent JPL Horizons queries.")}</p>
        </div>
      </header>

      {v.loading && <Loading label={t("Loading validation…")} />}
      {!v.loading && v.data == null && (
        <section className="card pending">
          <span className="badge badge-pending">{t("Pending")}</span>
          <h2 className="card-title">{t("Validation results not published yet")}</h2>
          <p className="muted"> {t("The pipeline step")} <code>pipeline/lln/validate.py</code> {t("writes")} <code>validation.json</code> {t("once the comparison against JPL Horizons has run.")} </p>
          {v.error && <p className="mono small muted">{sourceText(v.error.message)}</p>}
        </section>
      )}
      {v.data && (
        <>
          <section className="card validation-summary">
            <div className={`verdict ${v.data.summary.pass ? 'is-pass' : 'is-fail'}`}>
              <span className="verdict-badge">{v.data.summary.pass ? t("PASS") : t("FAIL")}</span>
              <span className="muted small">{t("threshold")} {v.data.summary.threshold_deg}°</span>
            </div>
            <div className="vs-stat">
              <div className="ss-label">{t("Max |ΔAz|")}</div>
              <div className="vs-num mono">
                {fmtErr(v.data.summary.max_abs_d_az_deg)}
                <span className="unit">°</span>
              </div>
            </div>
            <div className="vs-stat">
              <div className="ss-label">{t("Max |ΔEl|")}</div>
              <div className="vs-num mono">
                {fmtErr(v.data.summary.max_abs_d_el_deg)}
                <span className="unit">°</span>
              </div>
            </div>
            <div className="vs-stat">
              <div className="ss-label">{t("Comparisons")}</div>
              <div className="vs-num mono">{v.data.summary.n}</div>
            </div>
            <p className="muted small vs-method">
              {sourceText(v.data.method)} {t("· generated")} {fmtUtc(v.data.generated_utc)}
            </p>
          </section>
          <section className="card table-card">
            <h2 className="card-title">{t("Ours vs JPL Horizons")}</h2>
            <ValidationTable data={v.data} />
          </section>
          <LiteratureTable />
          {v.data.im2 ? (
            <CaseStudy im2={v.data.im2} />
          ) : (
            <section className="card pending">
              <span className="badge badge-pending">{t("Pending")}</span> {t("IM-2 case study not available.")} </section>
          )}
        </>
      )}
      <Assumptions />
    </div>
  );
}
