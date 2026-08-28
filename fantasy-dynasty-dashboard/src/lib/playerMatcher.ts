import type { PlayersMap, SleeperPlayer } from '../types';
import { SEED_PLAYERS, type SeedRow } from '../data/consensusPlayers';

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface MatchedSeedPlayer {
  seed: SeedRow;
  sleeperPlayer: SleeperPlayer | null;
  playerId: string | null;
}

/**
 * Joins the hand-curated consensus seed dataset against the live Sleeper
 * player dictionary by normalized name + position. Falls back to a
 * synthetic ID (`seed:<name>`) when no live match is found, so the rest of
 * the app can still render seed-only rows (e.g. very recent rookies Sleeper
 * hasn't indexed under the expected name yet).
 */
export function matchSeedPlayers(players: PlayersMap): MatchedSeedPlayer[] {
  const byNamePos = new Map<string, SleeperPlayer>();
  for (const p of Object.values(players)) {
    const full = p.full_name || `${p.first_name} ${p.last_name}`;
    const key = `${normalizeName(full)}|${(p.position || '').toUpperCase()}`;
    byNamePos.set(key, p);
  }

  return SEED_PLAYERS.map((seed) => {
    const [name, position] = seed;
    const key = `${normalizeName(name)}|${position}`;
    const sleeperPlayer = byNamePos.get(key) || null;
    return {
      seed,
      sleeperPlayer,
      playerId: sleeperPlayer?.player_id ?? `seed:${normalizeName(name)}`,
    };
  });
}

export { normalizeName };
