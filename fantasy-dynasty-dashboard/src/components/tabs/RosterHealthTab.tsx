import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import {
  fetchRosterHealth,
  isBackendConfigured,
  API_BASE_URL,
  BackendError,
  type RosterHealthResponse,
  type RosterHealthRequest,
  type StarterSlot,
  type VorPlayer,
} from '../../services/backendApi';

/**
 * Roster health, rebuilt on Value Over Replacement.
 *
 * Deliberately absent, per spec:
 *  - No letter grades. The points figure is more informative and harder to fake.
 *  - No recommendations. Naming the player who fixes a gap needs the waiver
 *    optimiser, which does not exist on this backend yet.
 *  - No confidence percentages. There is nothing real to derive them from here,
 *    and invented ones are what made the previous build feel hollow.
 */

function fmtSigned(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function vorColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-slate-500';
  if (v > 3) return 'text-emerald-400';
  if (v > 0) return 'text-emerald-500/80';
  if (v > -3) return 'text-amber-400';
  return 'text-red-400';
}

export function RosterHealthTab({ data, userId }: { data: LeagueData; userId: string }) {
  const [resp, setResp] = useState<RosterHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const request: RosterHealthRequest | null = useMemo(() => {
    if (!data) return null;
    const userById = new Map(data.users.map((u) => [u.user_id, u]));
    const meta: RosterHealthRequest['player_meta'] = {};
    for (const r of data.rosters) {
      for (const pid of r.players ?? []) {
        const p = data.players[pid];
        if (p) {
          meta[pid] = {
            name: p.full_name || `${p.first_name} ${p.last_name}`,
            position: p.position ?? null,
          };
        }
      }
    }
    return {
      num_teams: data.rosters.length,
      roster_positions: data.league.roster_positions,
      scoring_settings: (data.league.scoring_settings ?? {}) as Record<string, number>,
      rosters: data.rosters.map((r) => {
        const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
        return {
          roster_id: r.roster_id,
          owner_name: owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`,
          player_ids: r.players ?? [],
          starters: r.starters ?? [],
        };
      }),
      player_meta: meta,
    };
  }, [data]);

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRosterHealth(request);
      setResp(r);
      console.debug('[RosterHealthTab] loaded', {
        teams: r.teams.length,
        as_of_week: r.as_of_week,
        unmatched: r.id_resolution.unmatched,
      });
    } catch (err) {
      setResp(null);
      setError(err instanceof BackendError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (isBackendConfigured()) load();
  }, [load]);

  const myRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id ?? null : null;
  const activeId = selectedId ?? myRosterId ?? resp?.teams[0]?.roster_id ?? null;
  const team = resp?.teams.find((t) => t.roster_id === activeId) ?? null;

  // ---------------------------------------------------------------- unconfigured
  if (!isBackendConfigured()) {
    return (
      <Card>
        <CardTitle subtitle="This view is computed by the Python VOR backend, which isn't wired up in this build.">
          Roster Health — backend not configured
        </CardTitle>
        <p className="text-sm text-slate-300">
          Set <code className="rounded bg-slate-800 px-1.5 py-0.5">VITE_API_BASE_URL</code> to a deployed instance of{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5">/fantasy-backend</code> and rebuild.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Deliberately showing nothing rather than falling back to the old grade-based view — those grades put every
          team in the same band, which meant they weren't measuring anything.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ provenance (visible, not buried) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-300">Data provenance</span>
          {resp ? (
            <>
              <span className="font-mono text-slate-400">
                {resp.season} · through week {resp.as_of_week}
              </span>
              <span className="font-mono text-slate-400">
                pulled {resp.provenance.data_as_of ? new Date(resp.provenance.data_as_of).toLocaleString() : 'unknown'}
              </span>
              <span className="text-slate-500">{resp.provenance.source}</span>
              {resp.provenance.stale && <Badge color="orange">STALE ({resp.provenance.age_hours}h old)</Badge>}
              {resp.provenance.last_error && <Badge color="red">refresh error</Badge>}
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
          {/* -------------------------------------------- caveats that change the numbers */}
          {(!resp.scoring_analysis.fully_supported || resp.id_resolution.unmatched > 0 || resp.games_remaining === 0) && (
            <div className="space-y-2 rounded-md border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              {resp.games_remaining === 0 && (
                <p>
                  <span className="font-semibold">The {resp.season} season is complete.</span> Rest-of-season totals are
                  zero by definition — per-week VOR is the number to read here.
                </p>
              )}
              {!resp.scoring_analysis.fully_supported && (
                <p>
                  <span className="font-semibold">Some of your league's scoring isn't in these numbers:</span>{' '}
                  {Object.entries(resp.scoring_analysis.unsupported_keys).map(([k, why]) => `${k} (${why})`).join('; ')}.
                </p>
              )}
              {resp.id_resolution.unmatched > 0 && (
                <p>
                  <span className="font-semibold">
                    {resp.id_resolution.unmatched} of {resp.id_resolution.total} rostered players
                  </span>{' '}
                  couldn't be matched to NFL data and are excluded from every total below:{' '}
                  {resp.id_resolution.unmatched_players.slice(0, 6).map((p) => p.name || p.sleeper_id).join(', ')}
                  {resp.id_resolution.unmatched_players.length > 6 ? '…' : ''}
                </p>
              )}
            </div>
          )}

          {/* -------------------------------------------- league table */}
          <Card>
            <CardTitle
              subtitle={`Sum of starter VOR for every team, computed from their actual rosters. Click a team to inspect it.`}
            >
              League Table — Starter Value Over Replacement
            </CardTitle>
            <div className="space-y-1.5">
              {resp.teams.map((t) => {
                const isMine = t.roster_id === myRosterId;
                const isActive = t.roster_id === activeId;
                return (
                  <button
                    key={t.roster_id}
                    onClick={() => setSelectedId(t.roster_id)}
                    className={`flex w-full min-h-[44px] items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? 'border-violet-600 bg-violet-950/30' : 'border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="w-5 font-mono text-slate-500">{t.league_rank}</span>
                    <span className="flex-1 truncate font-medium text-slate-200">
                      {t.owner_name}
                      {isMine && <span className="ml-1 text-violet-400">(you)</span>}
                    </span>
                    {t.starters_missing_projection > 0 && (
                      <Badge color="gray" title="Starters with no NFL projection are excluded from this total">
                        {t.starters_missing_projection} unprojected
                      </Badge>
                    )}
                    <span className={`font-mono font-semibold ${vorColor(t.starter_vor_total_per_game)}`}>
                      {fmtSigned(t.starter_vor_total_per_game, 1)}
                    </span>
                    <span className="hidden w-16 text-right font-mono text-xs text-slate-500 sm:inline">/week</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* -------------------------------------------- selected team detail */}
          {team && (
            <>
              <Card>
                <CardTitle subtitle="Each slot's VOR is its projected points per game minus what a freely-available player at that position projects. Ranked weakest first — the weaknesses order themselves.">
                  {team.owner_name} — Starting Lineup
                </CardTitle>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Starter VOR" value={fmtSigned(team.starter_vor_total_per_game, 1)} hint="points/week above replacement" />
                  <StatTile label="League Rank" value={`#${team.league_rank} of ${resp.teams.length}`} />
                  <StatTile
                    label="Rest of Season"
                    value={resp.games_remaining === 0 ? '—' : fmtSigned(team.starter_vor_rest_of_season, 0)}
                    hint={resp.games_remaining === 0 ? 'season complete' : `${resp.games_remaining} games left`}
                  />
                  <StatTile label="Starters Projected" value={`${team.starters_with_projection}/${team.starters.length}`} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2 text-left">Slot</th>
                        <th className="px-2 py-2 text-left">Player</th>
                        <th className="px-2 py-2 text-right">Proj/g</th>
                        <th className="px-2 py-2 text-right">Replacement</th>
                        <th className="px-2 py-2 text-right">VOR/g</th>
                        {resp.games_remaining > 0 && <th className="px-2 py-2 text-right">Season cost</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...team.starters]
                        .sort((a, b) => {
                          const av = a.player?.vor_per_game ?? Number.POSITIVE_INFINITY;
                          const bv = b.player?.vor_per_game ?? Number.POSITIVE_INFINITY;
                          return av - bv;
                        })
                        .map((s: StarterSlot, i) => {
                          const p = s.player;
                          return (
                            <tr key={`${s.slot}-${i}`} className="border-b border-slate-800/60">
                              <td className="px-2 py-2 font-mono text-slate-400">{s.slot}</td>
                              <td className="px-2 py-2">
                                {s.empty ? (
                                  <span className="text-slate-600">empty slot</span>
                                ) : (
                                  <span className="text-slate-200">
                                    {p?.name ?? p?.sleeper_id}
                                    <span className="ml-1.5 text-xs text-slate-500">
                                      {p?.position}
                                      {p?.team ? ` · ${p.team}` : ''}
                                    </span>
                                    {s.slot_mismatch && (
                                      <Badge color="orange" title={s.slot_mismatch_reason ?? undefined}>
                                        slot mismatch
                                      </Badge>
                                    )}
                                    {p && !p.has_projection && (
                                      <Badge color="gray" title={p.reason}>no projection</Badge>
                                    )}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right font-mono text-slate-300">
                                {p?.projected_points_per_game?.toFixed(1) ?? '—'}
                              </td>
                              <td className="px-2 py-2 text-right font-mono text-slate-500">
                                {p?.replacement_points?.toFixed(1) ?? '—'}
                              </td>
                              <td className={`px-2 py-2 text-right font-mono font-semibold ${vorColor(p?.vor_per_game)}`}>
                                {fmtSigned(p?.vor_per_game, 1)}
                              </td>
                              {resp.games_remaining > 0 && (
                                <td className="px-2 py-2 text-right font-mono text-slate-400">
                                  {p?.vor_rest_of_season != null ? fmtSigned(p.vor_rest_of_season, 0) : '—'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* -------------------------------------------- bench */}
              <Card>
                <CardTitle subtitle="Bench VOR measures each player against the same positional baseline as a starter. Positive means holding real surplus value; negative means a freely-available player projects better.">
                  Bench Value
                </CardTitle>
                {team.bench.length === 0 && <p className="text-sm text-slate-500">No bench players.</p>}
                <div className="space-y-1.5">
                  {team.bench.map((b: VorPlayer) => (
                    <div
                      key={b.sleeper_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-200">
                        {b.name ?? b.sleeper_id}
                        <span className="ml-1.5 text-xs text-slate-500">
                          {b.position}
                          {b.team ? ` · ${b.team}` : ''}
                        </span>
                        {!b.has_projection && <Badge color="gray" title={b.reason}>no projection</Badge>}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-500">
                          proj {b.projected_points_per_game?.toFixed(1) ?? '—'} vs repl{' '}
                          {b.replacement_points?.toFixed(1) ?? '—'}
                        </span>
                        <span className={`font-mono font-semibold ${vorColor(b.vor_per_game)}`}>
                          {fmtSigned(b.vor_per_game, 1)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* -------------------------------------------- baselines + methodology */}
          <Card>
            <CardTitle subtitle="Derived from this league's own team count and starting requirements — not hardcoded. Flex slots are assigned to whichever positions actually project highest at the margin.">
              Replacement Levels
            </CardTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 text-left">Pos</th>
                    <th className="px-2 py-2 text-right">Dedicated</th>
                    <th className="px-2 py-2 text-right">Flex</th>
                    <th className="px-2 py-2 text-right">Startable</th>
                    <th className="px-2 py-2 text-right">Baseline</th>
                    <th className="px-2 py-2 text-left">Replacement player</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(resp.replacement_levels).map((l) => (
                    <tr key={l.position} className="border-b border-slate-800/60">
                      <td className="px-2 py-2 font-mono text-slate-300">{l.position}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{l.dedicated_starters}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{l.flex_absorbed}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-400">{l.total_startable}</td>
                      <td className="px-2 py-2 text-right font-mono text-slate-200">{l.replacement_points.toFixed(1)}</td>
                      <td className="px-2 py-2 text-slate-500">{l.replacement_player ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">{resp.methodology}</p>
            <p className="mt-1 text-xs text-slate-600">
              Projections are a first-pass volume × regressed-efficiency model. Backtested weekly MAE on the startable
              pool: RB 6.2, WR 6.6, TE 5.8, QB 7.3 — in line with published projection accuracy, and worse than
              commercial projections. Treat these as directional.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
