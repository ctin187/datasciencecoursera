import type {
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
  SleeperDraft,
  SleeperDraftPick,
  PlayersMap,
  SleeperTransaction,
} from '../types';
import { getCached, setCached, getStale, TTL } from './cache';

const BASE = 'https://api.sleeper.app/v1';

export class SleeperApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SleeperApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Lightweight request queue to stay well under Sleeper's ~90 req/min limit.
// Spaces requests ~150ms apart (≈ 400/min ceiling, but combined with caching
// this app makes only a handful of calls per session in practice).
// ---------------------------------------------------------------------------
let queue: Promise<unknown> = Promise.resolve();
const MIN_GAP_MS = 150;
let lastCallAt = 0;

function throttledFetch(url: string): Promise<Response> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fetchWithRetry(url);
  });
  // keep the queue chain alive even if this call rejects
  queue = run.catch(() => undefined);
  return run;
}

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 429 && attempt < 3) {
    const backoff = 500 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
}

/** Returns { data, stale, staleAt } so the UI can show a "may be stale" notice. */
async function getJsonWithMeta<T>(
  path: string,
  cacheKey: string,
  ttlMs: number,
): Promise<{ data: T; stale: boolean; staleAt?: number }> {
  const cached = getCached<T>(cacheKey, ttlMs);
  if (cached) return { data: cached, stale: false };

  try {
    const res = await throttledFetch(`${BASE}${path}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new SleeperApiError('Not found. Double-check the ID and try again.', 404);
      }
      throw new SleeperApiError(`Sleeper API error (${res.status})`, res.status);
    }
    const data = (await res.json()) as T;
    if (data === null) {
      throw new SleeperApiError('Not found. Double-check the ID and try again.', 404);
    }
    setCached(cacheKey, data);
    return { data, stale: false };
  } catch (err) {
    const stale = getStale<T>(cacheKey);
    if (stale) {
      return { data: stale.data, stale: true, staleAt: stale.timestamp };
    }
    if (err instanceof SleeperApiError) throw err;
    throw new SleeperApiError('Network error reaching Sleeper API. Please try again.');
  }
}

export const LeagueService = {
  async getLeague(leagueId: string) {
    return getJsonWithMeta<SleeperLeague>(`/league/${leagueId}`, `league:${leagueId}`, TTL.LEAGUE);
  },

  async getRosters(leagueId: string) {
    return getJsonWithMeta<SleeperRoster[]>(
      `/league/${leagueId}/rosters`,
      `rosters:${leagueId}`,
      TTL.ROSTERS,
    );
  },

  async getUsers(leagueId: string) {
    return getJsonWithMeta<SleeperUser[]>(`/league/${leagueId}/users`, `users:${leagueId}`, TTL.USERS);
  },

  async getDrafts(leagueId: string) {
    return getJsonWithMeta<SleeperDraft[]>(
      `/league/${leagueId}/drafts`,
      `drafts:${leagueId}`,
      TTL.DRAFTS,
    );
  },

  async getDraftPicks(draftId: string) {
    return getJsonWithMeta<SleeperDraftPick[]>(
      `/draft/${draftId}/picks`,
      `draftpicks:${draftId}`,
      TTL.DRAFTS,
    );
  },

  async getTransactions(leagueId: string, week: number) {
    return getJsonWithMeta<SleeperTransaction[]>(
      `/league/${leagueId}/transactions/${week}`,
      `tx:${leagueId}:${week}`,
      TTL.TRANSACTIONS,
    );
  },

  /** Full NFL player dictionary (~5MB). Cached for 24h per Sleeper's guidance. */
  async getAllPlayers() {
    return getJsonWithMeta<PlayersMap>(`/players/nfl`, `players:all`, TTL.PLAYERS);
  },

  /** Chain: league -> previous_league_id links, for multi-season history. */
  async getLeagueHistory(leagueId: string, maxSeasons = 3): Promise<SleeperLeague[]> {
    const history: SleeperLeague[] = [];
    let currentId: string | null | undefined = leagueId;
    for (let i = 0; i < maxSeasons && currentId; i++) {
      const { data } = await this.getLeague(currentId);
      history.push(data);
      currentId = data.previous_league_id;
    }
    return history;
  },
};
