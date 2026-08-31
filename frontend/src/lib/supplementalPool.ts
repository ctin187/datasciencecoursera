import type { PlayersMap, Position, SleeperPlayer } from '../types';
import type { LeagueFormat } from './leagueFormat';

/**
 * Draftable players the projection backend cannot value.
 *
 * The backend's projection model covers QB/RB/WR/TE only - those are the
 * positions nflverse publishes the volume and efficiency inputs for. Kickers,
 * team defenses and IDP (DL/LB/DB) have no projection, therefore no VOR, and
 * were consequently dropped from the draft board entirely: `buildAvailableBoard`
 * filtered on `vorPerGame !== null`. In a league that starts those positions,
 * that meant the board silently hid roster spots you are required to fill.
 *
 * This module fills that gap WITHOUT inventing a projection. Players here are
 * ordered by Sleeper's own `search_rank` - a real field from the Sleeper API,
 * their relevance ordinal across the player database. It is not a fantasy
 * projection and is never presented as one: these rows carry
 * `valueSource: 'sleeper-rank'`, show "—" in the VOR column, and are ranked
 * against each other rather than interleaved with VOR-scored players on a
 * fabricated common scale.
 *
 * It also means the draft board still works when the backend is unreachable:
 * every rostered position falls back to Sleeper rank rather than the tab going
 * blank.
 */

export type ValueSource = 'backend-vor' | 'sleeper-rank';

export interface SupplementalPlayer {
  sleeperId: string;
  name: string | null;
  position: string | null;
  team: string | null;
  /** Sleeper's relevance ordinal - lower is more notable. Real API field. */
  sleeperRank: number | null;
  valueSource: ValueSource;
}

/** Positions the projection backend can produce a VOR for. Everything else needs the fallback. */
export const BACKEND_PROJECTED_POSITIONS: ReadonlySet<string> = new Set(['QB', 'RB', 'WR', 'TE']);

/** Sleeper's `search_rank` is ~9999999 for irrelevant/retired players; anything past this is noise. */
const RANK_CEILING = 20000;

/** How many players to surface per fallback position. Enough to draft from, not so many the board drowns. */
const PER_POSITION_CAP: Record<string, number> = {
  DEF: 32, // there are exactly 32 NFL team defenses
  K: 40,
  DL: 80,
  LB: 80,
  DB: 80,
};
const DEFAULT_CAP = 60;

function displayName(p: SleeperPlayer): string {
  return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.player_id;
}

/**
 * Which of this league's rostered positions the backend cannot value.
 * Driven by the league's own roster_positions, so a standard league gets an
 * empty list and an IDP league gets DL/LB/DB.
 */
export function unprojectedPositions(format: LeagueFormat): Position[] {
  return format.activePositions.filter((pos) => !BACKEND_PROJECTED_POSITIONS.has(pos));
}

/**
 * Builds the fallback pool for positions the backend doesn't project.
 *
 * `alreadyPooled` are Sleeper IDs the backend already returned - we never
 * shadow a real projection with a rank.
 */
export function buildSupplementalPool(
  players: PlayersMap,
  format: LeagueFormat,
  alreadyPooled: ReadonlySet<string>,
): Map<string, SupplementalPlayer> {
  return collect(players, unprojectedPositions(format), alreadyPooled, PER_POSITION_CAP, DEFAULT_CAP);
}

/**
 * Full-fallback mode: the backend is unreachable or returned nothing, so build
 * the pool for EVERY position this league rosters from Sleeper rank alone.
 * A rank-ordered board is materially more useful than an empty tab, as long as
 * it is labelled for what it is. Caps are looser here because this is the only
 * source of players, not a supplement to one.
 */
export function buildFullFallbackPool(
  players: PlayersMap,
  format: LeagueFormat,
): Map<string, SupplementalPlayer> {
  return collect(players, format.activePositions, new Set(), PER_POSITION_CAP, 150);
}

/** Shared selection: filter to a position, drop noise, order by Sleeper rank, cap. */
function collect(
  players: PlayersMap,
  positions: readonly Position[],
  exclude: ReadonlySet<string>,
  caps: Record<string, number>,
  defaultCap: number,
): Map<string, SupplementalPlayer> {
  const out = new Map<string, SupplementalPlayer>();
  if (positions.length === 0) return out;

  const byPosition = new Map<string, SleeperPlayer[]>();
  for (const p of Object.values(players)) {
    const pos = p.position as string;
    if (!positions.includes(pos as Position)) continue;
    if (exclude.has(p.player_id)) continue;
    // A team defense has no individual status or team the way a person does,
    // so only gate on those for real players.
    if (pos !== 'DEF') {
      if (p.status !== 'Active') continue;
      if (!p.team) continue;
    }
    const rank = p.search_rank;
    if (rank == null || rank <= 0 || rank >= RANK_CEILING) continue;
    const arr = byPosition.get(pos);
    if (arr) arr.push(p);
    else byPosition.set(pos, [p]);
  }

  for (const [position, candidates] of byPosition) {
    candidates.sort((a, b) => (a.search_rank ?? Infinity) - (b.search_rank ?? Infinity));
    for (const p of candidates.slice(0, caps[position] ?? defaultCap)) {
      out.set(p.player_id, {
        sleeperId: p.player_id,
        name: displayName(p),
        position,
        team: p.team,
        sleeperRank: p.search_rank ?? null,
        valueSource: 'sleeper-rank',
      });
    }
  }

  return out;
}
