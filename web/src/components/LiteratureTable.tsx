import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { loadLiterature, type LiteratureData } from '../lib/data';
import '../styles/psr.css';

const pct = (v: number) => v.toFixed(1);
const signed = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);

/** Our Sun/Earth visibility vs the published LOLA long-term averages (Mazarico et al. 2011), same definition. */
export default function LiteratureTable() {
  const [data, setData] = useState<LiteratureData | null>(null), [error, setError] = useState('');
  useEffect(() => { loadLiterature().then(setData).catch(() => setError(t('Comparison data unavailable'))); }, []);
  if (error) return <section className="card"><p role="alert">{error}</p></section>;
  if (!data) return <section className="card"><p role="status">{t('Loading data…')}</p></section>;
  const sun1 = data.summary['sun_any_pct_full@1m'], earth1 = data.summary['earth_any_pct_full@1m'];
  const within = data.summary['sun_within_published_pixel_neighbourhood_1m'];
  return (
    <section className="card table-card">
      <h2 className="card-title">{t('Ours vs published LOLA illumination (Mazarico et al. 2011)')}</h2>
      <p className="small">
        {t('Same definition on both sides: % of hours with any part of the disc above the real horizon. Published: LOLA average-visibility maps over a lunar nutation cycle (~18.6 years). Ours: our horizon masks over 2026-11 to 2028-12.')}{' '}
        <a href={data.reference.source} target="_blank" rel="noreferrer">PGDA 69</a>
      </p>
      {typeof sun1 === 'object' && typeof earth1 === 'object' && (
        <div className="lit-summary">
          <div>{t('Earth visibility, 17 sites')}<b>r = {earth1.corr.toFixed(3)} · {t('median {0} pp', { 0: earth1.median_abs_diff_pp.toFixed(1) })}</b></div>
          <div>{t('Sunlight, 17 sites')}<b>r = {sun1.corr.toFixed(3)} · {t('median {0} pp', { 0: sun1.median_abs_diff_pp.toFixed(1) })}</b></div>
          {typeof within === 'string' && <div>{t('Sunlight inside the published ±1-pixel range')}<b>{within}</b></div>}
        </div>
      )}
      <div className="table-scroll">
        <table className="table lit-table">
          <thead>
            <tr>
              <th scope="col">{t('Site')}</th>
              <th scope="col">{t('Sun, published')}</th>
              <th scope="col">{t('Published ±1 pixel')}</th>
              <th scope="col">{t('Sun, ours 1 m')}</th>
              <th scope="col">{t('Sun, ours 2 m')}</th>
              <th scope="col">{t('Earth, published')}</th>
              <th scope="col">{t('Earth, ours 1 m')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const o1 = r.ours['1'], o2 = r.ours['2'];
              return (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td className="mono">{pct(r.published_sun_any_pct)} %</td>
                  <td className="mono">{pct(r.published_sun_neighbourhood.min_pct)}–{pct(r.published_sun_neighbourhood.max_pct)} %</td>
                  <td className={`mono ${r.ours_in_neighbourhood_1m ? 'lit-in' : 'lit-out'}`}>
                    {pct(o1.sun_any_pct_full)} % <span className="small">({signed(o1.sun_any_pct_full - r.published_sun_any_pct)})</span>
                    {' '}{r.ours_in_neighbourhood_1m ? '✓' : '↑'}
                  </td>
                  <td className="mono">{pct(o2.sun_any_pct_full)} %</td>
                  <td className="mono">{pct(r.published_earth_any_pct)} %</td>
                  <td className="mono">{pct(o1.earth_any_pct_full)} % <span className="small">({signed(o1.earth_any_pct_full - r.published_earth_any_pct)})</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        {t('✓ = within 1 pp of the published values in the ±1-pixel neighbourhood; ↑ = ours higher. Why ours is higher at some sites: our sites were moved to the best-lit point on 5 m terrain, while one published pixel (60–120 m) averages a peak with its slopes; we use 1–2 m observers and a 2-year window instead of ~18.6 years. Earth visibility, which is not affected by that site selection, agrees closely.')}
      </p>
    </section>
  );
}
