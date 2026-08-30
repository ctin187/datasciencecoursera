import type { LeagueHistoryState } from '../../hooks/useLeagueHistory';
import { Card, CardTitle } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

interface SeasonRow {
  season: string;
  leagueName: string;
  champion: string;
  runnerUp: string;
  yourFinish: string;
  bracketAvailable: boolean;
}

export function FranchiseHistoryTab({ history, userId }: { history: LeagueHistoryState; userId: string }) {
  if (history.loading) {
    return (
      <Card>
        <p className="text-center text-slate-400">Walking this league's season history…</p>
      </Card>
    );
  }

  if (history.error) {
    return (
      <Card className="border-rose-800">
        <p className="text-rose-300">{history.error}</p>
      </Card>
    );
  }

  if (history.seasons.length === 0) {
    return (
      <Card>
        <CardTitle>Franchise History</CardTitle>
        <p className="text-slate-400">No prior seasons found for this league (it may be the first season, or a fresh non-dynasty league that isn't chained to a prior one via Sleeper's own league-history link).</p>
      </Card>
    );
  }

  const rows: SeasonRow[] = history.seasons.map((s) => {
    const userById = new Map(s.users.map((u) => [u.user_id, u]));
    const teamName = (rosterId: number | null) => {
      if (rosterId == null) return '—';
      const r = s.rosters.find((x) => x.roster_id === rosterId);
      const owner = r?.owner_id ? userById.get(r.owner_id) : undefined;
      return owner?.metadata?.team_name || owner?.display_name || `Roster ${rosterId}`;
    };

    const standings = [...s.rosters].sort((a, b) => (b.settings.wins ?? 0) - (a.settings.wins ?? 0) || (b.settings.fpts ?? 0) - (a.settings.fpts ?? 0));
    const yourRoster = userId ? s.rosters.find((r) => r.owner_id === userId) : undefined;
    const yourRank = yourRoster ? standings.findIndex((r) => r.roster_id === yourRoster.roster_id) + 1 : null;

    return {
      season: s.league.season,
      leagueName: s.league.name,
      champion: s.championRosterId != null ? teamName(s.championRosterId) : `${teamName(standings[0]?.roster_id ?? null)} (best record, bracket unavailable)`,
      runnerUp: s.runnerUpRosterId != null ? teamName(s.runnerUpRosterId) : '—',
      yourFinish: yourRank ? `#${yourRank} of ${standings.length} (${yourRoster!.settings.wins}-${yourRoster!.settings.losses})` : 'not in this league that season',
      bracketAvailable: s.championRosterId != null,
    };
  });

  const columns: Column<SeasonRow>[] = [
    { key: 'season', header: 'Season', accessor: (r) => r.season },
    { key: 'league', header: 'League Name', accessor: (r) => r.leagueName },
    {
      key: 'champion',
      header: 'Champion',
      accessor: (r) => r.champion,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {r.bracketAvailable && <Badge color="purple">🏆</Badge>}
          {r.champion}
        </span>
      ),
    },
    { key: 'runnerUp', header: 'Runner-up', accessor: (r) => r.runnerUp },
    { key: 'yourFinish', header: 'Your Finish', accessor: (r) => r.yourFinish },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Walked from Sleeper's own previous_league_id chain, bounded to the last few seasons to keep the request count reasonable. Champion/runner-up come from the season's winners_bracket where available; older or non-standard leagues fall back to best regular-season record, labeled as such.">
          Franchise History
        </CardTitle>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.season} defaultSortKey="season" />
      </Card>
    </div>
  );
}
