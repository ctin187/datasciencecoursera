import { useCallback, useEffect, useState } from 'react';
import { fetchNflNews, type EspnNewsItem } from '../services/espnApi';

const AUTO_REFRESH_MS = 30 * 60 * 1000; // 30 min, per spec

export interface EspnNewsState {
  items: EspnNewsItem[] | null; // null = unavailable, never fabricated
  loading: boolean;
  fetchedAt: number | null;
  refresh: () => void;
}

/** Loads ESPN's public NFL news feed on mount, auto-refreshing every 30 minutes, with manual refresh too. */
export function useEspnNews(): EspnNewsState {
  const [items, setItems] = useState<EspnNewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    console.debug('[useEspnNews] fetching ESPN news');
    fetchNflNews()
      .then((result) => {
        setItems(result);
        setFetchedAt(Date.now());
        console.debug('[useEspnNews] fetch complete', { itemCount: result?.length ?? null });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  return { items, loading, fetchedAt, refresh: load };
}
