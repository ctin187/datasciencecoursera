import type { LeagueData } from '../../hooks/useLeagueData';
import type { TradeValueEntry } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { resolvePlayerValue } from '../../lib/playerValue';

function scoringFormatLabel(scoring: Record<string, number>): string {
  const rec = scoring.rec ?? 0;
  if (rec === 1) return 'Full PPR';
  if (rec === 0.5) return 'Half PPR';
  if (rec === 0) return 'Standard (no PPR)';
  return `${rec} pt/reception`;
}

interface RosterRow {
  rosterId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  faabUsed: number;
  faabRemaining: number;
}

export function LeagueSettingsTab({
  data,
  userId,
  tradeValueMap,
}: {
  data: LeagueData;
  userId: string;
  tradeValueMap: Map<string, TradeValueEntry>;
}) {
  const { league, rosters, users, players } = data;
  const startingBudget = league.settings.waiver_budget ?? 0;

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterRows: RosterRow[] = rosters
    .map((r) => {
      const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
      const teamName = owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`;
      const faabUsed = r.settings.waiver_budget_used ?? 0;
      return {
        rosterId: r.roster_id,
        teamName,
        wins: r.settings.wins ?? 0,
        losses: r.settings.losses ?? 0,
        ties: r.settings.ties ?? 0,
        fpts: r.settings.fpts ?? 0,
        faabUsed,
        faabRemaining: startingBudget - faabUsed,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

  const columns: Column<RosterRow>[] = [
    { key: 'teamName', header: 'Team', accessor: (r) => r.teamName },
    { key: 'record', header: 'Record', accessor: (r) => r.wins, render: (r) => `${r.wins}-${r.losses}-${r.ties}`, align: 'center' },
    { key: 'fpts', header: 'Points For', accessor: (r) => r.fpts, align: 'right' },
    { key: 'faabUsed', header: 'FAAB Used', accessor: (r) => r.faabUsed, align: 'right' },
    {
      key: 'faabRemaining',
      header: 'FAAB Remaining',
      accessor: (r) => r.faabRemaining,
      align: 'right',
      render: (r) => (
        <span className={r.faabRemaining < startingBudget * 0.2 ? 'text-rose-400' : 'text-emerald-400'}>
          ${r.faabRemaining}
        </span>
      ),
    },
  ];

  const myRoster = userId ? rosters.find((r) => r.owner_id === userId) : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>League Overview</CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatTile label="League" value={league.name} />
          <StatTile label="Season" value={league.season} />
          <StatTile label="Teams" value={league.total_rosters} />
          <StatTile label="Scoring" value={scoringFormatLabel(league.scoring_settings)} />
          <StatTile label="Status" value={<Badge color="purple">{league.status.replace('_', ' ')}</Badge>} />
          <StatTile label="FAAB Budget" value={`$${startingBudget}`} />
          <StatTile label="Playoff Teams" value={league.settings.playoff_teams ?? '—'} />
          <StatTile label="Playoff Start Wk" value={league.settings.playoff_week_start ?? '—'} />
          <StatTile label="Trade Deadline Wk" value={league.settings.trade_deadline ?? '—'} />
          <StatTile label="Taxi Slots" value={league.settings.taxi_slots ?? 0} />
          <StatTile label="IR Slots" value={league.settings.reserve_slots ?? 0} />
          <StatTile label="Roster Spots" value={league.roster_positions.length} />
        </div>
      </Card>

      <Card>
        <CardTitle subtitle="Non-QB/RB/WR/TE/FLEX/BN entries are omitted for brevity.">Roster Positions</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {league.roster_positions.map((pos, i) => (
            <Badge key={i} color={pos === 'BN' ? 'gray' : pos === 'FLEX' || pos.includes('FLEX') ? 'blue' : 'green'}>
              {pos}
            </Badge>
          ))}
        </div>
      </Card>

      {myRoster && (
        <Card>
          <CardTitle>Your Roster</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {(myRoster.players ?? []).map((id) => {
              const p = players[id];
              if (!p) return null;
              const resolved = resolvePlayerValue(id, players, tradeValueMap);
              return (
                <Badge key={id} color={resolved.consensusValue >= 6000 ? 'purple' : 'gray'}>
                  {p.full_name || `${p.first_name} ${p.last_name}`} · {p.position}
                  {p.age ? ` · ${p.age}y` : ''}
                </Badge>
              );
            })}
            {(myRoster.players ?? []).length === 0 && <p className="text-sm text-slate-500">No players rostered yet.</p>}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Teams — Record & FAAB</CardTitle>
        <DataTable rows={rosterRows} columns={columns} rowKey={(r) => String(r.rosterId)} defaultSortKey="fpts" />
      </Card>
    </div>
  );
}
