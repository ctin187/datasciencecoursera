import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import { useEspnScoreboard } from '../../hooks/useEspnScoreboard';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { buildTeamMatchups, buildLineupComparison, computePlayerLineupInfo, type PlayerLineupInfo } from '../../lib/lineupOptimizer';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

export function LineupOptimizerTab({ data, derived, userId }: { data: LeagueData; derived: Derived; userId: string }) {
  const { games, loading, fetchedAt, refresh } = useEspnScoreboard();

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;

  const matchups = useMemo(() => buildTeamMatchups(games ?? []), [games]);
  const hasOdds = games !== null && matchups.size > 0 && Array.from(matchups.values()).some((m) => m.impliedTotal !== null);

  const comparison = useMemo(() => {
    if (!myRoster) return null;
    return buildLineupComparison(myRoster, data.players, derived.threeDValues, matchups, data.league.roster_positions);
  }, [myRoster, data.players, derived.threeDValues, matchups, data.league.roster_positions]);

  const avgImplied = useMemo(() => {
    const totals = Array.from(matchups.values()).map((m) => m.impliedTotal).filter((v): v is number => v !== null);
    return totals.length ? totals.reduce((s, v) => s + v, 0) / totals.length : 0;
  }, [matchups]);

  const benchInfo: PlayerLineupInfo[] = useMemo(() => {
    if (!myRoster) return [];
    const starterSet = new Set((myRoster.starters ?? []).filter((id) => id !== '0'));
    return (myRoster.players ?? [])
      .filter((id) => !starterSet.has(id))
      .map((id) => computePlayerLineupInfo(id, data.players, derived.threeDValues, matchups, avgImplied))
      .filter((c): c is PlayerLineupInfo => c !== null)
      .sort((a, b) => b.adjustedProjection - a.adjustedProjection);
  }, [myRoster, data.players, derived.threeDValues, matchups, avgImplied]);

  console.debug('[LineupOptimizerTab] render', { hasMyRoster: !!myRoster, gameCount: games?.length ?? null, hasOdds, delta: comparison?.delta });

  if (!userId || !myRoster) {
    return (
      <Card>
        <CardTitle subtitle="Pick your team from the dropdown in the header above to build your matchup-adjusted lineup.">
          Select Your Team to Get Started
        </CardTitle>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
        <span className="font-semibold">Matchup data comes live from ESPN's public scoreboard</span> (spreads and
        over/unders) at page load. This is an unofficial, undocumented endpoint — if it's ever unreachable this
        session, every projection below falls back to your existing dynasty-model projection with no matchup
        adjustment (clearly marked), never a fabricated number.
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle
            subtitle={
              hasOdds
                ? 'Projections blend your dynasty-model projection with this week\'s real Vegas-implied team totals from ESPN.'
                : loading
                  ? 'Loading live matchup data…'
                  : 'Live matchup data unavailable right now — showing dynasty-model projections only (no matchup adjustment applied).'
            }
          >
            Weekly Lineup Optimizer
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {fetchedAt && <span>Matchup data as of {new Date(fetchedAt).toLocaleTimeString()}</span>}
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-md bg-slate-800 px-2 py-1 font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh matchups'}
            </button>
          </div>
        </div>

        {comparison && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Current Lineup Total" value={comparison.currentTotal} />
            <StatTile label="Optimized Lineup Total" value={comparison.optimizedTotal} />
            <StatTile
              label="Projected Gain"
              value={comparison.delta > 0 ? `+${comparison.delta}` : comparison.delta}
              hint={comparison.changedSlots > 0 ? `${comparison.changedSlots} slot(s) would change` : 'Your lineup is already optimal'}
            />
            <StatTile label="Slots Changed" value={comparison.changedSlots} />
          </div>
        )}
      </Card>

      {comparison && (
        <Card>
          <CardTitle subtitle="Side-by-side by starting slot. A slot highlighted amber means the optimizer would swap in a different player.">
            Current vs. Optimized Lineup
          </CardTitle>
          <div className="space-y-1.5">
            {comparison.current.map((cur, i) => {
              const opt = comparison.optimized[i];
              const changed = cur.playerId !== opt.playerId;
              return (
                <div
                  key={`${cur.slotType}-${i}`}
                  className={`grid grid-cols-1 gap-2 rounded-md border px-3 py-2 text-sm sm:grid-cols-3 ${
                    changed ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-800'
                  }`}
                >
                  <span className="font-medium text-slate-400">{cur.slotType}</span>
                  <span className="text-slate-200">
                    {cur.playerName ?? <span className="text-slate-600">empty</span>} <span className="text-slate-500">({cur.projection} pts)</span>
                  </span>
                  {changed ? (
                    <span className="text-amber-300">
                      → {opt.playerName ?? 'empty'} <span className="text-amber-500">({opt.projection} pts)</span>
                    </span>
                  ) : (
                    <span className="text-slate-600">no change</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle subtitle="Every rostered player not currently starting, ranked by matchup-adjusted projection. Confidence reflects how much real data backs the number (dynasty projection availability + live odds availability + injury status).">
          Bench — Matchup-Adjusted Projections
        </CardTitle>
        <div className="space-y-1.5">
          {benchInfo.map((b) => (
            <div key={b.playerId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 px-3 py-2 text-sm">
              <span className="text-slate-200">
                {b.name} <span className="text-slate-500">({b.position}{b.team ? `, ${b.team}` : ''})</span>
                {b.injuryStatus && <Badge color="red">{b.injuryStatus}</Badge>}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-slate-400">
                  {b.baseProjection} base × {b.matchupMultiplier}
                  {b.matchup?.impliedTotal !== null && b.matchup?.impliedTotal !== undefined && (
                    <span className="text-slate-600"> (implied {b.matchup.impliedTotal.toFixed(1)} pts vs. {b.matchup.opponent})</span>
                  )}
                </span>
                <span className="font-semibold text-slate-100">{b.adjustedProjection} pts</span>
                <Badge color={b.confidence >= 70 ? 'green' : b.confidence >= 40 ? 'yellow' : 'red'}>{b.confidence}% conf.</Badge>
              </span>
            </div>
          ))}
          {benchInfo.length === 0 && <p className="text-sm text-slate-500">No bench players found.</p>}
        </div>
      </Card>
    </div>
  );
}
