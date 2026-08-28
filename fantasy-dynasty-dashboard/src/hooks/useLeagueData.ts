import { useEffect, useState } from 'react';
import { LeagueService, SleeperApiError } from '../services/sleeperApi';
import type { PlayersMap, SleeperDraft, SleeperLeague, SleeperRoster, SleeperUser } from '../types';

export interface LeagueData {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: PlayersMap;
  drafts: SleeperDraft[];
  stale: boolean;
}

export interface LeagueDataState {
  data: LeagueData | null;
  loading: boolean;
  error: string | null;
  progress: string | null;
}

export function useLeagueData(leagueId: string | null): LeagueDataState {
  const [state, setState] = useState<LeagueDataState>({ data: null, loading: false, error: null, progress: null });

  useEffect(() => {
    if (!leagueId) {
      setState({ data: null, loading: false, error: null, progress: null });
      return;
    }
    let cancelled = false;

    async function run() {
      setState({ data: null, loading: true, error: null, progress: 'Fetching league settings...' });
      try {
        const leagueRes = await LeagueService.getLeague(leagueId!);
        if (cancelled) return;
        setState((s) => ({ ...s, progress: 'Fetching rosters...' }));

        const [rostersRes, usersRes, draftsRes] = await Promise.all([
          LeagueService.getRosters(leagueId!),
          LeagueService.getUsers(leagueId!),
          LeagueService.getDrafts(leagueId!),
        ]);
        if (cancelled) return;
        setState((s) => ({ ...s, progress: 'Loading player database (cached ~24h)...' }));

        const playersRes = await LeagueService.getAllPlayers();
        if (cancelled) return;

        const stale = leagueRes.stale || rostersRes.stale || usersRes.stale || draftsRes.stale || playersRes.stale;

        setState({
          data: {
            league: leagueRes.data,
            rosters: rostersRes.data,
            users: usersRes.data,
            players: playersRes.data,
            drafts: draftsRes.data,
            stale,
          },
          loading: false,
          error: null,
          progress: null,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof SleeperApiError ? err.message : 'Something went wrong loading league data.';
        setState({ data: null, loading: false, error: message, progress: null });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return state;
}
