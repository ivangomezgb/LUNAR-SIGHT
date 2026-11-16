import { useId, useState } from 'react';
import { t } from '../i18n';

const TOPICS = {
  horizon: ['Explain horizon mask', 'The horizon mask is the terrain elevation in every direction, seen from the selected observer height.'],
  solar: ['Explain solar disk fraction', 'Solar disk fraction is the share of the Sun above the terrain horizon: 0% is hidden, 100% fully visible.'],
  earth: ['Explain Earth visibility', 'Earth is visible when its centre clears the terrain horizon by the selected angular margin.'],
  vertical: ['Explain vertical exaggeration', 'Vertical exaggeration stretches elevation relative to azimuth to make small ridges easier to see; it does not change the calculations.'],
  uncertainty: ['Explain uncertainty', 'The p5–p95 range and p50 marker describe sunlight variation across DEM clones for the published uncertainty window and height, not a confidence interval for the selected mission.'],
} as const;

export default function ExplainTip({ topic }: { topic: keyof typeof TOPICS }) {
  const id = useId();
  const [label, explanation] = TOPICS[topic];
  // Hover or focus shows it on desktop; a tap toggles it (iOS does not focus tapped buttons).
  const [open, setOpen] = useState(false);
  return <span className={`explain-tip${open ? ' is-open' : ''}`} onMouseLeave={() => setOpen(false)}>
    <button type="button" aria-label={t(label)} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>?</button>
    <span id={id} role="tooltip" className="explain-content">{t(explanation)}</span>
  </span>;
}
