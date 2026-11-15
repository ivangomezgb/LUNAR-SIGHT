import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t, sourceText } from '../i18n';
import { useApp, DEFAULT_LANDING_UTC } from '../state';
import { useSite, useSites, useValidation } from '../components/hooks';
import { computeMetrics, DEFAULT_ASSUMPTIONS, getSeries, hourIndex, timeAtIndex } from '../lib/metrics';
import { SUN_RADIUS_DEG } from '../lib/sunFraction';
import LandingRisk from '../components/LandingRisk';
import PanoramaChart from '../components/PanoramaChart';
import Timeline from '../components/Timeline';
import ExplainTip from '../components/ExplainTip';
import '../styles/report.css';

export default function Report() {
  const [params] = useSearchParams();
  const lang = useApp(s => s.lang);
  const selectedSite = useApp(s => s.siteId);
  const [generatedUtc] = useState(() => new Date().toISOString());
  const index = useSites();
  const siteId = params.get('site') ?? selectedSite ?? index.data?.[0]?.id;
  const site = useSite(siteId);
  const validation = useValidation();
  const meta = index.data?.find(s => s.id === siteId);
  const rawUtc = params.get('t') ?? DEFAULT_LANDING_UTC;
  // Interpret an explicitly supplied timezone-free ISO timestamp as UTC.
  const utc = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(rawUtc) ? `${rawUtc}Z` : rawUtc;
  const days = Number(params.get('days') ?? 14);
  const heightM = Number(params.get('h') ?? 2);
  if (index.loading || site.loading || validation.loading) return <p role="status">{t('Loading mission brief…')}</p>;
  if (index.error || site.error || !site.data || !meta) return <p role="alert">{t('Mission brief unavailable: the selected site could not be loaded.')}</p>;
  const data = site.data;
  const i = hourIndex(data, utc);
  if (!Number.isFinite(i) || i < 0 || i >= data.ephem.n || !Number.isFinite(days) || days <= 0
    || !data.horizon.elev_cdeg[String(heightM)]) return <p role="alert">{t('Invalid report parameters. Choose a covered UTC time, positive mission days and an available observer height.')}</p>;
  const a = { ...DEFAULT_ASSUMPTIONS, heightM };
  const sampledUtc = timeAtIndex(data, i).toISOString();
  const metrics = computeMetrics(data, sampledUtc, days * 24, a);
  const series = getSeries(data, a);
  const mask = data.horizon.elev_cdeg[String(heightM)];
  const shareParams = new URLSearchParams({ site: data.id, t: new Date(utc).toISOString(), days: String(days), h: String(heightM), lang });
  const shareUrl = `${window.location.href.split('#')[0]}#/report?${shareParams}`;
  const v = validation.data;
  const u = data.uncertainty;
  const duration = (h: number | null) => h === null ? t('Beyond data coverage') : t('{0} h', { 0: h });
  return <article className="mission-report" lang={lang}>
    <div className="report-actions"><button type="button" onClick={() => window.print()}>{t('Download PDF')}</button>
      <span>{t('Choose Save as PDF in the print dialog. A4 portrait; disable browser headers and footers.')}</span></div>
    <section className="report-sheet">
      <header><p>{t('NASA Space Apps 2026 · Apolo404')}</p><h1>{t('Lunar landing mission brief')}</h1>
        <h2>{sourceText(meta.name)}</h2>
        <p>{t('Latitude {0}° · longitude {1}° east · elevation {2} m', { 0: meta.lat_deg, 1: meta.lon_deg, 2: meta.elev_m })}</p>
        <p>{t('Landing UTC: {0}', { 0: new Date(utc).toISOString() })}<br />{t('Computed sample UTC: {0}', { 0: sampledUtc })}</p>
      </header>
      <h2>{t('Mission metrics')}</h2>
      <p>{t('Requested duration: {0} days. Covered metric window: {1} h. Observer height: {2} m.', { 0: days, 1: metrics.hours, 2: heightM })}</p>
      {metrics.hours < days * 24 && <p role="note">{t('The mission extends beyond data coverage; metrics describe only the covered portion.')}</p>}
      <dl className="report-metrics">
        <div><dt>{t('Mean visible solar disk')}</dt><dd>{metrics.lightPct.toFixed(2)}%</dd></div>
        <div><dt>{t('Earth visibility')}</dt><dd>{metrics.earthPct.toFixed(2)}%</dd></div>
        <div><dt>{t('Longest day / night')}</dt><dd>{t('{0} h / {1} h', { 0: metrics.longestDayH, 1: metrics.longestNightH })}</dd></div>
        <div><dt>{t('Until day threshold fails')}</dt><dd>{duration(metrics.hoursToSunset)}</dd></div>
        <div><dt>{t('Until Earth loss at selected height')}</dt><dd>{duration(metrics.hoursToEarthset)}</dd></div>
        <div><dt>{t('Sun above selected mask')}</dt><dd>{metrics.sunElAtLandingDeg.toFixed(2)}°</dd></div>
      </dl>
      {u ? <p className="report-uncertainty">{t('Published uncertainty: p5 {0}% · p50 {1}% · p95 {2}%. Window: {3}. Clones: {4}.', {
        0: u.illum_pct_p5, 1: u.illum_pct_p50, 2: u.illum_pct_p95, 3: u.window ?? t('Not specified'), 4: u.n_clones ?? t('Not specified'),
      })} <ExplainTip topic="uncertainty" /><br />
        <svg className="report-uncertainty-band" viewBox="0 0 100 8" aria-hidden="true">
          <line x1="0" x2="100" y1="4" y2="4" stroke="#b3bac3" />
          <line x1={u.illum_pct_p5} x2={u.illum_pct_p95} y1="4" y2="4" stroke="currentColor" strokeWidth="2" />
          <circle cx={u.illum_pct_p50} cy="4" r="2.5" fill="currentColor" />
        </svg><br />{t('This published 2 m DEM-clone range is not a confidence interval for this mission or other heights.')} {u.source && sourceText(u.source)}</p>
        : <p>{t('No published uncertainty band for this site.')}</p>}
      <LandingRisk site={data} landingIndex={i} assumptions={a} />
    </section>
    <section className="report-sheet report-second-sheet">
      <h2>{t('Landing panorama and 30-day timeline')}</h2>
      <p>{t('Charts use the selected {0} m mask. Sun: solid; Earth: dashed. The panorama has an exaggerated vertical scale.', { 0: heightM })}</p>
      <PanoramaChart maskCdeg={mask} stepDeg={data.horizon.az_step_deg} height={190}
        elMin={Math.floor(Math.min(-5, ...mask.map(x => x / 100), series.sunEl[i], series.earthEl[i]))}
        elMax={Math.ceil(Math.max(10, ...mask.map(x => x / 100), series.sunEl[i], series.earthEl[i]))}
        sun={{ az: series.sunAz[i], el: series.sunEl[i], vis: series.sunFrac[i] > 0, label: t('Sun') }}
        earth={{ az: series.earthAz[i], el: series.earthEl[i], vis: !!series.earthVis[i], label: t('Earth') }} />
      {data.ephem.step_h === 1 ? <Timeline site={data} series={series} startMs={Date.parse(sampledUtc)} days={30}
        landingUtc={sampledUtc} missionH={days * 24} dayFraction={a.dayFraction} />
        : <p>{t('Timeline unavailable for non-hourly ephemeris.')}</p>}
      {i + 30 * 24 / data.ephem.step_h > data.ephem.n && <p>{t('Timeline extends beyond coverage. Earth visibility outside coverage is unknown, not hidden.')}</p>}
      <h2>{t('Assumptions')}</h2>
      <p>{t('Solar radius {0}°. Day: visible disk ≥ {1}%. Earth centre clearance ≥ {2}°. Risk always uses the 2 m mask; other metrics and charts use {3} m. Default lander height: 4 m.', { 0: SUN_RADIUS_DEG, 1: a.dayFraction * 100, 2: a.earthMarginDeg, 3: heightM })}</p>
      <p>{t('UTC is rounded down to the containing sample; no sub-sample event timing. Shadows assume flat ground and a point at the Sun centre, without slope, penumbra or terrain occlusion. These planning thresholds are not NASA flight requirements.')}</p>
      <h2>{t('Data sources and versions')}</h2>
      <p><a href={meta.source_url}>{t('Published site source')}</a> · {sourceText(meta.dem_source)} · {data.frame}<br />
        {t('Site data generated UTC: {0}. Horizon step: {1}°; range: {2} km. Ephemeris step: {3} h.', { 0: data.generated_utc, 1: data.horizon.az_step_deg, 2: data.horizon.max_dist_m / 1000, 3: data.ephem.step_h })}<br />
        {t('Coverage: {0} to {1} (exclusive).', { 0: data.ephem.t0_utc, 1: timeAtIndex(data, data.ephem.n).toISOString() })}</p>
      <h2>{t('Validation summary')}</h2>
      {v ? <><p>{v.summary.pass ? t('PASS') : t('FAIL')} · {t('{0} comparisons; max azimuth error {1}°; max elevation error {2}°; threshold {3}°.', {
        0: v.summary.n, 1: v.summary.max_abs_d_az_deg.toExponential(3), 2: v.summary.max_abs_d_el_deg.toExponential(3), 3: v.summary.threshold_deg,
      })} {t('Validation generated UTC: {0}', { 0: v.generated_utc })}</p><p className="report-method">{sourceText(v.method)}</p></>
        : <p>{t('Validation unavailable; no validation result is asserted.')}</p>}
      <p>{t('Ephemeris validation does not validate landing safety, terrain shadows or the risk thresholds.')}</p>
      <div className="report-provenance"><p>{t('Report generated UTC: {0}', { 0: generatedUtc })}</p>
        <p>{t('Shareable scenario URL')}<br /><a href={shareUrl}>{shareUrl}</a></p></div>
    </section>
  </article>;
}
