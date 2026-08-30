import { useEffect, useState } from 'react';
import { LeagueService } from '../services/sleeperApi';
import type { SleeperLeague, SleeperTransaction } from '../types';

export interface FaabHistoryState {
  transactionsByWeek: Map<number, SleeperTransaction[]>;
  loading: boolean;
  error: string | null;
}

const MAX_WEEK = 18;

/** Fetches every week's transactions (weeks that haven't happened yet just come back empty - cheap and cached). Only meaningful for FAAB leagues, but works regardless. */
export function useFaabHistory(leagueId: string | null, league: SleeperLeague | undefined): FaabHistoryState {
  const [transactionsByWeek, setTransactionsByWeek] = useState<Map<number, SleeperTransaction[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !league) {
      setTransactionsByWeek(new Map());
      return;
    }
    if ((league.settings.waiver_budget ?? 0) <= 0) {
      setTransactionsByWeek(new Map());
      return;
    }
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const weeks = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
        const results = await Promise.all(
          weeks.map((w) => LeagueService.getTransactions(leagueId!, w).then((r) => ({ week: w, data: r.data })).catch(() => null)),
        );
        if (cancelled) return;
        const map = new Map<number, SleeperTransaction[]>();
        for (const r of results) {
          if (r) map.set(r.week, r.data);
        }
        setTransactionsByWeek(map);
      } catch {
        if (!cancelled) setError('Could not load transaction history for FAAB guidance.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, league?.settings.waiver_budget]);

  return { transactionsByWeek, loading, error };
}
