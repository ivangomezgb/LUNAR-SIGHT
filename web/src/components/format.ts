// Small formatting / time helpers shared by UI components.

export const HOUR_MS = 3600_000;

export function toDate(utc: string | Date): Date {
  return utc instanceof Date ? utc : new Date(utc);
}

/** "2027-01-12T06:00:00Z" */
export function isoHour(d: Date | string | number): string {
  const t = new Date(d);
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Short URL form "2027-01-12T06:00Z" */
export function isoShort(d: Date | string | number): string {
  return new Date(d).toISOString().slice(0, 16) + 'Z';
}

export function parseUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = Date.parse(s.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "12 Jan 2027 06:00 UTC" */
export function fmtUtc(d: Date | string | number, withYear = true): string {
  const t = new Date(d);
  const mon = t.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mon}${withYear ? ' ' + t.getUTCFullYear() : ''} ${hh}:${mm} UTC`;
}

export function fmtDay(d: Date | string | number): string {
  const t = new Date(d);
  return `${String(t.getUTCDate()).padStart(2, '0')} ${t.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

/** Hours as "41 h" or "3.2 d" for long spans. */
export function fmtHours(h: number | null | undefined, opts: { long?: boolean } = {}): string {
  if (h == null || !Number.isFinite(h)) return '—';
  if (opts.long && h >= 72) return `${(h / 24).toFixed(1)} d`;
  return `${Math.round(h)} h`;
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Value for <input type="datetime-local"> interpreted as UTC. */
export function toLocalInput(utc: string): string {
  return new Date(utc).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string | null {
  const d = parseUtc(v);
  return d ? isoHour(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS) : null;
}

export const GROUP_LABEL: Record<string, string> = {
  artemis: 'Artemis III candidate',
  clps: 'CLPS',
  isro: 'ISRO',
  science: 'Science target',
};

export function groupLabel(g: string): string {
  return GROUP_LABEL[g] ?? g;
}

/** Angular error in degrees: scientific notation for tiny values so they don't read as exactly 0. */
export function fmtErr(deg: number): string {
  const a = Math.abs(deg);
  if (a === 0) return '0';
  return a < 1e-3 ? deg.toExponential(1) : deg.toFixed(4);
}
