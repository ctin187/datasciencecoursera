import { useEffect, useState } from 'react';
import { LeagueService } from '../services/sleeperApi';
import type { SleeperLeague, SleeperRoster, SleeperUser, SleeperDraftPick, WinnersBracketMatchup } from '../types';

export interface HistoricalSeason {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  draftPicks: SleeperDraftPick[];
  championRosterId: number | null;
  runnerUpRosterId: number | null;
}

export interface LeagueHistoryState {
  seasons: HistoricalSeason[]; // most recent first, current season excluded (useLeagueData already has it)
  loading: boolean;
  error: string | null;
}

const MAX_SEASONS = 5; // current + up to 4 prior, to keep the API call count bounded

/**
 * Walks Sleeper's previous_league_id chain to pull prior seasons' rosters,
 * users, draft, and playoff result. Each season is a full league in its own
 * right - roster_id numbering is NOT stable across seasons (only user_id
 * is), so anything that joins across seasons must key off owner_id/user_id,
 * not roster_id.
 */
export function useLeagueHistory(leagueId: string | null): LeagueHistoryState {
  const [seasons, setSeasons] = useState<HistoricalSeason[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) {
      setSeasons([]);
      return;
    }
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const chain = await LeagueService.getLeagueHistory(leagueId!, MAX_SEASONS);
        const priorLeagues = chain.slice(1); // first entry is the current season, already loaded elsewhere
        if (cancelled) return;

        const results = await Promise.all(
          priorLeagues.map(async (league): Promise<HistoricalSeason | null> => {
            try {
              const [rostersRes, usersRes, draftsRes] = await Promise.all([
                LeagueService.getRosters(league.league_id),
                LeagueService.getUsers(league.league_id),
                LeagueService.getDrafts(league.league_id),
              ]);
              const draft = draftsRes.data.find((d) => d.league_id === league.league_id) ?? draftsRes.data[0];
              const draftPicks = draft ? (await LeagueService.getDraftPicks(draft.draft_id)).data : [];

              let championRosterId: number | null = null;
              let runnerUpRosterId: number | null = null;
              try {
                const bracket: WinnersBracketMatchup[] = (await LeagueService.getWinnersBracket(league.league_id)).data;
                const finalMatch = bracket
                  .filter((b) => !b.p)
                  .reduce<WinnersBracketMatchup | null>((best, b) => (!best || b.r > best.r ? b : best), null);
                championRosterId = finalMatch?.w ?? null;
                runnerUpRosterId = finalMatch?.l ?? null;
              } catch {
                // Bracket unavailable (very old season, or league didn't use Sleeper's playoff bracket) - standings-only fallback below.
              }

              return { league, rosters: rostersRes.data, users: usersRes.data, draftPicks, championRosterId, runnerUpRosterId };
            } catch {
              return null; // one bad season shouldn't blank the whole history
            }
          }),
        );
        if (!cancelled) setSeasons(results.filter((s): s is HistoricalSeason => s !== null));
      } catch {
        if (!cancelled) setError('Could not load this league\'s prior-season history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return { seasons, loading, error };
}
