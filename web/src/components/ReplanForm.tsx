import type { SiteIndexEntry } from '../lib/types';
import type { ReplanForm as Form } from '../state';
import { fromLocalInput, toLocalInput } from './format';
import { shortName, groupColor } from './SiteMap';
import WeightSliders from './WeightSliders';

interface Props {
  form: Form;
  sites: SiteIndexEntry[];
  onChange: (p: Partial<Form>) => void;
}

function NumField({ id, label, value, unit, min, max, step = 1, onChange }: { id: string; label: string; value: number; unit: string; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="dtp-row">
        <input
          id={id}
          type="number"
          className="input mono input-num"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

export default function ReplanForm({ form, sites, onChange }: Props) {
  const all = form.siteIds.length === 0;
  const selected = (id: string) => all || form.siteIds.includes(id);
  const toggle = (id: string) => {
    const cur = all ? sites.map((s) => s.id) : form.siteIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ siteIds: next.length === sites.length ? [] : next });
  };
  const f = form.filters;
  return (
    <form className="replan-form" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Schedule</legend>
        <div className="field">
          <label htmlFor="rp-orig">Original landing (UTC)</label>
          <input
            id="rp-orig"
            type="datetime-local"
            step={3600}
            className="input mono"
            value={toLocalInput(form.originalUtc)}
            onChange={(e) => {
              const y = Number(e.target.value.slice(0, 4));
              const v = fromLocalInput(e.target.value);
              if (v && y >= 2026 && y <= 2029) onChange({ originalUtc: v });
            }}
          />
        </div>
        <div className="field-grid">
          <NumField id="rp-delay" label="Delay" value={form.delayDays} unit="days" min={0} max={365} onChange={(v) => onChange({ delayDays: v })} />
          <NumField id="rp-tol" label="Tolerance ±" value={form.toleranceDays} unit="days" min={0} max={30} onChange={(v) => onChange({ toleranceDays: v })} />
          <NumField id="rp-dur" label="Mission" value={form.missionDays} unit="days" min={1} max={60} onChange={(v) => onChange({ missionDays: v })} />
          <div className="field">
            <label htmlFor="rp-step">Candidate step</label>
            <select id="rp-step" className="select mono" value={form.stepH} onChange={(e) => onChange({ stepH: Number(e.target.value) })}>
              {[1, 3, 6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  every {h} h
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <WeightSliders weights={form.weights} onChange={(w) => onChange({ weights: w })} />

      <fieldset>
        <legend>Hard filters</legend>
        <div className="field-grid">
          <NumField id="rp-minl" label="Min sunlight" value={f.minLightPct} unit="%" min={0} max={100} onChange={(v) => onChange({ filters: { ...f, minLightPct: v } })} />
          <NumField id="rp-mine" label="Min Earth visible" value={f.minEarthPct} unit="%" min={0} max={100} onChange={(v) => onChange({ filters: { ...f, minEarthPct: v } })} />
          <NumField id="rp-slope" label="Max slope (50 m)" value={f.maxSlopeDeg} unit="°" min={0} max={45} step={0.5} onChange={(v) => onChange({ filters: { ...f, maxSlopeDeg: v } })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={f.requireSunAtLanding} onChange={(e) => onChange({ filters: { ...f, requireSunAtLanding: e.target.checked } })} />
          Require Sun above the real horizon at landing
        </label>
      </fieldset>

      <fieldset>
        <legend>
          Sites <span className="muted small">({all ? 'all' : form.siteIds.length} selected)</span>
        </legend>
        <div className="site-chips">
          {sites.map((s) => (
            <label key={s.id} className={`chip chip-check${selected(s.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={selected(s.id)} onChange={() => toggle(s.id)} />
              <i className="dot" style={{ background: groupColor(s.group) }} aria-hidden />
              {shortName(s.name)}
            </label>
          ))}
        </div>
        {!all && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ siteIds: [] })}>
            Select all
          </button>
        )}
      </fieldset>
    </form>
  );
}
