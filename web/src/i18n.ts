import en from './locales/en.json';
import es from './locales/es.json';
import { useApp } from './state';
import type { Reason } from './lib/types';

/** English keys double as readable fallbacks for source metadata. */
export function t(key: string, values: Record<string, string | number> = {}): string {
  const dictionary: Record<string, string> = useApp.getState().lang === 'es' ? es : en;
  return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

const signed = (n: number) => `${Math.round(n) >= 0 ? '+' : '-'}${Math.abs(Math.round(n))}`;

/** Format one ranking reason from the engine in the active language. */
export function reasonText(r: Reason): string {
  switch (r.kind) {
    case 'light': return t('{0}% sunlight vs original plan', { 0: signed(r.delta) });
    case 'night': return t('{0} h longest night vs original plan', { 0: signed(r.delta) });
    case 'earth': return t('Earth visible {0}% of mission ({1}% vs original plan)', { 0: Math.round(r.pct), 1: signed(r.delta) });
  }
}

/** Localize published source descriptions while retaining their numerical values. */
export function sourceText(text: string): string {
  const selection = text.match(/^best-lit point with slope <= ([\d.]+) deg within ([\d.]+) km of the reference \(([\d.]+) m away; ([\d.]+)% -> ([\d.]+)% sunlight in (\d+) at ([\d.]+) m\)$/);
  if (selection) return t('Best-lit point with slope ≤ {0}° within {1} km of the reference ({2} m away; {3}% → {4}% sunlight in {5} at {6} m)', Object.fromEntries(selection.slice(1).map((v, i) => [i, v])));
  const error = text.match(/^Unable to load (.+): (\d+)$/);
  if (error) return t('Unable to load {0}: {1}', { 0: t(error[1]), 1: error[2] });
  return t(text);
}
