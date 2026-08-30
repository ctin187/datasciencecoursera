import { useCallback, useEffect, useState } from 'react';
import { LeagueService, SleeperApiError } from '../services/sleeperApi';
import type { SleeperDraftPick } from '../types';

export interface DraftPicksState {
  picks: SleeperDraftPick[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

/** Fetches a draft's picks, with a manual refresh that bypasses the TTL cache (drafts move fast; auto-polling isn't implemented yet - hit refresh). */
export function useDraftPicks(draftId: string | null): DraftPicksState {
  const [picks, setPicks] = useState<SleeperDraftPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!draftId) return;
    setRefreshing(true);
    try {
      const { data } = await LeagueService.getDraftPicksLive(draftId);
      setPicks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof SleeperApiError ? err.message : 'Could not refresh draft picks.');
    } finally {
      setRefreshing(false);
    }
  }, [draftId]);

  useEffect(() => {
    if (!draftId) {
      setPicks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    LeagueService.getDraftPicks(draftId)
      .then(({ data }) => {
        if (!cancelled) setPicks(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof SleeperApiError ? err.message : 'Could not load draft picks.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  return { picks, loading, error, refresh, refreshing };
}
