import en from './locales/en.json';
import es from './locales/es.json';
import { useApp } from './state';

/** English keys double as readable fallbacks for source metadata. */
export function t(key: string, values: Record<string, string | number> = {}): string {
  const dictionary: Record<string, string> = useApp.getState().lang === 'es' ? es : en;
  return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

/** The engine keeps its English API; translate its three explanation templates here. */
export function reasonText(reason: string): string {
  const light = reason.match(/^([+-]\d+)% sunlight vs original plan$/);
  if (light) return t('{0}% sunlight vs original plan', { 0: light[1] });
  const night = reason.match(/^([+-]\d+) h longest night vs original plan$/);
  if (night) return t('{0} h longest night vs original plan', { 0: night[1] });
  const earth = reason.match(/^Earth visible (\d+)% of mission \(([+-]\d+)% vs original plan\)$/);
  if (earth) return t('Earth visible {0}% of mission ({1}% vs original plan)', { 0: earth[1], 1: earth[2] });
  return t(reason);
}

/** Localize published source descriptions while retaining their numerical values. */
export function sourceText(text: string): string {
  const selection = text.match(/^best-lit point with slope <= ([\d.]+) deg within ([\d.]+) km of the reference \(([\d.]+) m away; ([\d.]+)% -> ([\d.]+)% sunlight in (\d+) at ([\d.]+) m\)$/);
  if (selection) return t('Best-lit point with slope ≤ {0}° within {1} km of the reference ({2} m away; {3}% → {4}% sunlight in {5} at {6} m)', Object.fromEntries(selection.slice(1).map((v, i) => [i, v])));
  const error = text.match(/^Unable to load (.+): (\d+)$/);
  if (error) return t('Unable to load {0}: {1}', { 0: t(error[1]), 1: error[2] });
  return t(text);
}
