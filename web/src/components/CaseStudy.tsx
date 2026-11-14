import type { ValidationData } from '../lib/types';
import PanoramaChart from './PanoramaChart';
import { fmtUtc, fmtNum } from './format';

type Im2 = NonNullable<ValidationData['im2']>;

export default function CaseStudy({ im2 }: { im2: Im2 }) {
  const hasMask = !!im2.horizon_elev_cdeg && im2.horizon_elev_cdeg.length > 0;
  const vis = im2.sun_fraction != null ? im2.sun_fraction >= 0.5 : im2.sun_el_deg > (im2.horizon_el_at_sun_az_deg ?? 0);
  return (
    <section className="card case-study">
      <div className="card-head">
        <h2 className="card-title">Case study · IM-2 “Athena”</h2>
        <span className="muted small mono">{fmtUtc(im2.t_utc)}</span>
      </div>
      <p className="muted">
        Intuitive Machines’ IM-2 landed near Mons Mouton on 6 March 2025 and ended on its side in a cold, shadowed crater. Can our horizon + ephemeris
        engine reproduce how low the Sun was at landing?
      </p>
      <div className="case-grid">
        <dl className="kv">
          <div>
            <dt>Location</dt>
            <dd className="mono">
              {im2.lat_deg.toFixed(3)}°, {im2.lon_deg.toFixed(3)}°E
            </dd>
          </div>
          <div>
            <dt>Sun azimuth / elevation</dt>
            <dd className="mono">
              {fmtNum(im2.sun_az_deg, 2)}° / {im2.sun_el_deg >= 0 ? '+' : ''}
              {fmtNum(im2.sun_el_deg, 2)}°
            </dd>
          </div>
          <div>
            <dt>Terrain horizon at Sun azimuth</dt>
            <dd className="mono">{im2.horizon_el_at_sun_az_deg == null ? 'no DEM coverage' : `${im2.horizon_el_at_sun_az_deg >= 0 ? '+' : ''}${im2.horizon_el_at_sun_az_deg.toFixed(2)}°`}</dd>
          </div>
          <div>
            <dt>Visible solar disk</dt>
            <dd className="mono">{im2.sun_fraction == null ? '—' : `${Math.round(im2.sun_fraction * 100)} %`}</dd>
          </div>
          <div>
            <dt>Earth elevation</dt>
            <dd className="mono">
              {im2.earth_el_deg >= 0 ? '+' : ''}
              {fmtNum(im2.earth_el_deg, 2)}°
            </dd>
          </div>
        </dl>
        {hasMask && (
          <PanoramaChart
            maskCdeg={im2.horizon_elev_cdeg!}
            stepDeg={im2.horizon_az_step_deg ?? 0.5}
            height={260}
            sun={{ az: im2.sun_az_deg, el: im2.sun_el_deg, vis, label: 'Sun at landing', detail: `${im2.sun_el_deg.toFixed(2)}° elevation` }}
            ariaLabel="Horizon at the IM-2 landing site with the Sun position at landing"
          />
        )}
      </div>
      {im2.note && <p className="note">{im2.note}</p>}
    </section>
  );
}
