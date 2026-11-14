import { t } from '../i18n';
import type { ValidationData } from '../lib/types';
import { fmtErr, fmtUtc } from './format';

export default function ValidationTable({ data }: { data: ValidationData }) {
  const thr = data.summary.threshold_deg;
  return (
    <div className="table-scroll">
      <table className="table table-dense">
        <caption className="sr-only">{t("Our ephemeris compared with JPL Horizons")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Site")}</th>
            <th scope="col">{t("Time (UTC)")}</th>
            <th scope="col">{t("Body")}</th>
            <th scope="col" className="num">{t("Az ours (°)")}</th>
            <th scope="col" className="num">{t("Az Horizons (°)")}</th>
            <th scope="col" className="num">{t("ΔAz (°)")}</th>
            <th scope="col" className="num">{t("El ours (°)")}</th>
            <th scope="col" className="num">{t("El Horizons (°)")}</th>
            <th scope="col" className="num">{t("ΔEl (°)")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, k) => {
            const bad = Math.abs(r.d_az) > thr || Math.abs(r.d_el) > thr;
            return (
              <tr key={k} className={bad ? 'is-bad' : ''}>
                <td>{r.site}</td>
                <td className="mono">{fmtUtc(r.t_utc)}</td>
                <td>
                  <span className={`body-tag body-${r.body}`}>{r.body === 'sun' ? t("Sun") : t("Earth")}</span>
                </td>
                <td className="mono num">{r.az_ours.toFixed(3)}</td>
                <td className="mono num">{r.az_horizons.toFixed(3)}</td>
                <td className={`mono num${Math.abs(r.d_az) > thr ? ' txt-bad' : ''}`}>{r.d_az === 0 ? '<1e-4' : fmtErr(r.d_az)}</td>
                <td className="mono num">{r.el_ours.toFixed(3)}</td>
                <td className="mono num">{r.el_horizons.toFixed(3)}</td>
                <td className={`mono num${Math.abs(r.d_el) > thr ? ' txt-bad' : ''}`}>{r.d_el === 0 ? '<1e-4' : fmtErr(r.d_el)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
