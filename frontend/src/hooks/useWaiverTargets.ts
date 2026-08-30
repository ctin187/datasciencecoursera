import { useEffect, useState } from 'react';
import { fetchWaiverTargets, isBackendConfigured, type WaiverTargetsResponse, BackendError } from '../services/backendApi';
import type { LeagueData } from './useLeagueData';

export interface WaiverTargetsState {
  result: WaiverTargetsResponse | null;
  loading: boolean;
  error: string | null;
  backendConfigured: boolean;
}

/** Calls the backend's /waiver-targets endpoint: every rostered player is excluded, and remaining free agents are ranked by VOR under this league's own scoring + roster requirements. */
export function useWaiverTargets(data: LeagueData | null, userId: string): WaiverTargetsState {
  const [result, setResult] = useState<WaiverTargetsResponse | null>(null);
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
        const myRoster = userId ? data!.rosters.find((r) => r.owner_id === userId) : undefined;
        const rostered = data!.rosters.flatMap((r) => r.players ?? []);
        const res = await fetchWaiverTargets({
          num_teams: data!.league.total_rosters,
          roster_positions: data!.league.roster_positions,
          scoring_settings: data!.league.scoring_settings,
          rostered_sleeper_ids: rostered,
          my_bench_sleeper_ids: (myRoster?.players ?? []).filter((p) => !(myRoster?.starters ?? []).includes(p)),
          my_starter_sleeper_ids: myRoster?.starters ?? [],
          limit: 60,
        });
        if (!cancelled) setResult(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof BackendError ? err.message : 'Could not load waiver targets.');
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
  }, [data, userId]);

  return { result, loading, error, backendConfigured: isBackendConfigured() };
}
