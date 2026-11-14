import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { fromLocalInput, isoHour, toLocalInput, HOUR_MS } from './format';

interface Props {
  landingUtc: string;
  missionDays: number;
  onLanding: (utc: string) => void;
  onMissionDays: (d: number) => void;
  minMs?: number;
  maxMs?: number;
  idPrefix?: string;
}

export default function DateTimePicker({ landingUtc, missionDays, onLanding, onMissionDays, minMs, maxMs, idPrefix = 'dtp' }: Props) {
  const [text, setText] = useState(toLocalInput(landingUtc));
  const [days, setDays] = useState(String(missionDays));
  useEffect(() => setText(toLocalInput(landingUtc)), [landingUtc]);
  useEffect(() => setDays(String(missionDays)), [missionDays]);

  const clampMs = (ms: number) => {
    let v = ms;
    if (minMs != null) v = Math.max(minMs, v);
    if (maxMs != null) v = Math.min(maxMs - missionDays * 24 * HOUR_MS, v);
    return v;
  };

  const commit = (v: string) => {
    const iso = fromLocalInput(v);
    if (!iso) return;
    onLanding(isoHour(clampMs(Date.parse(iso))));
  };
  const shift = (h: number) => onLanding(isoHour(clampMs(Date.parse(landingUtc) + h * HOUR_MS)));

  return (
    <div className="dtp">
      <div className="field">
        <label htmlFor={`${idPrefix}-landing`}>{t("Landing time (UTC)")}</label>
        <div className="dtp-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(-24)} aria-label={t("One day earlier")}>
            −1 d
          </button>
          <input
            id={`${idPrefix}-landing`}
            type="datetime-local"
            step={3600}
            className="input mono"
            value={text}
            min={minMs != null ? toLocalInput(new Date(minMs).toISOString()) : undefined}
            max={maxMs != null ? toLocalInput(new Date(maxMs - missionDays * 24 * HOUR_MS).toISOString()) : undefined}
            onChange={(e) => {
              setText(e.target.value);
              const y = Number(e.target.value.slice(0, 4));
              if (y >= 2026 && y <= 2029) commit(e.target.value);
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => shift(24)} aria-label={t("One day later")}>
            +1 d
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-days`}>{t("Mission duration")}</label>
        <div className="dtp-row">
          <input
            id={`${idPrefix}-days`}
            type="number"
            min={1}
            max={60}
            className="input mono input-num"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              const d = Math.round(Number(e.target.value));
              if (d >= 1 && d <= 60) onMissionDays(d);
            }}
          />
          <span className="unit">{t("days")}</span>
          {[7, 14, 28].map((d) => (
            <button key={d} type="button" className={`chip${missionDays === d ? ' is-on' : ''}`} onClick={() => onMissionDays(d)} aria-pressed={missionDays === d}>
              {d} d
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
