import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { WaiverTargetsState } from '../../hooks/useWaiverTargets';
import type { ProjectionPoolState } from '../../hooks/useProjectionPool';
import type { SeasonTransactionsState } from '../../hooks/useSeasonTransactions';
import type { BenchPlayer, WaiverTarget } from '../../services/backendApi';
import { extractFaabHistory, computeRateDistribution, suggestBid } from '../../lib/faabModel';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { Meter } from '../ui/Meter';

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/** Presentation-only: scales a VOR/gm score onto the Meter's 0-100 fill. Not a real bounded metric - just a visual proportional to the same number shown next to it. */
function vorToMeterFill(vor: number | null): number {
  return Math.max(0, Math.min(100, (vor ?? 0) * 9));
}

function directionBadge(direction: 'rising' | 'falling' | 'stable' | null) {
  if (direction === 'rising') return <Badge color="green">↑ rising usage</Badge>;
  if (direction === 'falling') return <Badge color="red">↓ falling usage</Badge>;
  if (direction === 'stable') return <Badge color="gray">stable usage</Badge>;
  return <Badge color="gray">usage trend n/a</Badge>;
}

export function WaiverWireTab({
  data,
  userId,
  waivers,
  pool,
  faab,
}: {
  data: LeagueData;
  userId: string;
  waivers: WaiverTargetsState;
  pool: ProjectionPoolState;
  faab: SeasonTransactionsState;
}) {
  const isFaabLeague = (data.league.settings.waiver_budget ?? 0) > 0;
  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;
  const myBudgetRemaining = myRoster ? (data.league.settings.waiver_budget ?? 0) - (myRoster.settings.waiver_budget_used ?? 0) : null;

  const vorLookup = useMemo(() => {
    const m = new Map<string, { name: string | null; vorPerGame: number | null }>();
    for (const p of pool.bySleeperId.values()) m.set(p.sleeperId, { name: p.name, vorPerGame: p.vorPerGame });
    return m;
  }, [pool.bySleeperId]);

  const faabHistory = useMemo(
    () => (isFaabLeague ? extractFaabHistory(faab.transactionsByWeek, vorLookup) : []),
    [faab.transactionsByWeek, vorLookup, isFaabLeague],
  );
  const faabDistribution = useMemo(() => computeRateDistribution(faabHistory), [faabHistory]);

  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const faabSpendByTeam = useMemo(() => {
    return data.rosters
      .map((r) => {
        const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
        return {
          rosterId: r.roster_id,
          teamName: owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`,
          spent: r.settings.waiver_budget_used ?? 0,
          remaining: (data.league.settings.waiver_budget ?? 0) - (r.settings.waiver_budget_used ?? 0),
        };
      })
      .sort((a, b) => b.spent - a.spent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rosters]);

  if (!waivers.backendConfigured) {
    return (
      <Card>
        <CardTitle>Waiver Wire</CardTitle>
        <p className="text-slate-400">
          The analytics backend isn't configured, so waiver targets can't be ranked. Nothing is fabricated in its place.
        </p>
      </Card>
    );
  }

  if (waivers.loading) {
    return (
      <Card>
        <p className="text-center text-slate-400">Ranking free agents by value over replacement…</p>
      </Card>
    );
  }

  if (waivers.error) {
    return (
      <Card className="border-rose-800">
        <p className="text-rose-300">{waivers.error}</p>
      </Card>
    );
  }

  if (!waivers.result) return null;

  const { result } = waivers;

  const columns: Column<WaiverTarget>[] = [
    { key: 'name', header: 'Player', accessor: (t) => t.name ?? t.sleeper_id, render: (t) => (
      <span>{t.name ?? t.sleeper_id} <span className="text-slate-500">({t.position ?? '?'}{t.team ? ` · ${t.team}` : ''})</span></span>
    ) },
    { key: 'proj', header: 'Proj pts/gm', accessor: (t) => t.projected_points_per_game ?? -999, align: 'right', render: (t) => fmt(t.projected_points_per_game) },
    {
      key: 'vor',
      header: 'VOR/gm',
      accessor: (t) => t.vor_per_game ?? -999,
      align: 'right',
      render: (t) => (
        <span className={(t.vor_per_game ?? -1) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {t.vor_per_game != null ? `${t.vor_per_game >= 0 ? '+' : ''}${fmt(t.vor_per_game)}` : t.reason ?? '—'}
        </span>
      ),
    },
    {
      key: 'upgrade',
      header: 'Upgrade Over Your Weakest Starter',
      accessor: (t) => t.upgrade_over_weakest_starter ?? -999,
      align: 'right',
      render: (t) => (
        <span className={(t.upgrade_over_weakest_starter ?? -1) > 0 ? 'font-semibold text-violet-300' : 'text-slate-500'}>
          {t.upgrade_over_weakest_starter != null ? `${t.upgrade_over_weakest_starter >= 0 ? '+' : ''}${fmt(t.upgrade_over_weakest_starter)}` : '—'}
        </span>
      ),
    },
    { key: 'trend', header: 'Usage Trend', accessor: (t) => t.usage?.direction ?? '', align: 'center', render: (t) => directionBadge(t.usage?.direction ?? null) },
    ...(isFaabLeague && faabDistribution
      ? [
          {
            key: 'faab',
            header: 'Suggested FAAB Bid',
            accessor: (t: WaiverTarget) => t.vor_per_game ?? -999,
            align: 'right' as const,
            render: (t: WaiverTarget) => {
              if (t.vor_per_game == null || t.vor_per_game <= 0) return <span className="text-slate-600">—</span>;
              const s = suggestBid(t.vor_per_game, faabDistribution, myBudgetRemaining);
              return <span className="font-semibold text-amber-400">${s.low}–${s.high} <span className="text-slate-500">(mid ${s.mid})</span></span>;
            },
          },
        ]
      : []),
  ];

  const benchColumns: Column<BenchPlayer>[] = [
    { key: 'name', header: 'Bench Player', accessor: (b) => b.name ?? b.sleeper_id, render: (b) => (
      <span>{b.name ?? b.sleeper_id} <span className="text-slate-500">({b.position ?? '?'})</span></span>
    ) },
    { key: 'vor', header: 'VOR/gm', accessor: (b) => b.vor_per_game ?? -999, align: 'right', render: (b) => (
      <span className={b.below_replacement ? 'text-rose-400' : 'text-emerald-400'}>{b.vor_per_game != null ? fmt(b.vor_per_game) : '—'}</span>
    ) },
    { key: 'status', header: 'Status', accessor: (b) => (b.below_replacement ? 1 : 0), align: 'center', render: (b) => (b.below_replacement ? <Badge color="red">Below replacement — drop candidate</Badge> : <Badge color="green">Roster-worthy</Badge>) },
  ];

  const topTarget = result.targets[0];

  return (
    <div className="space-y-3">
      {topTarget && (
        <Card>
          <div className="min-w-0">
            <div className="stat-label">Top Waiver Target</div>
            <div className="num mt-0.5 truncate text-lg font-semibold text-slate-100">
              {topTarget.name ?? topTarget.sleeper_id}
            </div>
            <div className="mt-1.5">
              <Meter
                value={vorToMeterFill(topTarget.vor_per_game)}
                displayValue={topTarget.vor_per_game != null ? `${topTarget.vor_per_game >= 0 ? '+' : ''}${fmt(topTarget.vor_per_game)} VOR/gm` : '—'}
                tone={(topTarget.vor_per_game ?? 0) > 0 ? 'positive' : 'negative'}
                sublabel={topTarget.position ?? undefined}
              />
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle
          subtitle={`Season ${result.season}, as of week ${result.as_of_week}, ${result.games_remaining} games remaining. Ranked by value over this league's actual replacement level — not a generic "best player available" list.`}
        >
          Waiver Radar ({result.count})
        </CardTitle>
        <p className="mb-3 text-xs text-slate-500">{result.methodology}</p>
        <DataTable rows={result.targets} columns={columns} rowKey={(t) => t.sleeper_id} defaultSortKey="vor" maxHeight={640} />
        <p className="mt-3 text-xs text-slate-600">
          "Upgrade over your weakest starter" is a value comparison, not a bid amount.
          {isFaabLeague && !faabDistribution && ' Not enough historical FAAB bids in this league yet to suggest bid ranges.'}
        </p>
      </Card>

      {isFaabLeague && faabDistribution && (
        <Card>
          <CardTitle
            subtitle={`Derived from ${faabDistribution.n} real winning FAAB bids this season, joined against each added player's CURRENT value over replacement (value at the time of the add isn't recoverable from Sleeper's API, so this is an approximation). No win-probability is claimed — only a real $-per-VOR-point rate and its spread.`}
          >
            FAAB Market Rate (this league)
          </CardTitle>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="25th percentile" value={`$${faabDistribution.p25.toFixed(1)}/VOR`} />
            <StatTile label="Median" value={`$${faabDistribution.p50.toFixed(1)}/VOR`} />
            <StatTile label="75th percentile" value={`$${faabDistribution.p75.toFixed(1)}/VOR`} />
          </div>
          {myBudgetRemaining !== null && (
            <div className="mt-4">
              <Meter
                label="Your FAAB Remaining"
                value={((data.league.settings.waiver_budget ?? 1) > 0 ? myBudgetRemaining / (data.league.settings.waiver_budget ?? 1) : 0) * 100}
                displayValue={`$${myBudgetRemaining}`}
                tone={myBudgetRemaining > (data.league.settings.waiver_budget ?? 0) * 0.3 ? 'positive' : 'warning'}
              />
              <p className="mt-2 text-xs text-slate-500">Every suggested bid above is capped at this.</p>
            </div>
          )}
        </Card>
      )}

      {isFaabLeague && (
        <Card>
          <CardTitle>FAAB Spend by Team</CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {faabSpendByTeam.map((t) => (
              <StatTile key={t.rosterId} label={t.teamName} value={`$${t.spent} spent`} hint={`$${t.remaining} remaining`} />
            ))}
          </div>
        </Card>
      )}

      {result.bench_ranked.length > 0 && (
        <Card>
          <CardTitle subtitle="Your own bench, ranked the same way — a below-replacement bench player next to a strong waiver target is a real drop/add candidate.">
            Your Bench
          </CardTitle>
          <DataTable rows={result.bench_ranked} columns={benchColumns} rowKey={(b) => b.sleeper_id} defaultSortKey="vor" />
        </Card>
      )}
    </div>
  );
}
