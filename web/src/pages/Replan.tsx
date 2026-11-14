import { useDeferredValue, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RankedOption, ReplanInput } from '../lib/types';
import { rankAlternatives } from '../lib/score';
import { useApp } from '../state';
import { useSites, useSitesData } from '../components/hooks';
import { ErrorBox, Loading, Empty } from '../components/Status';
import ReplanForm from '../components/ReplanForm';
import RankingTable from '../components/RankingTable';
import { fmtUtc, HOUR_MS, isoShort } from '../components/format';

export default function Replan() {
  const sites = useSites();
  const { replan, setReplan, assumptions, setMissionDays } = useApp();
  const navigate = useNavigate();
  const list = sites.data ?? [];
  const allIds = list.map((s) => s.id);
  const data = useSitesData(allIds);

  const deferred = useDeferredValue(replan);
  const stale = deferred !== replan;

  const result = useMemo(() => {
    if (!data.data) return null;
    const ids = deferred.siteIds.length ? deferred.siteIds : allIds;
    const input: ReplanInput = { ...deferred, siteIds: ids };
    const t0 = performance.now();
    try {
      const allHave = ids.every((id) => {
        const s = data.data!.get(id);
        return !s || String(assumptions.heightM) in s.horizon.elev_cdeg;
      });
      const out = rankAlternatives(data.data, list, input, allHave ? assumptions : { ...assumptions, heightM: 2 });
      return { out, ms: performance.now() - t0, error: null as Error | null };
    } catch (e) {
      return { out: [] as RankedOption[], ms: 0, error: e instanceof Error ? e : new Error(String(e)) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, deferred, assumptions]);

  if (sites.loading) return <Loading />;
  if (sites.error) return <ErrorBox error={sites.error} title="Site index not available" />;
  if (!list.length) return <Empty title="No sites published yet" />;

  const center = Date.parse(replan.originalUtc) + replan.delayDays * 24 * HOUR_MS;
  const from = center - replan.toleranceDays * 24 * HOUR_MS;
  const to = center + replan.toleranceDays * 24 * HOUR_MS;
  const nSites = replan.siteIds.length || list.length;
  const nCand = nSites * (Math.floor((to - from) / (replan.stepH * HOUR_MS)) + 1);

  const view = (o: RankedOption) => {
    setMissionDays(replan.missionDays);
    navigate(`/?site=${encodeURIComponent(o.siteId)}&t=${isoShort(o.landingUtc)}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow eyebrow-warn">Mission delayed</div>
          <h1>Find the best new landing</h1>
          <p className="muted">
            Every site × every candidate landing time in the new window is scored with the same metrics engine as the panorama. Adjust weights and
            filters — the ranking updates instantly.
          </p>
        </div>
      </header>

      <div className="replan">
        <section className="card replan-side">
          <ReplanForm form={replan} sites={list} onChange={setReplan} />
        </section>

        <section className="replan-main">
          <div className="card search-summary">
            <div>
              <div className="ss-label">Search window</div>
              <div className="ss-value mono">
                {fmtUtc(from)} → {fmtUtc(to)}
              </div>
            </div>
            <div>
              <div className="ss-label">Candidates</div>
              <div className="ss-value mono">
                {nCand.toLocaleString('en-US')} <span className="unit">({nSites} sites, every {replan.stepH} h)</span>
              </div>
            </div>
            <div>
              <div className="ss-label">Evaluated in</div>
              <div className="ss-value mono">{result ? `${result.ms.toFixed(0)} ms` : '…'}</div>
            </div>
          </div>

          {data.loading && <Loading label={`Loading ${list.length} sites…`} />}
          {data.error && <ErrorBox error={data.error} />}
          {result?.error && <ErrorBox error={result.error} title="Ranking failed" />}
          {result && !result.error && (
            <div className={stale ? 'is-stale' : ''}>
              {result.out.length ? (
                <RankingTable options={result.out} index={list} onView={view} />
              ) : (
                <Empty title="No option passes the filters">
                  <p className="muted">Relax the minimum sunlight / Earth visibility, allow a steeper slope, or widen the tolerance.</p>
                </Empty>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
