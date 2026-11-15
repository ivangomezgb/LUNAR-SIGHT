import { useId, useMemo, useState } from 'react';
import { t } from '../i18n';
import type { Assumptions, SiteData } from '../lib/types';
import { DEFAULT_ASSUMPTIONS, getSeries, hourIndex, timeAtIndex } from '../lib/metrics';
import { computeLandingRisk, DEFAULT_LANDER_HEIGHT_M, HIGH_MARGIN_DEG, HIGH_SUNLIGHT_H,
  MEDIUM_MARGIN_DEG, MEDIUM_SUNLIGHT_H, RISK_MASK_HEIGHT_M } from '../lib/landingRisk';
import ExplainTip from './ExplainTip';
import '../styles/report.css';

interface Props {
  site: SiteData;
  landingIndex?: number;
  utc?: string;
  assumptions?: Assumptions;
  landerHeightM?: number;
}

function Value({ label, value, explanation }: { label: string; value: string; explanation: string }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return <div className="risk-value"><dt>{label}</dt><dd>
    <span className="risk-tip" tabIndex={0} aria-describedby={id}
      onFocus={() => setDismissed(false)} onMouseEnter={() => setDismissed(false)}
      onKeyDown={event => { if (event.key === 'Escape') setDismissed(true); }}>{value}
      <span className="risk-tip-content" id={id} role="tooltip" hidden={dismissed}>{explanation}</span>
    </span>
  </dd></div>;
}

export default function LandingRisk({ site, landingIndex, utc, assumptions = DEFAULT_ASSUMPTIONS,
  landerHeightM = DEFAULT_LANDER_HEIGHT_M }: Props) {
  const i = landingIndex ?? (utc ? hourIndex(site, utc) : NaN);
  const result = useMemo(() => {
    try {
      return computeLandingRisk(getSeries(site, { ...assumptions, heightM: RISK_MASK_HEIGHT_M }), i, site.ephem.step_h, landerHeightM);
    } catch { return null; }
  }, [site, assumptions, i, landerHeightM]);
  if (!result) return <section className="landing-risk" role="status">{t('Landing risk unavailable: choose a covered time, a positive lander height and a site with a 2 m mask.')}</section>;
  const r = result;
  const num = (n: number | null, unit: string) => n === null ? t('Unavailable') : `${n.toFixed(2)} ${unit}`;
  const until = (n: number | null) => n === null
    ? t('Not observed within {0} h', { 0: r.observedAheadH }) : t('{0} h', { 0: n });
  const level = r.level === 'high' ? t('High light risk') : r.level === 'medium' ? t('Medium light risk') : t('Low light risk');
  const trend = r.elevationRateDegH === null ? t('Unknown') : r.elevationRateDegH > 0 ? t('Rising') : r.elevationRateDegH < 0 ? t('Setting') : t('Unchanged at sample precision');
  // Uniform geometric scale; very low elevations legitimately make the lander tiny.
  const scale = 240 / Math.max(r.landerHeightM, r.landerShadowM ?? r.landerHeightM);
  return <section className="landing-risk" aria-label={t('Landing light risk')}>
    <div className="risk-heading"><h2>{t('Landing light risk')}</h2>
      <strong className={`risk-level risk-${r.level}`}><span aria-hidden="true">{r.level === 'high' ? '▲' : r.level === 'medium' ? '◆' : '●'}</span> {level}</strong>
    </div>
    <p className="risk-caption">{t('Sample UTC: {0}. Risk mask: {1} m.', { 0: timeAtIndex(site, i).toISOString(), 1: RISK_MASK_HEIGHT_M })} <ExplainTip topic="horizon" /></p>
    <dl className="risk-grid">
      <Value label={t('Sun above terrain')} value={num(r.marginDeg, '°')} explanation={t('Sun centre elevation minus the 2 m terrain mask at the solar azimuth.')} />
      <Value label={t('Sun above horizontal')} value={num(r.sunElevationDeg, '°')} explanation={t('Sun centre above the local astronomical horizontal, used for flat-ground shadows.')} />
      <Value label={t('Sunlight remaining')} value={until(r.sunlightRemainingH)} explanation={t('First sample with zero visible solar disk; zero means already fully hidden. Unknown beyond coverage.')} />
      <Value label={t('Until Earth loss')} value={until(r.earthLossH)} explanation={t('First sample failing the Earth centre clearance of {0}° above the 2 m mask; zero means hidden now.', { 0: assumptions.earthMarginDeg })} />
      <Value label={t('Shadow of 1 m obstacle')} value={num(r.obstacleShadowM, 'm')} explanation={t('Flat ground: height / tan(horizontal Sun elevation). Unavailable at or below 0°; terrain may block direct light.')} />
      <Value label={t('Shadow of {0} m lander', { 0: landerHeightM })} value={num(r.landerShadowM, 'm')} explanation={t('Geometric centre-ray length, ignoring slope, penumbra and terrain occlusion.')} />
      <Value label={t('Sun / shadow azimuth')} value={`${r.sunAzimuthDeg.toFixed(2)}° / ${r.shadowAzimuthDeg.toFixed(2)}°`} explanation={t('Clockwise from local north; shadows point 180° away from the Sun.')} />
      <Value label={t('Elevation rate')} value={`${num(r.elevationRateDegH, t('°/h'))} · ${trend}`} explanation={t('Central difference of horizontal elevation; one-sided at coverage edges. Terrain clearance may change differently.')} />
      <Value label={t('Sunset in next 24 h')} value={r.sunsetWithin24H === null ? t('Unknown') : r.sunsetWithin24H ? t('Yes') : t('No')} explanation={t('A transition from any visible disk to fully hidden, including the 24 h endpoint. Incomplete coverage cannot establish No.')} />
    </dl>
    <div className="risk-shadow">
      <svg viewBox="0 0 280 270" role="img" aria-label={t('Lander height and flat-ground shadow at equal scale')}>
        <line x1="12" y1="254" x2="268" y2="254" stroke="currentColor" />
        <path d={`M20,254 V${254 - r.landerHeightM * scale}`} stroke="currentColor" strokeWidth="4" />
        {r.landerShadowM !== null && <path d={`M20,${254 - r.landerHeightM * scale} L${20 + r.landerShadowM * scale},254 H20`} fill="none" stroke="currentColor" strokeDasharray="5 3" />}
      </svg>
      <p>{t('Equal-scale sketch. Height {0} m; shadow {1}.', { 0: landerHeightM, 1: num(r.landerShadowM, 'm') })}<br />{t('Geometric estimate only; local terrain may already shade the lander.')}</p>
    </div>
    <p className="risk-assumptions">{t('Planning heuristic, not a NASA safety requirement. High: terrain margin < {0}° or light remaining < {1} h. Medium: margin < {2}° or light remaining < {3} h, or insufficient coverage to establish that duration. Otherwise low.', { 0: HIGH_MARGIN_DEG, 1: HIGH_SUNLIGHT_H, 2: MEDIUM_MARGIN_DEG, 3: MEDIUM_SUNLIGHT_H })}</p>
    <p className="risk-assumptions">{t('Risk uses any visible solar disk, not the day threshold. Sample spacing: {0} h; events between samples are unresolved. Earth uses the selected clearance; it does not change the light-risk level.', { 0: site.ephem.step_h })} <ExplainTip topic="solar" /> <ExplainTip topic="earth" /></p>
    {r.coverageLimited && <p>{t('Coverage is too short to establish low risk from sunlight duration.')}</p>}
  </section>;
}
