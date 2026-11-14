import type { Weights } from '../lib/types';
import { DEFAULT_WEIGHTS } from '../lib/score';

const LABELS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: 'light', label: 'Sunlight', hint: 'mean visible solar disk' },
  { key: 'earth', label: 'Earth visibility', hint: 'direct-to-Earth comms' },
  { key: 'night', label: 'Short nights', hint: 'penalise longest night' },
  { key: 'landingSun', label: 'Sun at landing', hint: 'elevation up to 3°' },
];

export default function WeightSliders({ weights, onChange }: { weights: Weights; onChange: (w: Weights) => void }) {
  const total = LABELS.reduce((s, l) => s + weights[l.key], 0) || 1;
  return (
    <fieldset className="weights">
      <legend>Weights</legend>
      {LABELS.map((l) => (
        <div className="weight-row" key={l.key}>
          <label htmlFor={`w-${l.key}`}>
            {l.label} <span className="muted small">{l.hint}</span>
          </label>
          <input
            id={`w-${l.key}`}
            type="range"
            min={0}
            max={100}
            step={5}
            value={weights[l.key]}
            onChange={(e) => onChange({ ...weights, [l.key]: Number(e.target.value) })}
            className="range"
            aria-valuetext={`${weights[l.key]} of 100`}
          />
          <span className="mono weight-val">{Math.round((weights[l.key] / total) * 100)}%</span>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...DEFAULT_WEIGHTS })}>
        Reset weights
      </button>
    </fieldset>
  );
}
