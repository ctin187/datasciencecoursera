import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { benchPlayerIds, faabSpentByRoster, rosteredPlayerIds } from '../../lib/waiverOptimizer';
import { detectLeagueFormat } from '../../lib/leagueFormat';
import {
  fetchWaiverTargets,
  isBackendConfigured,
  API_BASE_URL,
  BackendError,
  type WaiverTargetsResponse,
  type WaiverTarget,
} from '../../services/backendApi';

/**
 * Waiver wire, on measured data.
 *
 * This tab previously ranked free agents partly on a "snap/target trend" that
 * was generated from a hash of the player's ID - deterministic noise wearing a
 * disclaimer. That is gone. Ranking is now Value Over Replacement computed
 * against this league's own settings, and every usage claim ("role is growing")
 * comes from actual game logs via the backend.
 */

const FAAB_TIPS = [
  'Hold 20-25% of your budget past midseason. The best real difference-makers hit waivers after injuries, not in week 3.',
  'A rising target share is worth paying up for before it shows in box scores. A falling one is a sell signal even on a name you know.',
  "Don't spend premium FAAB on a bye-week rental. Save it for players who solve a need for the rest of the season.",
  'In a shallow league take the best player available; in a deep league need usually wins close calls, since replacement-level talent is scarcer.',
];

function fmtSigned(n: number | null | undefined, d = 1): string {
  if (n === null || n === undefined) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
}

function vorColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-slate-500';
  if (v > 3) return 'text-emerald-400';
  if (v > 0) return 'text-emerald-500/80';
  if (v > -3) return 'text-amber-400';
  return 'text-red-400';
}

const DIRECTION_COLOR: Record<string, 'green' | 'red' | 'gray'> = {
  rising: 'green',
  falling: 'red',
  stable: 'gray',
};

export function WaiversTab({ data, userId }: { data: LeagueData; userId: string }) {
  const [resp, setResp] = useState<WaiverTargetsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');

  const format = useMemo(() => detectLeagueFormat(data.league.roster_positions), [data.league.roster_positions]);
  const rostered = useMemo(() => rosteredPlayerIds(data.rosters), [data.rosters]);
  const spentByRoster = useMemo(() => faabSpentByRoster(data.rosters), [data.rosters]);
  const startingBudget = data.league.settings.waiver_budget ?? 100;

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;
  const myBench = useMemo(() => (myRoster ? benchPlayerIds(myRoster) : []), [myRoster]);
  const myStarters = useMemo(
    () => (myRoster?.starters ?? []).filter((id) => id && id !== '0'),
    [myRoster],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWaiverTargets({
        num_teams: data.rosters.length,
        roster_positions: data.league.roster_positions,
        scoring_settings: (data.league.scoring_settings ?? {}) as Record<string, number>,
        rostered_sleeper_ids: Array.from(rostered),
        my_bench_sleeper_ids: myBench,
        my_starter_sleeper_ids: myStarters,
        limit: 80,
      });
      setResp(r);
      console.debug('[WaiversTab] loaded', { count: r.count, as_of_week: r.as_of_week });
    } catch (err) {
      setResp(null);
      setError(err instanceof BackendError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [data.rosters, data.league.roster_positions, data.league.scoring_settings, rostered, myBench, myStarters]);

  useEffect(() => {
    if (isBackendConfigured()) load();
  }, [load]);

  const myFaabRemaining = myRoster ? startingBudget - (spentByRoster.get(myRoster.roster_id) ?? 0) : null;

  const filtered: WaiverTarget[] = useMemo(() => {
    if (!resp) return [];
    return posFilter === 'ALL' ? resp.targets : resp.targets.filter((t) => t.position === posFilter);
  }, [resp, posFilter]);

  const droppable = resp?.bench_ranked.filter((b) => b.below_replacement) ?? [];

  if (!isBackendConfigured()) {
    return (
      <Card>
        <CardTitle subtitle="Waiver rankings come from the Python backend, which isn't wired up in this build.">
          Waiver Wire — backend not configured
        </CardTitle>
        <p className="text-sm text-slate-300">
          Set <code className="rounded bg-slate-800 px-1.5 py-0.5">VITE_API_BASE_URL</code> to a deployed instance of{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">/fantasy-backend</code> and rebuild.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Showing nothing rather than falling back to the old ranking — that one was driven partly by a simulated usage
          signal, and a fabricated number is worse than an empty screen.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-300">Data provenance</span>
          {resp ? (
            <>
              <span className="font-mono text-slate-400">{resp.season} · through week {resp.as_of_week}</span>
              <span className="font-mono text-slate-400">
                pulled {resp.provenance.data_as_of ? new Date(resp.provenance.data_as_of).toLocaleString() : 'unknown'}
              </span>
              <span className="text-slate-500">{resp.provenance.source}</span>
              {resp.provenance.stale && <Badge color="orange">STALE ({resp.provenance.age_hours}h)</Badge>}
            </>
          ) : (
            <span className="text-slate-500">{loading ? 'loading…' : 'no data'}</span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="min-h-[32px] rounded-md bg-slate-800 px-2.5 py-1 font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <Card>
          <CardTitle>Couldn't reach the backend</CardTitle>
          <p className="text-sm text-red-300">{error}</p>
          <p className="mt-2 text-xs text-slate-500">Configured URL: <code>{API_BASE_URL || '(unset)'}</code></p>
        </Card>
      )}

      {resp && (
        <>
          <Card>
            <CardTitle subtitle="Your league's FAAB position.">FAAB Budget</CardTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Your Remaining" value={myFaabRemaining !== null ? `$${myFaabRemaining}` : '—'} hint={`of $${startingBudget}`} />
              <StatTile label="Starting Budget" value={`$${startingBudget}`} />
              <StatTile label="Teams" value={data.rosters.length} />
              <StatTile label="Free Agents Ranked" value={resp.count} />
            </div>
          </Card>

          {!myRoster && (
            <Card>
              <CardTitle subtitle="Pick your team from the dropdown in the header to see which of these are upgrades over your current starters, and which of your bench players are actually droppable.">
                Select Your Team for Personalized Context
              </CardTitle>
            </Card>
          )}

          <Card>
            <CardTitle subtitle="Ranked by Value Over Replacement in your league's settings. Usage direction is measured from real game logs — a 4-game window against all earlier weeks.">
              Top Available Players
            </CardTitle>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(['ALL', ...format.activePositions] as (Position | 'ALL')[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosFilter(p)}
                  className={`min-h-[32px] rounded-md px-3 py-1 text-xs font-medium ${
                    posFilter === p ? 'bg-violet-600 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              {filtered.slice(0, 40).map((t) => {
                const u = t.usage;
                return (
                  <div key={t.sleeper_id ?? t.gsis_id ?? t.name} className="rounded-md border border-slate-800 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-100">
                        {t.name}
                        <span className="ml-1.5 text-xs text-slate-500">
                          {t.position}{t.team ? ` · ${t.team}` : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {u?.direction && <Badge color={DIRECTION_COLOR[u.direction]}>{u.direction.toUpperCase()}</Badge>}
                        <span className={`font-mono font-semibold ${vorColor(t.vor_per_game)}`}>
                          {fmtSigned(t.vor_per_game)} VOR/g
                        </span>
                      </span>
                    </div>

                    <div className="mt-1.5 grid grid-cols-1 gap-1 text-xs text-slate-400 sm:grid-cols-3">
                      <span className="font-mono">
                        proj {t.projected_points_per_game?.toFixed(1)} vs repl {t.replacement_points?.toFixed(1)}
                      </span>
                      {u ? (
                        <span className="font-mono">
                          {u.recent.targets > 0 && `${u.recent.targets.toFixed(1)} tgt/g `}
                          {u.recent.carries > 0 && `${u.recent.carries.toFixed(1)} car/g `}
                          {u.recent.snap_share > 0 && `· ${(u.recent.snap_share * 100).toFixed(0)}% snaps`}
                        </span>
                      ) : (
                        <span className="text-slate-600">no usage data</span>
                      )}
                      {t.upgrade_over_weakest_starter !== null && (
                        <span className={t.upgrade_over_weakest_starter > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                          {t.upgrade_over_weakest_starter > 0
                            ? `${fmtSigned(t.upgrade_over_weakest_starter)} over your weakest ${t.position}`
                            : `not an upgrade on your ${t.position}s`}
                        </span>
                      )}
                    </div>

                    {u && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {u.direction ? `Why: ${u.direction_basis}` : u.direction_basis}
                        {u.games_in_prior > 0 && ` · ${u.games_in_window}g recent vs ${u.games_in_prior}g prior`}
                      </p>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && <p className="text-sm text-slate-500">No available players at this position.</p>}
            </div>
          </Card>

          {myRoster && (
            <Card>
              <CardTitle subtitle="Bench players projecting below replacement level — a freely-available player at their position projects better. These are your genuine drop candidates.">
                Droppable ({droppable.length})
              </CardTitle>
              {droppable.length === 0 && (
                <p className="text-sm text-slate-500">
                  Nothing on your bench is below replacement. Every bench spot is holding real surplus value.
                </p>
              )}
              <div className="space-y-1.5">
                {droppable.map((b) => (
                  <div key={b.sleeper_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 px-3 py-2 text-sm">
                    <span className="text-slate-200">
                      {b.name}
                      <span className="ml-1.5 text-xs text-slate-500">{b.position}{b.team ? ` · ${b.team}` : ''}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs text-slate-500">
                        proj {b.projected_points_per_game?.toFixed(1)} vs repl {b.replacement_points?.toFixed(1)}
                      </span>
                      <span className={`font-mono font-semibold ${vorColor(b.vor_per_game)}`}>{fmtSigned(b.vor_per_game)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle subtitle="General budget strategy — principles, not player-specific claims.">FAAB Strategy</CardTitle>
            <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-300">
              {FAAB_TIPS.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-600">{resp.methodology}</p>
          </Card>
        </>
      )}
    </div>
  );
}
