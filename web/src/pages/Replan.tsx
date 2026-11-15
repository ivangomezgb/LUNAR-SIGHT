import { t } from '../i18n';
import AssumptionsPanel from '../components/AssumptionsPanel';
import { useDeferredValue, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RankedOption, ReplanInput } from '../lib/types';
import { rankAlternatives } from '../lib/score';
import { useApp } from '../state';
import { useShallow } from 'zustand/react/shallow';
import { useSites, useSitesData } from '../components/hooks';
import { ErrorBox, Loading, Empty } from '../components/Status';
import ReplanForm from '../components/ReplanForm';
import RankingTable from '../components/RankingTable';
import { fmtUtc, fmtInt, HOUR_MS, isoShort } from '../components/format';

export default function Replan() {
  const sites = useSites();
  const { replan, setReplan, assumptions, setMissionDays, siteId } = useApp(useShallow((s) => ({ replan: s.replan, setReplan: s.setReplan, assumptions: s.assumptions, setMissionDays: s.setMissionDays, siteId: s.siteId })));
  const navigate = useNavigate();
  const list = sites.data ?? [];
  const allIds = list.map((s) => s.id);
  // The baseline of every "vs original plan" reason: explicit choice, else the site open in Explore.
  const originalSiteId = [replan.originalSiteId, siteId].find((id) => id && allIds.includes(id)) ?? allIds[0] ?? '';
  const data = useSitesData(allIds);

  const deferred = useDeferredValue(replan);
  const stale = deferred !== replan;

  const result = useMemo(() => {
    if (!data.data) return null;
    const ids = deferred.siteIds.length ? deferred.siteIds : allIds;
    const input: ReplanInput = { ...deferred, originalSiteId, siteIds: ids };
    const t0 = performance.now();
    try {
      const missing = ids.filter((id) => {
        const site = data.data!.get(id);
        return site && !(String(assumptions.heightM) in site.horizon.elev_cdeg);
      });
      if (missing.length) throw new Error(t('Selected height is unavailable for: {0}', { 0: missing.join(', ') }));
      const out = rankAlternatives(data.data, list, input, assumptions);
      return { out, ms: performance.now() - t0, error: null as Error | null };
    } catch (e) {
      return { out: [] as RankedOption[], ms: 0, error: e instanceof Error ? e : new Error(String(e)) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, deferred, assumptions, originalSiteId]);

  if (sites.loading) return <Loading />;
  if (sites.error) return <ErrorBox error={sites.error} title={t("Site index not available")} />;
  if (!list.length) return <Empty title={t("No sites published yet")} />;

  const center = Date.parse(replan.originalUtc) + replan.delayDays * 24 * HOUR_MS;
  const from = center - replan.toleranceDays * 24 * HOUR_MS;
  const to = center + replan.toleranceDays * 24 * HOUR_MS;
  const nSites = replan.siteIds.length || list.length;
  const nCand = nSites * (Math.floor((to - from) / (replan.stepH * HOUR_MS)) + 1);

  const view = (o: RankedOption) => {
    setMissionDays(replan.missionDays);
    navigate(`/?site=${encodeURIComponent(o.siteId)}&t=${isoShort(o.landingUtc)}&h=${assumptions.heightM}&lang=${useApp.getState().lang}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow eyebrow-warn">{t("Mission delayed")}</div>
          <h1>{t("Find the best new landing")}</h1>
          <p className="muted"> {t("Every site × every candidate landing time in the new window is scored with the same metrics engine as the panorama. Adjust weights and filters — the ranking updates instantly.")} </p>
        </div>
      </header>

      <div className="replan">
        <section className="card replan-side">
          <AssumptionsPanel heights={[1, 2, 5, 10]} />
          <ReplanForm form={replan} originalSiteId={originalSiteId} sites={list} onChange={setReplan} />
        </section>

        <section className="replan-main">
          <div className="card search-summary">
            <div>
              <div className="ss-label">{t("Search window")}</div>
              <div className="ss-value mono">
                {fmtUtc(from)} → {fmtUtc(to)}
              </div>
            </div>
            <div>
              <div className="ss-label">{t("Candidates")}</div>
              <div className="ss-value mono">
                {fmtInt(nCand)} <span className="unit">({nSites} {t("sites, every")} {replan.stepH} h)</span>
              </div>
            </div>
            <div>
              <div className="ss-label">{t("Evaluated in")}</div>
              <div className="ss-value mono">{result ? `${result.ms.toFixed(0)} ms` : '…'}</div>
            </div>
          </div>

          {data.loading && <Loading label={t("Loading {0} sites…", { 0: list.length })} />}
          {data.error && <ErrorBox error={data.error} />}
          {result?.error && <ErrorBox error={result.error} title={t("Ranking failed")} />}
          {result && !result.error && (
            <div className={stale ? 'is-stale' : ''}>
              {result.out.length ? (
                <RankingTable options={result.out} index={list} onView={view} sites={data.data ?? undefined} assumptions={assumptions} />
              ) : (
                <Empty title={t("No option passes the filters")}>
                  <p className="muted">{t("Relax the minimum sunlight / Earth visibility, allow a steeper slope, or widen the tolerance.")}</p>
                </Empty>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
