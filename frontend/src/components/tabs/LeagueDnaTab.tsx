import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import type { SeasonTransactionsState } from '../../hooks/useSeasonTransactions';
import type { LeagueHistoryState } from '../../hooks/useLeagueHistory';
import { buildLeagueDna, type ManagerProfile, type SeasonDraftData } from '../../lib/leagueDna';
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
  history,
}: {
  data: LeagueData;
  draftPicks: DraftPicksState;
  transactions: SeasonTransactionsState;
  history: LeagueHistoryState;
}) {
  const draftSeasons: SeasonDraftData[] = useMemo(() => {
    const current: SeasonDraftData = { season: data.league.season, rosters: data.rosters, draftPicks: draftPicks.picks };
    const prior: SeasonDraftData[] = history.seasons.map((s) => ({ season: s.league.season, rosters: s.rosters, draftPicks: s.draftPicks }));
    return [current, ...prior];
  }, [data.league.season, data.rosters, draftPicks.picks, history.seasons]);

  const profiles = useMemo(
    () =>
      buildLeagueDna({
        league: data.league,
        rosters: data.rosters,
        users: data.users,
        draftSeasons,
        transactionsByWeek: transactions.transactionsByWeek,
      }),
    [data.league, data.rosters, data.users, draftSeasons, transactions.transactionsByWeek],
  );

  const isFaabLeague = (data.league.settings.waiver_budget ?? 0) > 0;
  const seasonsFetched = draftSeasons.length;

  const columns: Column<ManagerProfile>[] = [
    { key: 'team', header: 'Team', accessor: (p) => p.teamName },
    {
      key: 'draftSample',
      header: 'Draft Picks (sample)',
      accessor: (p) => p.draftSampleSize,
      align: 'right',
      render: (p) => `${p.draftSampleSize} across ${p.seasonsOfDraftHistory} season${p.seasonsOfDraftHistory === 1 ? '' : 's'}`,
    },
    { key: 'moves', header: 'Total Moves (this season)', accessor: (p) => p.totalMoves ?? -1, align: 'right', render: (p) => p.totalMoves ?? '—' },
    { key: 'trades', header: 'Trades (this season)', accessor: (p) => p.tradesCount, align: 'right', render: (p) => `${p.tradesCount} (${p.tradesPercentile}th pctile)` },
    ...(isFaabLeague
      ? [
          {
            key: 'faab',
            header: 'FAAB Spent (this season)',
            accessor: (p: ManagerProfile) => p.faabSpentPct ?? -1,
            align: 'right' as const,
            render: (p: ManagerProfile) => (p.faabSpentPct != null ? `${p.faabSpentPct}% (${p.faabPercentile}th pctile)` : '—'),
          },
        ]
      : []),
  ];

  const loading = draftPicks.loading || transactions.loading || history.loading;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          subtitle={`Draft tendencies are pooled across ${seasonsFetched} season${seasonsFetched === 1 ? '' : 's'} of real draft data (Franchise History's previous_league_id walk). Trade/waiver/FAAB activity is this season only. No ADP, no external market comparison anywhere here - only this league's own data.`}
        >
          League DNA
        </CardTitle>
        {loading && <p className="mb-3 text-xs text-slate-500">Loading draft and transaction history…</p>}
        {draftPicks.error && <p className="mb-3 text-xs text-rose-400">{draftPicks.error}</p>}
        {transactions.error && <p className="mb-3 text-xs text-rose-400">{transactions.error}</p>}
        {history.error && <p className="mb-3 text-xs text-rose-400">{history.error}</p>}
        <DataTable rows={profiles} columns={columns} rowKey={(p) => p.ownerId} defaultSortKey="trades" />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles
          .filter((p) => p.positionTendencies.length > 0)
          .map((p) => (
            <Card key={p.ownerId}>
              <CardTitle subtitle={`Based on ${p.draftSampleSize} picks across ${p.seasonsOfDraftHistory} season${p.seasonsOfDraftHistory === 1 ? '' : 's'}`}>
                {p.teamName}
              </CardTitle>
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
