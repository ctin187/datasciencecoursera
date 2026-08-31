import type { LeagueData } from '../../hooks/useLeagueData';
import type { RosterHealthState } from '../../hooks/useRosterHealth';
import type { StarterSlot, TeamReport, VorPlayer } from '../../services/backendApi';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

/**
 * One lineup slot, laid out as a fixed three-column grid so slot labels,
 * names and figures line up down the column instead of drifting apart on a
 * wide screen. Rows carry only a bottom rule - stacked full borders would
 * double up into a 2px ladder.
 */
function PlayerRow({ label, player, mismatch }: { label: string; player: VorPlayer | null; mismatch?: boolean | null }) {
  return (
    <div className="grid grid-cols-[44px_1fr_auto] items-center gap-2 border-b border-[color:var(--rule)] px-1 py-1 text-[12px] last:border-b-0">
      <span className="stat-label">{label}</span>
      {player ? (
        <>
          <span
            className={`truncate ${mismatch ? 'text-amber-400' : 'text-slate-200'}`}
            title={mismatch ? 'Slot/position mismatch reported by backend' : undefined}
          >
            {player.name ?? player.sleeper_id}{' '}
            <span className="text-slate-500">
              ({player.position ?? '?'}{player.team ? ` · ${player.team}` : ''})
            </span>
          </span>
          <span className="text-right text-[11px] whitespace-nowrap text-slate-400">
            {player.has_projection ? (
              <>
                <span className="num">{fmt(player.projected_points_per_game)}</span> pts/g
                <span
                  className={`num ml-2 font-semibold ${player.vor_per_game != null && player.vor_per_game >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {player.vor_per_game != null ? `${player.vor_per_game >= 0 ? '+' : ''}${fmt(player.vor_per_game)} VOR` : ''}
                </span>
              </>
            ) : (
              <span className="text-slate-600" title={player.reason ?? undefined}>
                no projection
              </span>
            )}
          </span>
        </>
      ) : (
        <>
          <span className="text-slate-600">Empty</span>
          <span />
        </>
      )}
    </div>
  );
}

export function RosterValueTab({ data, userId, health }: { data: LeagueData; userId: string; health: RosterHealthState }) {
  if (!health.backendConfigured) {
    return (
      <Card>
        <CardTitle>Roster Value (VOR)</CardTitle>
        <p className="text-slate-400">
          The analytics backend isn't configured (<code className="bg-slate-800 px-1 py-0.5">VITE_API_BASE_URL</code> is unset), so
          projections and value-over-replacement can't be computed. This tab intentionally shows nothing rather than a number it can't
          back up.
        </p>
      </Card>
    );
  }

  if (health.loading) {
    return (
      <Card>
        <p className="text-center text-slate-400">Computing value over replacement from real nflverse projections…</p>
      </Card>
    );
  }

  if (health.error) {
    return (
      <Card className="border-rose-800">
        <p className="text-rose-300">{health.error}</p>
      </Card>
    );
  }

  if (!health.result) return null;

  const { result } = health;
  const myTeam = userId ? result.teams.find((t) => t.roster_id === data.rosters.find((r) => r.owner_id === userId)?.roster_id) : undefined;

  const teamColumns: Column<TeamReport>[] = [
    { key: 'rank', header: '#', accessor: (t) => t.league_rank, align: 'center' },
    {
      key: 'team',
      header: 'Team',
      accessor: (t) => t.owner_name ?? `Roster ${t.roster_id}`,
      render: (t) => (
        <span className={t.roster_id === myTeam?.roster_id ? 'font-semibold text-violet-300' : ''}>
          {t.owner_name ?? `Roster ${t.roster_id}`}
        </span>
      ),
    },
    {
      key: 'vorPerGame',
      header: 'Starter VOR/gm',
      accessor: (t) => t.starter_vor_total_per_game,
      align: 'right',
      render: (t) => (
        <span className={t.starter_vor_total_per_game >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {t.starter_vor_total_per_game >= 0 ? '+' : ''}
          {fmt(t.starter_vor_total_per_game)}
        </span>
      ),
    },
    { key: 'vorRos', header: 'Starter VOR (rest of season)', accessor: (t) => t.starter_vor_rest_of_season, align: 'right', render: (t) => fmt(t.starter_vor_rest_of_season) },
    {
      key: 'coverage',
      header: 'Projection Coverage',
      accessor: (t) => t.starters_with_projection,
      align: 'right',
      render: (t) => `${t.starters_with_projection}/${t.starters_with_projection + t.starters_missing_projection}`,
    },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardTitle
          subtitle={`Season ${result.season}, as of week ${result.as_of_week} (latest cached: week ${result.latest_cached_week}). ${result.games_remaining} games remaining. Source: nflverse play-by-play + Sleeper roster data.`}
        >
          League Value Rankings (VOR)
        </CardTitle>
        <p className="mb-3 text-xs text-slate-500">{result.methodology}</p>
        <DataTable rows={result.teams} columns={teamColumns} rowKey={(t) => String(t.roster_id)} defaultSortKey="vorPerGame" />
      </Card>

      {myTeam && (
        <Card>
          <CardTitle subtitle={`League rank #${myTeam.league_rank} of ${result.num_teams} by starter VOR`}>
            {myTeam.owner_name ?? 'Your'} Lineup
          </CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Starter VOR/gm" value={`${myTeam.starter_vor_total_per_game >= 0 ? '+' : ''}${fmt(myTeam.starter_vor_total_per_game)}`} />
            <StatTile label="Starter VOR (ROS)" value={fmt(myTeam.starter_vor_rest_of_season)} />
            <StatTile label="Projected Starters" value={`${myTeam.starters_with_projection}/${myTeam.starters.length}`} />
            <StatTile label="Bench Size" value={myTeam.bench.length} />
          </div>
          <div className="mt-2 border border-[color:var(--rule)]">
            {myTeam.starters.map((s: StarterSlot, i: number) => (
              <PlayerRow key={i} label={s.slot} player={s.player} mismatch={s.slot_mismatch} />
            ))}
          </div>
          {myTeam.bench.length > 0 && (
            <>
              <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Bench</p>
              <div className="border border-[color:var(--rule)]">
                {myTeam.bench.map((p, i) => (
                  <PlayerRow key={i} label="BN" player={p} />
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      <Card>
        <CardTitle>Replacement Levels</CardTitle>
        <p className="mb-3 text-xs text-slate-500">
          The replacement-level player at each position, given this league's exact starting-lineup requirements and flex usage —
          VOR is every player's projection minus this baseline.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(result.replacement_levels).map(([pos, rl]) => (
            <StatTile key={pos} label={pos} value={fmt(rl.replacement_points)} hint={`${rl.replacement_player ?? '—'} · rank ${rl.replacement_rank}`} />
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Scoring Coverage</CardTitle>
        <p className="mb-2 text-xs text-slate-500">
          Which of this league's scoring rules the projection engine can and can't apply. Missing keys are stated explicitly rather
          than silently scored as zero.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {result.scoring_analysis.supported_keys.map((k) => (
            <Badge key={k} color="green">{k}</Badge>
          ))}
          {Object.keys(result.scoring_analysis.unsupported_keys).map((k) => (
            <Badge key={k} color="red" title={result.scoring_analysis.unsupported_keys[k]}>{k}</Badge>
          ))}
        </div>
        {result.id_resolution.unmatched > 0 && (
          <p className="mt-3 text-xs text-amber-400">
            {result.id_resolution.unmatched} of {result.id_resolution.total} rostered players couldn't be matched to a stats ID and
            have no projection.
          </p>
        )}
      </Card>
    </div>
  );
}
