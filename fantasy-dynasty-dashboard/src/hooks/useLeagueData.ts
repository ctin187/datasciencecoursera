import { useCallback, useEffect, useState } from 'react';
import { LeagueService, SleeperApiError } from '../services/sleeperApi';
import type { PlayersMap, SleeperDraft, SleeperLeague, SleeperRoster, SleeperTradedPick, SleeperUser } from '../types';

export interface LeagueData {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: PlayersMap;
  drafts: SleeperDraft[];
  tradedPicks: SleeperTradedPick[];
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
    console.debug('[useLeagueData] manual roster refresh requested', { leagueId });
    try {
      const { data: rosters, stale } = await LeagueService.getRostersLive(leagueId);
      console.debug('[useLeagueData] roster refresh complete', { rosterCount: rosters.length, stale });
      setData((prev) => (prev ? { ...prev, rosters, stale: prev.stale || stale, rostersFetchedAt: Date.now() } : prev));
    } catch (err) {
      // Leave existing rosters in place on failure - a failed manual refresh shouldn't blank the tab.
      console.debug('[useLeagueData] roster refresh failed, keeping stale data', err);
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
      console.debug('[useLeagueData] loading league', { leagueId });
      setData(null);
      setLoading(true);
      setError(null);
      setProgress('Fetching league settings...');
      try {
        const leagueRes = await LeagueService.getLeague(leagueId!);
        if (cancelled) return;
        console.debug('[useLeagueData] league settings loaded', { name: leagueRes.data.name, rosterPositions: leagueRes.data.roster_positions, stale: leagueRes.stale });
        setProgress('Fetching rosters...');

        const [rostersRes, usersRes, draftsRes, tradedPicksRes] = await Promise.all([
          LeagueService.getRosters(leagueId!),
          LeagueService.getUsers(leagueId!),
          LeagueService.getDrafts(leagueId!),
          LeagueService.getTradedPicks(leagueId!),
        ]);
        if (cancelled) return;
        console.debug('[useLeagueData] rosters/users/drafts/tradedPicks loaded', {
          rosterCount: rostersRes.data.length,
          userCount: usersRes.data.length,
          draftCount: draftsRes.data.length,
          tradedPickCount: tradedPicksRes.data.length,
        });
        setProgress('Loading player database (cached ~24h)...');

        const playersRes = await LeagueService.getAllPlayers();
        if (cancelled) return;
        console.debug('[useLeagueData] player database loaded', { playerCount: Object.keys(playersRes.data).length, stale: playersRes.stale });

        const stale = leagueRes.stale || rostersRes.stale || usersRes.stale || draftsRes.stale || tradedPicksRes.stale || playersRes.stale;

        setData({
          league: leagueRes.data,
          rosters: rostersRes.data,
          users: usersRes.data,
          players: playersRes.data,
          drafts: draftsRes.data,
          tradedPicks: tradedPicksRes.data,
          stale,
          rostersFetchedAt: Date.now(),
        });
        setLoading(false);
        setError(null);
        setProgress(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof SleeperApiError ? err.message : 'Something went wrong loading league data.';
        console.debug('[useLeagueData] load failed', err);
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
