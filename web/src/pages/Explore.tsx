import { t, sourceText } from '../i18n';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SiteData, SiteIndexEntry } from '../lib/types';
import { computeMetrics } from '../lib/metrics';
import { useApp, MAX_COMPARE } from '../state';
import { useShallow } from 'zustand/react/shallow';
import { useBasemap, useSite, useSites } from '../components/hooks';
import SiteMap from '../components/SiteMap';
import TerrainBackdrop from '../components/TerrainBackdrop';
import { groupColor, shortName, isSynthetic } from '../components/format';
import Panorama from '../components/Panorama';
import MetricCards from '../components/MetricCards';
import Timeline from '../components/Timeline';
import DateTimePicker from '../components/DateTimePicker';
import AssumptionsPanel from '../components/AssumptionsPanel';
import LandingRisk from '../components/LandingRisk';
import EnergyCard from '../components/EnergyCard';
import SlopeMap from '../components/SlopeMap';
import PsrCard from '../components/PsrCard';
import { ErrorBox, Loading, Empty } from '../components/Status';
import { seriesFor, coverage, assumptionsFor } from '../components/series';
import { groupLabel, HOUR_MS, isoHour, isoShort, parseUtc, fmtUtc, fmtInt } from '../components/format';

export default function Explore() {
  const sites = useSites();
  const basemap = useBasemap();
  const [sp, setSp] = useSearchParams();
  const store = useApp(useShallow((s) => ({ siteId: s.siteId, landingUtc: s.landingUtc, setSite: s.setSite, setLanding: s.setLanding, missionDays: s.missionDays, setMissionDays: s.setMissionDays, compareIds: s.compareIds, assumptions: s.assumptions, lang: s.lang })));
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
    if (siteId && (urlSite !== siteId || !urlT)) {
      setSp((prev) => { const next = new URLSearchParams(prev); next.set('site', siteId); next.set('t', isoShort(landingUtc)); return next; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, landingUtc]);

  const go = (id: string, t: string) => setSp((prev) => { const next = new URLSearchParams(prev); next.set('site', id); next.set('t', isoShort(t)); return next; }, { replace: true });

  const site = useSite(siteId);
  const entry = list.find((s) => s.id === siteId);

  if (sites.loading) return <Loading label={t("Loading site index…")} />;
  if (sites.error)
    return (
      <ErrorBox error={sites.error} title={t("Site index not available")}>
        <p> {t("The data pipeline has not published")} <code>sites.json</code> {t("yet. For development run")}{' '}
          <code>node scripts/make-dev-data.mjs</code> {t("and")} <code>VITE_DATA_DIR=dev-data npm run dev</code>.
        </p>
      </ErrorBox>
    );
  if (!list.length) return <Empty title={t("No sites published yet")} />;

  return (
    <div className="explore">
      <section className="mission-hero" aria-labelledby="mission-heading">
        <TerrainBackdrop />
        <div>
          <div className="eyebrow">{t('Lunar south pole · Mission planning')}</div>
          <h1 id="mission-heading">{t('Find your place on the Moon.')}</h1>
          <p>{t('{0} candidate sites. Real terrain. Every hour matters.', { 0: list.length })}</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to={`/3d?site=${encodeURIComponent(siteId ?? '')}&t=${isoShort(landingUtc)}&h=${store.assumptions.heightM}&lang=${store.lang}`}>{t('Stand on the site in 3D')} <span aria-hidden>↗</span></Link>
            <Link className="btn btn-ghost" to={`/3d?site=${encodeURIComponent(siteId ?? '')}&t=${isoShort(landingUtc)}&view=pano&h=${store.assumptions.heightM}&lang=${store.lang}`}>{t('Look around in 360°')} <span aria-hidden>→</span></Link>
          </div>
        </div>
        <div className="hero-proof"><span className="eyebrow">{t('Built on public science')}</span><strong>{t('LOLA / SPICE')}</strong><span>{t('Terrain from NASA. Positions from JPL.')}</span><Link className="link" to={`/validation?lang=${store.lang}`}>{t('Inspect the validation')} →</Link></div>
      </section>
      <aside className="explore-side">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">{t("South polar region")}</h2>
            <span className="muted small">{list.length} {t("sites")}</span>
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
          <h2 className="card-title">{t("Mission")}</h2>
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
        {site.loading && <Loading label={t("Loading horizon and ephemeris…")} />}
        {site.error && <ErrorBox error={site.error} title={t("Site data not available")} />}
        {site.data && <SiteView site={site.data} landingUtc={landingUtc} onLanding={(t) => siteId && go(siteId, t)} />}
        {site.data && <LandingRisk site={site.data} utc={landingUtc} assumptions={store.assumptions} />}
        {site.data && <EnergyCard site={site.data} utc={landingUtc} missionDays={store.missionDays} assumptions={store.assumptions} />}
        {site.data && <SlopeMap siteId={site.data.id} siteName={entry?.name} />}
        {site.data && <PsrCard siteId={site.data.id} siteName={entry?.name} />}
        {site.data && siteId && (
          <div className="report-cta">
            <Link className="btn btn-ghost" to={`/report?site=${encodeURIComponent(siteId)}&t=${isoShort(landingUtc)}&days=${store.missionDays}&h=${store.assumptions.heightM}&lang=${store.lang}`}>
              {t('Mission brief (PDF)')} <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SiteList({ list, selectedId, onSelect }: { list: SiteIndexEntry[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { compareIds, toggleCompare } = useApp(useShallow((s) => ({ compareIds: s.compareIds, toggleCompare: s.toggleCompare })));
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{t("Sites")}</h2>
        <Link to={`/compare?h=${useApp.getState().assumptions.heightM}&lang=${useApp.getState().lang}`} className="small link"> {t("Compare")} {compareIds.length}/{MAX_COMPARE} →
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
              <label className="cmp-toggle" title={t("Add to comparison")}>
                <input type="checkbox" checked={cmp} onChange={() => toggleCompare(s.id)} aria-label={t("Compare {0}", { 0: shortName(s.name) })} />
                <span aria-hidden>{t("Cmp")}</span>
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
        <h2 className="site-title">{shortName(entry.name)}</h2>
        <div className="site-meta mono">
          <span>{entry.lat_deg.toFixed(3)}{t("° lat")}</span>
          <span>{entry.lon_deg.toFixed(3)}{t("° lon E")}</span>
          <span>{fmtInt(entry.elev_m)} {t("m elev.")}</span>
          <span>{entry.slope_deg_50m.toFixed(1)}{t("° slope (50 m)")}</span>
          <span> {t("DEM")} {entry.dem_source} · {entry.dem_res_m} m/px
          </span>
        </div>
        {entry.selection && entry.ref_lat_deg !== undefined && entry.ref_lon_deg !== undefined && (
          <p className="site-meta"> {t("Point selection:")} {sourceText(entry.selection)}{t(". Published reference:")} {entry.ref_lat_deg.toFixed(4)}°,{' '}
            {entry.ref_lon_deg.toFixed(4)}°E{' '}
            <a href={entry.source_url} target="_blank" rel="noreferrer">{t("(source)")}</a>
          </p>
        )}
      </div>
      {isSynthetic(entry) && (
        <div className="badge badge-warn badge-lg" role="note"> {t("SYNTHETIC dev data — not real")} </div>
      )}
    </header>
  );
}

function SiteView({ site, landingUtc, onLanding }: { site: SiteData; landingUtc: string; onLanding: (t: string) => void }) {
  const { missionDays, assumptions, cursorH, setCursorH, setPlaying } = useApp(useShallow((s) => ({ missionDays: s.missionDays, assumptions: s.assumptions, cursorH: s.cursorH, setCursorH: s.setCursorH, setPlaying: s.setPlaying })));
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
      <ErrorBox title={t("Landing time outside data coverage")}>
        <p> {t("Ephemeris covers")} {fmtUtc(c0)} {t("to")} {fmtUtc(c1)}{t(". Pick a landing time so the whole")} {missionDays}{t("-day mission fits.")} </p>
        <button type="button" className="btn" onClick={() => onLanding(isoHour(Math.min(Math.max(landMs, c0), c1 - missionH * HOUR_MS)))}> {t("Move into range")} </button>
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
          <h2 className="card-title">{t("30-day timeline")}</h2>
          <span className="muted small">{t("Click inside the window to scrub, outside to move the landing")}</span>
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
