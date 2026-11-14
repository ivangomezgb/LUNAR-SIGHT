import type { ValidationData } from '../lib/types';
import { fmtErr, fmtUtc } from './format';

export default function ValidationTable({ data }: { data: ValidationData }) {
  const thr = data.summary.threshold_deg;
  return (
    <div className="table-scroll">
      <table className="table table-dense">
        <caption className="sr-only">Our ephemeris compared with JPL Horizons</caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Time (UTC)</th>
            <th scope="col">Body</th>
            <th scope="col" className="num">Az ours (°)</th>
            <th scope="col" className="num">Az Horizons (°)</th>
            <th scope="col" className="num">ΔAz (°)</th>
            <th scope="col" className="num">El ours (°)</th>
            <th scope="col" className="num">El Horizons (°)</th>
            <th scope="col" className="num">ΔEl (°)</th>
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
                  <span className={`body-tag body-${r.body}`}>{r.body === 'sun' ? 'Sun' : 'Earth'}</span>
                </td>
                <td className="mono num">{r.az_ours.toFixed(3)}</td>
                <td className="mono num">{r.az_horizons.toFixed(3)}</td>
                <td className={`mono num${Math.abs(r.d_az) > thr ? ' txt-bad' : ''}`}>{fmtErr(r.d_az)}</td>
                <td className="mono num">{r.el_ours.toFixed(3)}</td>
                <td className="mono num">{r.el_horizons.toFixed(3)}</td>
                <td className={`mono num${Math.abs(r.d_el) > thr ? ' txt-bad' : ''}`}>{fmtErr(r.d_el)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
