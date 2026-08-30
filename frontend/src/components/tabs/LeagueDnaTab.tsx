import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import type { SeasonTransactionsState } from '../../hooks/useSeasonTransactions';
import { buildLeagueDna, type ManagerProfile } from '../../lib/leagueDna';
import { Card, CardTitle } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

function fmtDelta(d: number): string {
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)} rounds`;
}

export function LeagueDnaTab({
  data,
  draftPicks,
  transactions,
}: {
  data: LeagueData;
  draftPicks: DraftPicksState;
  transactions: SeasonTransactionsState;
}) {
  const profiles = useMemo(
    () =>
      buildLeagueDna({
        league: data.league,
        rosters: data.rosters,
        users: data.users,
        draftPicks: draftPicks.picks,
        transactionsByWeek: transactions.transactionsByWeek,
      }),
    [data.league, data.rosters, data.users, draftPicks.picks, transactions.transactionsByWeek],
  );

  const isFaabLeague = (data.league.settings.waiver_budget ?? 0) > 0;

  const columns: Column<ManagerProfile>[] = [
    { key: 'team', header: 'Team', accessor: (p) => p.teamName },
    { key: 'draftSample', header: 'Draft Picks (sample)', accessor: (p) => p.draftSampleSize, align: 'right' },
    { key: 'moves', header: 'Total Moves', accessor: (p) => p.totalMoves ?? -1, align: 'right', render: (p) => p.totalMoves ?? '—' },
    { key: 'trades', header: 'Trades', accessor: (p) => p.tradesCount, align: 'right', render: (p) => `${p.tradesCount} (${p.tradesPercentile}th pctile)` },
    ...(isFaabLeague
      ? [
          {
            key: 'faab',
            header: 'FAAB Spent',
            accessor: (p: ManagerProfile) => p.faabSpentPct ?? -1,
            align: 'right' as const,
            render: (p: ManagerProfile) => (p.faabSpentPct != null ? `${p.faabSpentPct}% (${p.faabPercentile}th pctile)` : '—'),
          },
        ]
      : []),
  ];

  const loading = draftPicks.loading || transactions.loading;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Every number here comes from this season's real draft and transaction data only - no ADP, no external market comparison, no multi-season history (not fetched). Small early-season samples are labeled, not hidden.">
          League DNA
        </CardTitle>
        {loading && <p className="mb-3 text-xs text-slate-500">Loading draft and transaction history…</p>}
        {draftPicks.error && <p className="mb-3 text-xs text-rose-400">{draftPicks.error}</p>}
        {transactions.error && <p className="mb-3 text-xs text-rose-400">{transactions.error}</p>}
        <DataTable rows={profiles} columns={columns} rowKey={(p) => String(p.rosterId)} defaultSortKey="trades" />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles
          .filter((p) => p.positionTendencies.length > 0)
          .map((p) => (
            <Card key={p.rosterId}>
              <CardTitle subtitle={`Based on ${p.draftSampleSize} picks this draft`}>{p.teamName}</CardTitle>
              <div className="space-y-1.5">
                {p.positionTendencies.slice(0, 4).map((t) => (
                  <div key={t.position} className="flex items-center justify-between text-sm">
                    <Badge color={t.deltaRounds > 0 ? 'green' : t.deltaRounds < 0 ? 'orange' : 'gray'}>{t.position}</Badge>
                    <span className={t.deltaRounds > 0 ? 'text-emerald-400' : t.deltaRounds < 0 ? 'text-amber-400' : 'text-slate-400'}>
                      {fmtDelta(t.deltaRounds)} {t.deltaRounds > 0 ? 'earlier' : t.deltaRounds < 0 ? 'later' : ''} than league avg
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
      </div>

      {profiles.every((p) => p.positionTendencies.length === 0) && (
        <Card>
          <p className="text-slate-400">No draft-pick position data available yet for this league (draft may not have happened, or position metadata is missing from the picks).</p>
        </Card>
      )}
    </div>
  );
}
