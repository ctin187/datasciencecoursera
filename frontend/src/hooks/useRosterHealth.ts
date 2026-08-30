import { useEffect, useState } from 'react';
import { fetchRosterHealth, isBackendConfigured, type RosterHealthResponse, BackendError } from '../services/backendApi';
import type { LeagueData } from './useLeagueData';

export interface RosterHealthState {
  result: RosterHealthResponse | null;
  loading: boolean;
  error: string | null;
  backendConfigured: boolean;
}

/**
 * Calls the Python backend's /roster-health endpoint with this league's real
 * settings and rosters, so VOR (value over replacement) is computed against
 * this league's actual scoring format and starting-lineup requirements rather
 * than a generic ranking.
 */
export function useRosterHealth(data: LeagueData | null, focusUserId: string): RosterHealthState {
  const [result, setResult] = useState<RosterHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) {
      setResult(null);
      return;
    }
    if (!isBackendConfigured()) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const focusRoster = focusUserId ? data!.rosters.find((r) => r.owner_id === focusUserId) : undefined;
        const playerMeta: Record<string, { name: string | null; position: string | null }> = {};
        for (const r of data!.rosters) {
          for (const pid of r.players ?? []) {
            const p = data!.players[pid];
            if (p) playerMeta[pid] = { name: p.full_name || `${p.first_name} ${p.last_name}`, position: p.position };
          }
        }
        const res = await fetchRosterHealth({
          num_teams: data!.league.total_rosters,
          roster_positions: data!.league.roster_positions,
          scoring_settings: data!.league.scoring_settings,
          rosters: data!.rosters.map((r) => ({
            roster_id: r.roster_id,
            owner_name: r.owner_id
              ? data!.users.find((u) => u.user_id === r.owner_id)?.metadata?.team_name ||
                data!.users.find((u) => u.user_id === r.owner_id)?.display_name ||
                null
              : null,
            player_ids: r.players ?? [],
            starters: r.starters ?? [],
          })),
          focus_roster_id: focusRoster?.roster_id ?? null,
          player_meta: playerMeta,
        });
        if (!cancelled) setResult(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof BackendError ? err.message : 'Could not compute roster health.');
          setResult(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, focusUserId]);

  return { result, loading, error, backendConfigured: isBackendConfigured() };
}
