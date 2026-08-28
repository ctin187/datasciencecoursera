import { useCallback, useEffect, useState } from 'react';
import { LeagueService, SleeperApiError } from '../services/sleeperApi';
import type { PlayersMap, SleeperDraft, SleeperLeague, SleeperRoster, SleeperUser } from '../types';

export interface LeagueData {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: PlayersMap;
  drafts: SleeperDraft[];
  stale: boolean;
  rostersFetchedAt: number;
}

export interface LeagueDataState {
  data: LeagueData | null;
  loading: boolean;
  error: string | null;
  progress: string | null;
  refreshRosters: () => Promise<void>;
  refreshingRosters: boolean;
}

export function useLeagueData(leagueId: string | null): LeagueDataState {
  const [data, setData] = useState<LeagueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [refreshingRosters, setRefreshingRosters] = useState(false);

  const refreshRosters = useCallback(async () => {
    if (!leagueId) return;
    setRefreshingRosters(true);
    try {
      const { data: rosters, stale } = await LeagueService.getRostersLive(leagueId);
      setData((prev) => (prev ? { ...prev, rosters, stale: prev.stale || stale, rostersFetchedAt: Date.now() } : prev));
    } catch {
      // Leave existing rosters in place on failure - a failed manual refresh shouldn't blank the tab.
    } finally {
      setRefreshingRosters(false);
    }
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) {
      setData(null);
      setLoading(false);
      setError(null);
      setProgress(null);
      return;
    }
    let cancelled = false;

    async function run() {
      setData(null);
      setLoading(true);
      setError(null);
      setProgress('Fetching league settings...');
      try {
        const leagueRes = await LeagueService.getLeague(leagueId!);
        if (cancelled) return;
        setProgress('Fetching rosters...');

        const [rostersRes, usersRes, draftsRes] = await Promise.all([
          LeagueService.getRosters(leagueId!),
          LeagueService.getUsers(leagueId!),
          LeagueService.getDrafts(leagueId!),
        ]);
        if (cancelled) return;
        setProgress('Loading player database (cached ~24h)...');

        const playersRes = await LeagueService.getAllPlayers();
        if (cancelled) return;

        const stale = leagueRes.stale || rostersRes.stale || usersRes.stale || draftsRes.stale || playersRes.stale;

        setData({
          league: leagueRes.data,
          rosters: rostersRes.data,
          users: usersRes.data,
          players: playersRes.data,
          drafts: draftsRes.data,
          stale,
          rostersFetchedAt: Date.now(),
        });
        setLoading(false);
        setError(null);
        setProgress(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof SleeperApiError ? err.message : 'Something went wrong loading league data.';
        setData(null);
        setLoading(false);
        setError(message);
        setProgress(null);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return { data, loading, error, progress, refreshRosters, refreshingRosters };
}
