import type { LeagueData } from '../../hooks/useLeagueData';
import { detectLeagueConfig } from '../../lib/leagueConfig';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

interface RosterRow {
  rosterId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fptsAgainst: number;
  faabUsed: number;
  faabRemaining: number;
}

const LEAGUE_TYPE_LABEL: Record<string, string> = {
  redraft: 'Redraft',
  keeper: 'Keeper',
  dynasty: 'Dynasty',
  unknown: 'Unknown',
};

export function LeagueOverviewTab({ data, userId }: { data: LeagueData; userId: string }) {
  const { league, rosters, users, players, drafts } = data;
  const config = detectLeagueConfig(league, drafts);

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
        fptsAgainst: r.settings.fpts_against ?? 0,
        faabUsed,
        faabRemaining: (config.faabBudget ?? 0) - faabUsed,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

  const columns: Column<RosterRow>[] = [
    { key: 'teamName', header: 'Team', accessor: (r) => r.teamName },
    { key: 'record', header: 'Record', accessor: (r) => r.wins, render: (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`, align: 'center' },
    { key: 'fpts', header: 'Points For', accessor: (r) => r.fpts, align: 'right', render: (r) => r.fpts.toFixed(1) },
    { key: 'fptsAgainst', header: 'Points Against', accessor: (r) => r.fptsAgainst, align: 'right', render: (r) => r.fptsAgainst.toFixed(1) },
    ...(config.waiverSystem === 'faab'
      ? [
          {
            key: 'faabRemaining',
            header: 'FAAB Remaining',
            accessor: (r: RosterRow) => r.faabRemaining,
            align: 'right' as const,
            render: (r: RosterRow) => (
              <span className={r.faabRemaining < (config.faabBudget ?? 0) * 0.2 ? 'text-rose-400' : 'text-emerald-400'}>
                ${r.faabRemaining}
              </span>
            ),
          },
        ]
      : []),
  ];

  const myRoster = userId ? rosters.find((r) => r.owner_id === userId) : undefined;

  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>League Configuration (auto-detected from Sleeper)</CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatTile label="League" value={config.name} />
          <StatTile label="Season" value={config.season} />
          <StatTile label="Teams" value={config.totalTeams} />
          <StatTile label="Status" value={<Badge color="purple">{config.status.replace('_', ' ')}</Badge>} />
          <StatTile
            label="League Type"
            value={LEAGUE_TYPE_LABEL[config.leagueType]}
            hint={config.leagueTypeConfidence === 'inferred' ? 'inferred, not directly reported' : undefined}
          />
          <StatTile label="Scoring" value={config.pprLabel} />
          <StatTile label="QB Format" value={config.qbFormatLabel} />
          <StatTile
            label="TE Premium"
            value={config.tePremiumBonus ? `+${config.tePremiumBonus}/rec` : 'None'}
          />
          <StatTile label="Waivers" value={config.waiverSystem === 'faab' ? 'FAAB' : 'Non-FAAB'} />
          {config.waiverSystem === 'faab' && <StatTile label="FAAB Budget" value={`$${config.faabBudget}`} />}
          <StatTile label="Playoff Teams" value={config.playoffTeams ?? '—'} />
          <StatTile label="Playoff Start Wk" value={config.playoffWeekStart ?? '—'} />
          <StatTile label="Trade Deadline Wk" value={config.tradeDeadlineWeek ?? '—'} />
          <StatTile label="Bench Spots" value={config.benchSlots} />
          <StatTile label="IR Slots" value={config.irSlots} />
          <StatTile label="Taxi Slots" value={config.taxiSlots} />
          {config.draftType && <StatTile label="Draft Type" value={config.draftType} />}
          {config.draftStatus && <StatTile label="Draft Status" value={config.draftStatus} />}
          {config.draftRounds != null && <StatTile label="Draft Rounds" value={config.draftRounds} />}
          {config.format.usesIDP && <StatTile label="IDP" value={[...config.format.idpPositions].join('/')} />}
          {config.format.usesKicker && <StatTile label="Kicker" value="Yes" />}
        </div>
        <div className="mt-4 border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
          <p className="mb-1 font-semibold text-slate-400">How the league type & waiver system were determined:</p>
          <ul className="space-y-0.5">
            {config.leagueTypeSignals.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
            <li>• {config.waiverSystemNote}</li>
          </ul>
        </div>
      </Card>

      <Card>
        <CardTitle subtitle="Every starting/bench/reserve slot Sleeper reports for this league, in order.">Roster Positions</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {config.rosterPositions.map((pos, i) => (
            <Badge key={i} color={pos === 'BN' ? 'gray' : pos.includes('FLEX') ? 'blue' : pos === 'IR' ? 'red' : pos === 'TAXI' ? 'orange' : 'green'}>
              {pos}
            </Badge>
          ))}
        </div>
      </Card>

      {myRoster && (
        <Card>
          <CardTitle>Your Roster ({(myRoster.players ?? []).length} players)</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {(myRoster.players ?? []).map((id) => {
              const p = players[id];
              if (!p) return null;
              const isStarter = (myRoster.starters ?? []).includes(id);
              return (
                <Badge key={id} color={isStarter ? 'purple' : 'gray'}>
                  {p.full_name || `${p.first_name} ${p.last_name}`} · {p.position}
                  {p.age ? ` · ${p.age}y` : ''}
                  {p.injury_status ? ` · ${p.injury_status}` : ''}
                </Badge>
              );
            })}
            {(myRoster.players ?? []).length === 0 && <p className="text-sm text-slate-500">No players rostered yet.</p>}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Standings</CardTitle>
        <DataTable rows={rosterRows} columns={columns} rowKey={(r) => String(r.rosterId)} defaultSortKey="fpts" />
      </Card>
    </div>
  );
}
