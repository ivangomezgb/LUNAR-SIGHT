import { t } from '../i18n';
import AssumptionsPanel from '../components/AssumptionsPanel';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Assumptions, Metrics, SiteData, SiteIndexEntry } from '../lib/types';
import { computeMetrics } from '../lib/metrics';
import { useApp, MAX_COMPARE } from '../state';
import { useSites, useSitesData } from '../components/hooks';
import { ErrorBox, Loading, Empty } from '../components/Status';
import DateTimePicker from '../components/DateTimePicker';
import Timeline from '../components/Timeline';
import PanoramaChart, { type PathPoint } from '../components/PanoramaChart';
import { maskFor } from '../components/series';
import { groupColor, shortName } from '../components/format';
import { assumptionsFor, coverage, seriesFor } from '../components/series';
import { hourIndex } from '../lib/metrics';
import { fmtNum, fmtUtc, HOUR_MS, isoShort } from '../components/format';
import { isSynthetic } from '../components/format';

interface Row {
  label: string;
  unit: string;
  get: (m: Metrics) => number | null;
  better: 'high' | 'low';
  fmt?: (v: number | null, m: Metrics) => string;
}

const ROWS: Row[] = [
  { label: 'Sunlight', unit: '%', get: (m) => m.lightPct, better: 'high', fmt: (v) => fmtNum(v, 1) },
  { label: 'Longest day', unit: 'h', get: (m) => m.longestDayH, better: 'high', fmt: (v) => fmtNum(v, 0) },
  { label: 'Longest night', unit: 'h', get: (m) => m.longestNightH, better: 'low', fmt: (v) => fmtNum(v, 0) },
  { label: 'Earth visible', unit: '%', get: (m) => m.earthPct, better: 'high', fmt: (v) => fmtNum(v, 1) },
  {
    label: 'Hours to sunset',
    unit: 'h',
    get: (m) => (m.hoursToSunset == null ? Infinity : m.hoursToSunset),
    better: 'high',
    fmt: (v) => (v === Infinity ? t("> data") : fmtNum(v, 0)),
  },
  {
    label: 'Hours to Earthset',
    unit: 'h',
    get: (m) => (m.hoursToEarthset == null ? Infinity : m.hoursToEarthset),
    better: 'high',
    fmt: (v) => (v === Infinity ? t("> data") : fmtNum(v, 0)),
  },
  {
    label: 'Next Earth window',
    unit: 'duration',
    get: (m) => m.nextEarthWindow?.durationH ?? null,
    better: 'high',
    fmt: (v, m) => (v == null ? '—' : t("{0} from {1}", { 0: v >= 72 ? `${fmtNum(v / 24, 1)} d` : `${fmtNum(v, 0)} h`, 1: fmtUtc(m.nextEarthWindow!.startUtc, false) })),
  },
  { label: 'Sun at landing', unit: '°', get: (m) => m.sunElAtLandingDeg, better: 'high', fmt: (v) => (v == null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)) },
];

export default function Compare() {
  const sites = useSites();
  const { compareIds, siteId, setCompare, landingUtc, setLanding, missionDays, setMissionDays, assumptions } = useApp();
  const list = sites.data ?? [];
  const ids = (compareIds.length ? compareIds : siteId ? [siteId] : list.slice(0, 2).map((s) => s.id)).filter((id) =>
    list.length ? list.some((s) => s.id === id) : true,
  );
  const data = useSitesData(ids);

  if (sites.loading) return <Loading />;
  if (sites.error) return <ErrorBox error={sites.error} title={t("Site index not available")} />;
  if (!list.length) return <Empty title={t("No sites published yet")} />;

  const setSlot = (k: number, id: string) => {
    const next = [...ids];
    if (id === '') next.splice(k, 1);
    else next[k] = id;
    setCompare(Array.from(new Set(next)));
  };

  const first = data.data ? data.data.get(ids[0]) : undefined;
  const cov = first ? coverage(first) : undefined;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t("Compare sites")}</h1>
          <p className="muted">{t("Up to")} {MAX_COMPARE} {t("sites, same landing time and mission duration. Best value in each row is highlighted.")}</p>
        </div>
      </header>

      <section className="card compare-controls">
        <div className="slots">
          {Array.from({ length: MAX_COMPARE }, (_, k) => (
            <div className="field" key={k}>
              <label htmlFor={`slot-${k}`}>{t("Site")} {k + 1}</label>
              <select id={`slot-${k}`} className="select" value={ids[k] ?? ''} onChange={(e) => setSlot(k, e.target.value)} disabled={k > ids.length}>
                <option value="">{k < ids.length ? t("— remove —") : t("— add a site —")}</option>
                {list.map((s) => (
                  <option key={s.id} value={s.id} disabled={ids.includes(s.id) && ids[k] !== s.id}>
                    {shortName(s.name)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <DateTimePicker
          idPrefix="cmp"
          landingUtc={landingUtc}
          missionDays={missionDays}
          onLanding={setLanding}
          onMissionDays={setMissionDays}
          {...(cov ? { minMs: cov[0], maxMs: cov[1] } : {})}
        />
      </section>
      <AssumptionsPanel heights={[1, 2, 5, 10]} />

      {data.loading && <Loading label={t("Loading sites…")} />}
      {data.error && <ErrorBox error={data.error} />}
      {data.data && ids.length > 0 && (
        <CompareGrid ids={ids} index={list} data={data.data} landingUtc={landingUtc} missionDays={missionDays} assumptions={assumptions} />
      )}
    </div>
  );
}

function CompareGrid({
  ids,
  index,
  data,
  landingUtc,
  missionDays,
  assumptions,
}: {
  ids: string[];
  index: SiteIndexEntry[];
  data: Map<string, SiteData>;
  landingUtc: string;
  missionDays: number;
  assumptions: Assumptions;
}) {
  const missionH = missionDays * 24;
  const cols = ids
    .map((id) => ({ id, site: data.get(id), entry: index.find((e) => e.id === id) }))
    .filter((c): c is { id: string; site: SiteData; entry: SiteIndexEntry } => !!c.site && !!c.entry);

  const computed = useMemo(
    () =>
      cols.map((c) => {
        const [c0, c1] = coverage(c.site);
        const lm = Date.parse(landingUtc);
        const ok = lm >= c0 && lm + missionH * HOUR_MS <= c1;
        const series = seriesFor(c.site, assumptions);
        const metrics = ok ? computeMetrics(c.site, landingUtc, missionH, assumptionsFor(c.site, assumptions)) : null;
        const i0 = hourIndex(c.site, landingUtc);
        const sp: PathPoint[] = [];
        const ep: PathPoint[] = [];
        if (ok)
          for (let i = i0; i <= i0 + missionH; i++) {
            sp.push({ az: series.sunAz[i], el: series.sunEl[i], vis: series.sunFrac[i] >= assumptions.dayFraction });
            ep.push({ az: series.earthAz[i], el: series.earthEl[i], vis: series.earthVis[i] > 0 });
          }
        return { ...c, series, metrics, sp, ep };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(','), data, landingUtc, missionH, assumptions],
  );

  const lm = Date.parse(landingUtc);
  const dayStart = Math.floor(lm / (24 * HOUR_MS)) * 24 * HOUR_MS;
  const bandStart = dayStart - 3 * 24 * HOUR_MS;

  const best = ROWS.map((r) => {
    const vals = computed.map((c) => (c.metrics ? r.get(c.metrics) : null)).filter((v): v is number => v != null);
    if (vals.length < 2) return null;
    return r.better === 'high' ? Math.max(...vals) : Math.min(...vals);
  });

  return (
    <>
      <div className={`compare-cols cols-${computed.length}`}>
        {computed.map((c) => (
          <section className="card compare-col" key={c.id}>
            <div className="eyebrow">
              <i className="dot" style={{ background: groupColor(c.entry.group) }} aria-hidden /> {c.entry.lat_deg.toFixed(2)}°, {c.entry.lon_deg.toFixed(2)}°E
            </div>
            <h2 className="compare-name">{shortName(c.entry.name)}</h2>
            {isSynthetic(c.entry) && <span className="badge badge-warn">{t("synthetic")}</span>}
            <div className="muted small">{t("Observer / panel height:")} {assumptionsFor(c.site, assumptions).heightM} m</div>
            <PanoramaChart compact height={170} maskCdeg={maskFor(c.site, assumptionsFor(c.site, assumptions).heightM)} stepDeg={c.site.horizon.az_step_deg} sunPath={c.sp} earthPath={c.ep} ariaLabel={t("Horizon of {0}", { 0: c.entry.name })} />
            {c.metrics ? (
              <div className="mini-metrics">
                <div>
                  <span className="mm-v">{fmtNum(c.metrics.lightPct, 0)}<small>%</small></span>
                  <span className="mm-l">{t("light")}</span>
                </div>
                <div>
                  <span className="mm-v">{fmtNum(c.metrics.earthPct, 0)}<small>%</small></span>
                  <span className="mm-l">{t("Earth")}</span>
                </div>
                <div>
                  <span className="mm-v">{fmtNum(c.metrics.longestNightH, 0)}<small>h</small></span>
                  <span className="mm-l">{t("longest night")}</span>
                </div>
              </div>
            ) : (
              <p className="muted">{t("Mission window outside data coverage.")}</p>
            )}
            <Link className="btn btn-ghost btn-sm" to={`/?site=${encodeURIComponent(c.id)}&t=${isoShort(landingUtc)}&h=${assumptions.heightM}&lang=${useApp.getState().lang}`}> {t("Open in panorama →")} </Link>
          </section>
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">{t("Aligned 30-day timelines")}</h2>
          <span className="muted small">{t("Same time axis for every site")}</span>
        </div>
        <div className="timeline-stack">
          {computed.map((c) => (
            <Timeline
              key={c.id}
              title={shortName(c.entry.name)}
              site={c.site}
              series={c.series}
              startMs={bandStart}
              days={30}
              landingUtc={landingUtc}
              missionH={missionH}
              dayFraction={assumptions.dayFraction}
              compact
            />
          ))}
        </div>
      </section>

      <section className="card table-card">
        <h2 className="card-title">{t("Metrics over the")} {missionDays}{t("-day mission")}</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("Metric")}</th>
                {computed.map((c) => (
                  <th scope="col" key={c.id}>
                    {shortName(c.entry.name)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, k) => (
                <tr key={t(r.label)}>
                  <th scope="row">
                    {t(r.label)} <span className="unit">({t(r.unit)}, {r.better === 'high' ? t("higher") : t("lower")} {t("is better)")}</span>
                  </th>
                  {computed.map((c) => {
                    const v = c.metrics ? r.get(c.metrics) : null;
                    const isBest = best[k] != null && v === best[k];
                    return (
                      <td key={c.id} className={`mono${isBest ? ' is-best' : ''}`}>
                        {c.metrics ? (r.fmt ? r.fmt(v, c.metrics) : fmtNum(v)) : '—'}
                        {isBest && <span className="best-tag">{t("best")}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
