import { useEffect, useState } from 'react';
import { LeagueService } from '../services/sleeperApi';
import { runSeasonSimulation, type SeasonSimulationResult } from '../lib/seasonSimulator';
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser, WinnersBracketMatchup } from '../types';

export interface SeasonSimulationState {
  result: SeasonSimulationResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches every regular-season week's matchups (real results for played weeks,
 * published schedule for future weeks) plus the playoff bracket, then runs the
 * Monte Carlo season simulation. Kept separate from useLeagueData so a
 * matchup-fetch hiccup never blanks the rest of the dashboard.
 */
export function useSeasonSimulation(
  leagueId: string | null,
  league: SleeperLeague | undefined,
  rosters: SleeperRoster[] | undefined,
  users: SleeperUser[] | undefined,
): SeasonSimulationState {
  const [result, setResult] = useState<SeasonSimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !league || !rosters || !users) {
      setResult(null);
      return;
    }
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const playoffWeekStart = league!.settings.playoff_week_start ?? 15;
        const weeks = Array.from({ length: Math.max(0, playoffWeekStart - 1) }, (_, i) => i + 1);

        const weekResults = await Promise.all(
          weeks.map((w) =>
            LeagueService.getMatchups(leagueId!, w)
              .then((r) => ({ week: w, data: r.data }))
              .catch(() => null),
          ),
        );
        if (cancelled) return;

        const matchupsByWeek = new Map<number, SleeperMatchup[]>();
        for (const wr of weekResults) {
          if (wr) matchupsByWeek.set(wr.week, wr.data);
        }

        let bracket: WinnersBracketMatchup[] = [];
        try {
          bracket = (await LeagueService.getWinnersBracket(leagueId!)).data;
        } catch {
          // Optional - simulator falls back to a self-seeded bracket.
        }
        if (cancelled) return;

        const sim = runSeasonSimulation({ league: league!, rosters: rosters!, users: users!, matchupsByWeek, bracket });
        if (!cancelled) setResult(sim);
      } catch {
        if (!cancelled) setError('Could not load matchup data for the season simulation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, league?.settings.playoff_week_start, rosters, users]);

  return { result, loading, error };
}
