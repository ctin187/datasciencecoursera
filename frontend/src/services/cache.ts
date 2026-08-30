import type { CachedEntry } from '../types';

/**
 * Thin localStorage cache with TTL. Used to keep the app under Sleeper's
 * ~90 req/min rate limit and to avoid re-downloading the ~5MB /players/nfl
 * payload more than necessary.
 */
const PREFIX = 'ffdd:'; // fantasy football dynasty dashboard

export function getCached<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed: CachedEntry<T> = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > ttlMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function getStale<T>(key: string): { data: T; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed: CachedEntry<T> = JSON.parse(raw);
    return { data: parsed.data, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    const entry: CachedEntry<T> = { timestamp: Date.now(), data };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable (e.g. private mode / 5MB players payload) - degrade silently
  }
}

export const TTL = {
  LEAGUE: 5 * 60 * 1000, // 5 min
  ROSTERS: 2 * 60 * 1000, // 2 min
  USERS: 30 * 60 * 1000, // 30 min
  PLAYERS: 24 * 60 * 60 * 1000, // 24 hours - large payload, refresh daily
  DRAFTS: 5 * 60 * 1000,
  TRANSACTIONS: 2 * 60 * 1000,
  MATCHUPS: 5 * 60 * 1000,
  BRACKET: 5 * 60 * 1000,
  NFL_STATE: 10 * 60 * 1000,
};
