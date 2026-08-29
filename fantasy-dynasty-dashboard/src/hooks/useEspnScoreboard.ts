import { useCallback, useEffect, useState } from 'react';
import { fetchNflScoreboard, type EspnGameOdds } from '../services/espnApi';

export interface EspnScoreboardState {
  games: EspnGameOdds[] | null; // null = unavailable (never fabricated), [] = fetch OK but no games found
  loading: boolean;
  fetchedAt: number | null;
  refresh: () => void;
}

/** Loads ESPN's public NFL scoreboard (spreads/over-unders) once on mount, with manual refresh. Never throws - a failed fetch just leaves games=null so callers show an honest "unavailable" state. */
export function useEspnScoreboard(): EspnScoreboardState {
  const [games, setGames] = useState<EspnGameOdds[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    console.debug('[useEspnScoreboard] fetching ESPN scoreboard');
    fetchNflScoreboard()
      .then((result) => {
        setGames(result);
        setFetchedAt(Date.now());
        console.debug('[useEspnScoreboard] fetch complete', { gameCount: result?.length ?? null });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { games, loading, fetchedAt, refresh: load };
}
