import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import type { Assumptions, SiteData } from '../lib/types';
import { DEFAULT_ASSUMPTIONS } from '../lib/metrics';
import { computeEnergy, DEFAULT_ENERGY_PARAMETERS, ENERGY_STEP_H, INITIAL_SOC_FRACTION,
  NO_SUN_FRACTION, SOLAR_CONSTANT_W_M2 } from '../lib/energy';
import type { EnergyParameters } from '../lib/energy';
import ExplainTip from './ExplainTip';
import '../styles/energy.css';

function Tip({ explanation, children }: { explanation: string; children: ReactNode }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return <span className="energy-tip" tabIndex={0} aria-describedby={id}
    onFocus={() => setDismissed(false)} onMouseEnter={() => setDismissed(false)}
    onKeyDown={e => { if (e.key === 'Escape') setDismissed(true); }}>
    {children}<span id={id} role="tooltip" hidden={dismissed}>{explanation}</span>
  </span>;
}

interface Props { site: SiteData; utc: string; missionDays: number; assumptions?: Assumptions }

export default function EnergyCard({ site, utc, missionDays, assumptions = DEFAULT_ASSUMPTIONS }: Props) {
  const [parameters, setParameters] = useState<EnergyParameters>({ ...DEFAULT_ENERGY_PARAMETERS });
  const hatchId = useId().replace(/:/g, '');
  const result = useMemo(() => {
    try { return computeEnergy(site, utc, missionDays, parameters, assumptions); }
    catch { return null; }
  }, [site, utc, missionDays, parameters, assumptions]);
  const numeric = (key: Exclude<keyof EnergyParameters, 'panelMode'>, label: string, help: string, max?: number) =>
    <label><span>{t(label)} <Tip explanation={t(help)}>ⓘ</Tip></span>
      <input type="number" min={0} max={max} step="any" value={Number.isNaN(parameters[key]) ? '' : parameters[key]}
        onChange={event => setParameters(p => ({ ...p, [key]: event.target.valueAsNumber }))} /></label>;
  const value = (label: string, number: number | null, unit: string, help: string) =>
    <div><dt>{t(label)}</dt><dd><Tip explanation={t(help)}>{number === null ? t('Not applicable') : `${number.toFixed(2)} ${unit}`}</Tip></dd></div>;
  const r = result;
  const y = (stored: number) => 110 - (parameters.batteryKWh > 0 ? stored / parameters.batteryKWh : 0) * 100;
  return <section className="energy-card" aria-label={t('Energy and night survival')}>
    <h2>{t('Energy and night survival')}</h2>
    <p>{t('Example lander, editable. Parameters are local to this card and are not saved in the URL.')}</p>
    <div className="energy-controls">
      <label>{t('Vertical panel mode')}<select value={parameters.panelMode}
        onChange={event => setParameters(p => ({ ...p, panelMode: event.target.value as EnergyParameters['panelMode'] }))}>
        <option value="tracking">{t('Tracks Sun azimuth')}</option><option value="fixed">{t('Fixed azimuth')}</option>
      </select></label>
      {numeric('areaM2', 'Panel area (m²)', 'Active solar-cell area; rated power is solar constant × area × efficiency.')}
      {numeric('efficiency', 'Panel efficiency (0–1)', 'Electrical conversion efficiency, entered as a fraction.', 1)}
      {parameters.panelMode === 'fixed' && numeric('panelAzDeg', 'Panel azimuth (°)', 'Clockwise from north; east is 90°. Angles wrap around.')}
      {numeric('dayLoadW', 'Day load (W)', 'Constant total load whenever any solar disk is visible, even if the panel faces away.')}
      {numeric('nightLoadW', 'Survival load (W)', 'Constant total load when the solar disk is fully hidden; includes heaters.')}
      {numeric('batteryKWh', 'Battery capacity (kWh)', 'Usable stored energy; initially full, with no additional depth-of-discharge reserve.')}
      {numeric('roundTripEfficiency', 'Round-trip efficiency (0–1)', 'Must be greater than zero. Charge and discharge efficiencies each equal its square root.', 1)}
    </div>
    {!r ? <p role="status">{t('Energy unavailable: enter valid parameters and a positive mission fully inside hourly data coverage with the selected height mask.')}</p> : <>
      <p className="energy-verdict" role="status"><Tip explanation={t('Survival means no unmet electrical load in the sampled model. Margin is capacity minus minimum required capacity, converted to survival-load hours; it is not a forecast beyond the mission.')}>
        {r.survives ? r.marginH === null ? t('Survives the mission; margin undefined at zero survival load.')
          : t('Survives the mission with {0} h margin', { 0: r.marginH.toFixed(2) })
          : t('Battery depleted at {0}; needs ≥ {1} kWh', { 0: r.firstDepletionUtc!, 1: (Math.ceil(r.requiredBatteryKWh * 100) / 100).toFixed(2) })}
      </Tip></p>
      <dl className="energy-values">
        {value('Rated solar power', r.ratedPowerW, 'W', 'Solar constant × active area × panel efficiency, before incidence and horizon losses.')}
        {value('Mission generation', r.generatedKWh, 'kWh', 'All panel energy before battery losses and curtailment; not all generated energy can be stored.')}
        {value('Generation per day', r.generatedPerDayKWh, 'kWh/d', 'Mission generation divided by mission duration in Earth days.')}
        {value('Mean solar power', r.meanPowerW, 'W', 'Mission generation divided by mission hours, including darkness.')}
        {value('Net deficit', r.deficitHours, 'h', 'Hours when panel power is below the applicable load, including partially lit hours.')}
        {value('Longest no-sun period', r.longestNoSunH, 'h', 'Longest continuous fully hidden solar disk within this mission; clipped at both mission boundaries.')}
        {value('Energy to cross that night', r.nightEnergyKWh, 'kWh', 'Stored battery energy needed for the longest no-sun period, including discharge losses.')}
        {value('Minimum state of charge', r.minSocPct, '%', 'Lowest usable battery charge; clamped at zero after failure. Later recharge does not reverse mission failure.')}
        {value('Minimum battery capacity', r.requiredBatteryKWh, 'kWh', 'Maximum cumulative storage deficit between recharge peaks, starting full; includes partial-sun deficits and efficiency losses.')}
        {value('Survival-load margin', r.marginH, 'h', 'Signed spare capacity converted to survival-load hours. Negative means insufficient capacity; undefined at zero survival load.')}
      </dl>
      <figure>
        <svg viewBox="0 0 600 140" role="img" aria-label={t('Battery state of charge over mission; hatched intervals have no visible Sun.')}>
          <defs><pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="currentColor" strokeWidth="1" /></pattern></defs>
          {r.nights.map(n => <rect key={n.startH} x={40 + n.startH / r.hours * 550} y="10" width={(n.endH - n.startH) / r.hours * 550} height="100" fill={`url(#${hatchId})`} opacity="0.35" />)}
          <path d="M40 10V110H590" fill="none" stroke="currentColor" />
          <text x="0" y="15">100%</text><text x="10" y="110">0%</text>
          <polyline points={r.points.map(p => `${40 + p.elapsedH / r.hours * 550},${y(p.storedKWh)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
          <text x="40" y="135">{t('Landing')}</text><text x="590" y="135" textAnchor="end">{t('{0} h', { 0: r.hours })}</text>
        </svg>
        <figcaption>{t('State of charge: solid line. No Sun: diagonal hatching. Zero after depletion represents unmet load, not successful operation.')} <Tip explanation={t('The chart uses a linear time axis and usable charge from empty to full; the full mission is shown.')}>ⓘ</Tip></figcaption>
      </figure>
    </>}
    <details><summary>{t('Energy model assumptions')}</summary>
      <p>{t('Solar constant: {0} W/m²; initial charge: {1}%; no Sun: visible fraction ≤ {2}; samples: {3} h; selected panel height: {4} m.', { 0: SOLAR_CONSTANT_W_M2, 1: INITIAL_SOC_FRACTION * 100, 2: NO_SUN_FRACTION, 3: ENERGY_STEP_H, 4: assumptions.heightM })} <ExplainTip topic="solar" /> <ExplainTip topic="horizon" /></p>
      <p>{t('Tracking: rated power × visible fraction × cos(elevation). Fixed: also multiply by max(0, cos(Sun azimuth − panel azimuth)). Any visible disk uses the day load; the dashboard day threshold is not used.')}</p>
      <p>{t('Each hourly sample is held constant; partial boundary hours are integrated. Depletion time is interpolated within a constant-power interval, not an ephemeris event prediction. Full coverage is required.')}</p>
      <p>{t('Charge and discharge each use √round-trip efficiency. Excess solar power is curtailed at full charge. Minimum capacity is the maximum cumulative storage drawdown; zero charge exactly at mission end still meets the load.')}</p>
      <p>{t('Illustrative electrical balance only, not thermal or flight qualification. Ignores Sun–Moon distance variation, temperature, dust, degradation, self-discharge, charge-rate limits, tracking power and local lander shadows. Survival heaters are a user assumption, not a thermal prediction.')}</p>
    </details>
  </section>;
}
