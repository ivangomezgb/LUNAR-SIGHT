import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import { computeMetrics } from '../lib/metrics';
import { useApp, MAX_COMPARE } from '../state';
import { useBasemap, useSite, useSites } from '../components/hooks';
import SiteMap, { groupColor, shortName } from '../components/SiteMap';
import Panorama from '../components/Panorama';
import MetricCards from '../components/MetricCards';
import Timeline from '../components/Timeline';
import DateTimePicker from '../components/DateTimePicker';
import AssumptionsPanel from '../components/AssumptionsPanel';
import { ErrorBox, Loading, Empty } from '../components/Status';
import { seriesFor, coverage, assumptionsFor } from '../components/series';
import { groupLabel, HOUR_MS, isoHour, isoShort, parseUtc, fmtUtc } from '../components/format';

export function isSynthetic(s: { id: string; tags?: string[] }): boolean {
  return s.id.startsWith('synthetic-') || !!s.tags?.includes('synthetic');
}

export default function Explore() {
  const sites = useSites();
  const basemap = useBasemap();
  const [sp, setSp] = useSearchParams();
  const store = useApp();
  const list = sites.data ?? [];

  const urlSite = sp.get('site');
  const urlT = parseUtc(sp.get('t'));
  const siteId =
    (urlSite && list.some((s) => s.id === urlSite) ? urlSite : null) ??
    (store.siteId && list.some((s) => s.id === store.siteId) ? store.siteId : null) ??
    list[0]?.id ??
    null;
  const landingUtc = urlT ? isoHour(Math.floor(urlT.getTime() / HOUR_MS) * HOUR_MS) : store.landingUtc;

  // URL is the source of truth on this page; mirror into the store for other pages.
  useEffect(() => {
    if (siteId && siteId !== store.siteId) store.setSite(siteId);
    if (landingUtc !== store.landingUtc) store.setLanding(landingUtc);
    if (siteId && (urlSite !== siteId || !sp.get('t'))) {
      setSp({ site: siteId, t: isoShort(landingUtc) }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, landingUtc]);

  const go = (id: string, t: string) => setSp({ site: id, t: isoShort(t) }, { replace: true });

  const site = useSite(siteId);
  const entry = list.find((s) => s.id === siteId);

  if (sites.loading) return <Loading label="Loading site index…" />;
  if (sites.error)
    return (
      <ErrorBox error={sites.error} title="Site index not available">
        <p>
          The data pipeline has not published <code>sites.json</code> yet. For development run{' '}
          <code>node scripts/make-dev-data.mjs</code> and <code>VITE_DATA_DIR=dev-data npm run dev</code>.
        </p>
      </ErrorBox>
    );
  if (!list.length) return <Empty title="No sites published yet" />;

  return (
    <div className="explore">
      <aside className="explore-side">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">South polar region</h2>
            <span className="muted small">{list.length} sites</span>
          </div>
          <SiteMap
            sites={list}
            basemap={basemap.error ? null : basemap.data}
            selectedId={siteId}
            compareIds={store.compareIds}
            onSelect={(id) => go(id, landingUtc)}
          />
        </section>
        <SiteList list={list} selectedId={siteId} onSelect={(id) => go(id, landingUtc)} />
        <section className="card">
          <h2 className="card-title">Mission</h2>
          <DateTimePicker
            landingUtc={landingUtc}
            missionDays={store.missionDays}
            onLanding={(t) => siteId && go(siteId, t)}
            onMissionDays={store.setMissionDays}
            {...(site.data ? { minMs: coverage(site.data)[0], maxMs: coverage(site.data)[1] } : {})}
          />
        </section>
        <AssumptionsPanel heights={site.data?.horizon.heights_m} />
      </aside>

      <div className="explore-main">
        {entry && <SiteHeader entry={entry} />}
        {site.loading && <Loading label="Loading horizon and ephemeris…" />}
        {site.error && <ErrorBox error={site.error} title="Site data not available" />}
        {site.data && <SiteView site={site.data} landingUtc={landingUtc} onLanding={(t) => siteId && go(siteId, t)} />}
      </div>
    </div>
  );
}

function SiteList({ list, selectedId, onSelect }: { list: SiteIndexEntry[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { compareIds, toggleCompare } = useApp();
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Sites</h2>
        <Link to="/compare" className="small link">
          Compare {compareIds.length}/{MAX_COMPARE} →
        </Link>
      </div>
      <ul className="site-list">
        {list.map((s) => {
          const sel = s.id === selectedId;
          const cmp = compareIds.includes(s.id);
          return (
            <li key={s.id} className={sel ? 'is-selected' : ''}>
              <button type="button" className="site-btn" onClick={() => onSelect(s.id)} aria-current={sel ? 'true' : undefined}>
                <i className="dot" style={{ background: groupColor(s.group) }} aria-hidden />
                <span className="site-name">{shortName(s.name)}</span>
                <span className="site-coord mono">{s.lat_deg.toFixed(2)}°</span>
              </button>
              <label className="cmp-toggle" title="Add to comparison">
                <input type="checkbox" checked={cmp} onChange={() => toggleCompare(s.id)} aria-label={`Compare ${shortName(s.name)}`} />
                <span aria-hidden>Cmp</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SiteHeader({ entry }: { entry: SiteIndexEntry }) {
  return (
    <header className="site-header">
      <div>
        <div className="eyebrow">
          <i className="dot" style={{ background: groupColor(entry.group) }} aria-hidden /> {groupLabel(entry.group)}
        </div>
        <h1 className="site-title">{shortName(entry.name)}</h1>
        <div className="site-meta mono">
          <span>{entry.lat_deg.toFixed(3)}° lat</span>
          <span>{entry.lon_deg.toFixed(3)}° lon E</span>
          <span>{Math.round(entry.elev_m).toLocaleString('en-US')} m elev.</span>
          <span>{entry.slope_deg_50m.toFixed(1)}° slope (50 m)</span>
          <span>
            DEM {entry.dem_source} · {entry.dem_res_m} m/px
          </span>
        </div>
      </div>
      {isSynthetic(entry) && (
        <div className="badge badge-warn badge-lg" role="note">
          SYNTHETIC dev data — not real
        </div>
      )}
    </header>
  );
}

function SiteView({ site, landingUtc, onLanding }: { site: SiteData; landingUtc: string; onLanding: (t: string) => void }) {
  const { missionDays, assumptions, cursorH, setCursorH, setPlaying } = useApp();
  const [c0, c1] = coverage(site);
  const landMs = Date.parse(landingUtc);
  const missionH = missionDays * 24;
  const outOfRange = landMs < c0 || landMs + missionH * HOUR_MS > c1;
  const series = useMemo(() => seriesFor(site, assumptions), [site, assumptions]);
  const metrics = useMemo(
    () => (outOfRange ? null : computeMetrics(site, landingUtc, missionH, assumptionsFor(site, assumptions))),
    [site, landingUtc, missionH, assumptions, outOfRange],
  );

  if (outOfRange)
    return (
      <ErrorBox title="Landing time outside data coverage">
        <p>
          Ephemeris covers {fmtUtc(c0)} to {fmtUtc(c1)}. Pick a landing time so the whole {missionDays}-day mission fits.
        </p>
        <button type="button" className="btn" onClick={() => onLanding(isoHour(Math.min(Math.max(landMs, c0), c1 - missionH * HOUR_MS)))}>
          Move into range
        </button>
      </ErrorBox>
    );

  const dayStart = Math.floor(landMs / (24 * HOUR_MS)) * 24 * HOUR_MS;
  const bandStart = Math.max(c0, dayStart - 3 * 24 * HOUR_MS);

  return (
    <>
      <Panorama site={site} />
      {metrics && <MetricCards metrics={metrics} site={site} />}
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">30-day timeline</h2>
          <span className="muted small">Click inside the window to scrub, outside to move the landing</span>
        </div>
        <Timeline
          site={site}
          series={series}
          startMs={bandStart}
          days={30}
          landingUtc={landingUtc}
          missionH={missionH}
          dayFraction={assumptions.dayFraction}
          cursorH={cursorH}
          onPick={(ms) => {
            const rel = (ms - landMs) / HOUR_MS;
            setPlaying(false);
            if (rel >= 0 && rel <= missionH) setCursorH(rel);
            else onLanding(isoHour(ms));
          }}
          onKeyStep={(d) => {
            setPlaying(false);
            setCursorH(Math.min(missionH, Math.max(0, cursorH + d)));
          }}
        />
      </section>
    </>
  );
}
