import type { PlayersMap, SleeperPlayer } from '../types';
import { detectLeagueFormat } from './leagueFormat';

/**
 * The draft board, built entirely from Sleeper's own data.
 *
 * WHY NO PROJECTIONS HERE
 *
 * The projection backend ranks players by what they produced in a COMPLETED
 * season. For a draft held before the next one kicks off, that is the wrong
 * question: it rewards aging veterans who compiled counting stats last year,
 * and it cannot see a single rookie, because a rookie has no prior NFL stats
 * to project from. A board built that way recommends players nobody should
 * draft while omitting players going in the first round.
 *
 * Sleeper's `search_rank` is the opposite: a forward-looking consensus for the
 * season about to be played, covering every position and every rookie. It is
 * real data, it ships with the player payload the app already downloads, and
 * it needs no backend - so the board is both more correct and instant.
 *
 * What this module adds on top of that raw ordinal is the part Sleeper cannot
 * know: THIS league's starting requirements, and what YOUR roster still needs.
 */

/** Sleeper marks irrelevant/retired players with a huge search_rank. */
const RANK_CEILING = 20000;

export interface BoardPlayer {
  sleeperId: string;
  name: string;
  position: string;
  team: string | null;
  /** Sleeper's cross-position consensus ordinal. Lower is better. Real API field. */
  overallRank: number;
  /** Rank among UNDRAFTED players at this position, 1-based. Recomputed as the draft moves. */
  posRankAvailable: number;
  /** How many undrafted players at this position still sit above the league's replacement line. */
  startersLeftAtPosition: number;
  /** True while this position still has an unfilled starting slot on your roster. */
  fillsStartingNeed: boolean;
  /**
   * Undrafted players at this position remaining before the position's
   * startable supply runs out, expressed as a share. 0 means the position is
   * already picked past replacement; 1 means it is untouched. This is the
   * scarcity signal - a low number means waiting costs you.
   */
  positionSupply: number;
}

export interface RosterNeed {
  position: string;
  required: number;
  filled: number;
  remaining: number;
}

export interface DraftBoardResult {
  players: BoardPlayer[];
  needs: RosterNeed[];
  /** Positions with at least one unfilled starting slot, in league display order. */
  neededPositions: string[];
}

/**
 * Dedicated starting slots per position for ONE team, from roster_positions.
 * Flex slots are counted separately because they can be filled several ways.
 */
export function startingSlots(rosterPositions: string[]): {
  dedicated: Record<string, number>;
  offenseFlex: number;
  idpFlex: number;
} {
  const dedicated: Record<string, number> = {};
  let offenseFlex = 0;
  let idpFlex = 0;
  for (const raw of rosterPositions ?? []) {
    const slot = String(raw).toUpperCase();
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;
    if (slot === 'FLEX' || slot === 'WRRB_FLEX' || slot === 'REC_FLEX' || slot === 'SUPER_FLEX') {
      offenseFlex += 1;
      continue;
    }
    if (slot === 'IDP_FLEX') {
      idpFlex += 1;
      continue;
    }
    dedicated[slot] = (dedicated[slot] ?? 0) + 1;
  }
  return { dedicated, offenseFlex, idpFlex };
}

function displayName(p: SleeperPlayer): string {
  return p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.player_id;
}

/**
 * Builds the board for the current moment in the draft.
 *
 * Everything is recomputed against who is still available, so positional rank
 * and scarcity reflect the board as it actually stands rather than preseason
 * order.
 */
export function buildDraftBoard(params: {
  players: PlayersMap;
  draftedSleeperIds: Set<string>;
  rosterPositions: string[];
  numTeams: number;
  /** Sleeper ids already on YOUR roster, for the roster-need calculation. */
  myPlayerIds: string[];
}): DraftBoardResult {
  const { players, draftedSleeperIds, rosterPositions, numTeams, myPlayerIds } = params;
  const format = detectLeagueFormat(rosterPositions);
  const active = new Set<string>(format.activePositions);
  const { dedicated, offenseFlex, idpFlex } = startingSlots(rosterPositions);

  // --- What does YOUR roster still need? ---
  const myCounts: Record<string, number> = {};
  for (const id of myPlayerIds) {
    const pos = players[id]?.position;
    if (pos) myCounts[pos] = (myCounts[pos] ?? 0) + 1;
  }
  const needs: RosterNeed[] = format.activePositions.map((pos) => {
    const required = dedicated[pos] ?? 0;
    const filled = Math.min(myCounts[pos] ?? 0, required);
    return { position: pos, required, filled, remaining: Math.max(0, required - filled) };
  });
  const neededPositions = needs.filter((n) => n.remaining > 0).map((n) => n.position);

  // --- League-wide startable supply per position, the replacement line ---
  // Flex slots are spread evenly across the positions eligible for them: an
  // exact split needs projections this board deliberately does not use, and
  // an even split is the neutral assumption rather than a guess dressed up.
  const startable: Record<string, number> = {};
  for (const pos of format.activePositions) {
    startable[pos] = (dedicated[pos] ?? 0) * numTeams;
  }
  const offenseFlexEligible = [...format.offenseFlexPositions].filter((p) => active.has(p));
  if (offenseFlex > 0 && offenseFlexEligible.length > 0) {
    const share = (offenseFlex * numTeams) / offenseFlexEligible.length;
    for (const p of offenseFlexEligible) startable[p] = (startable[p] ?? 0) + share;
  }
  const idpFlexEligible = [...format.idpFlexPositions].filter((p) => active.has(p));
  if (idpFlex > 0 && idpFlexEligible.length > 0) {
    const share = (idpFlex * numTeams) / idpFlexEligible.length;
    for (const p of idpFlexEligible) startable[p] = (startable[p] ?? 0) + share;
  }

  // --- Available players, ordered by Sleeper's forward-looking consensus ---
  const avail: { p: SleeperPlayer; rank: number }[] = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || draftedSleeperIds.has(id)) continue;
    const pos = p.position;
    if (!pos || !active.has(pos)) continue;
    const rank = p.search_rank ?? Infinity;
    if (!Number.isFinite(rank) || rank > RANK_CEILING) continue;
    // Team defenses legitimately have no team field and no active status.
    if (pos !== 'DEF') {
      if (p.status && p.status !== 'Active') continue;
      if (!p.team) continue;
    }
    avail.push({ p, rank });
  }
  avail.sort((a, b) => a.rank - b.rank);

  const seenAtPos: Record<string, number> = {};
  const out: BoardPlayer[] = avail.map(({ p, rank }) => {
    const pos = p.position as string;
    const posRankAvailable = (seenAtPos[pos] = (seenAtPos[pos] ?? 0) + 1);
    const supplyTotal = startable[pos] ?? 0;
    const startersLeft = Math.max(0, Math.ceil(supplyTotal - (posRankAvailable - 1)));
    return {
      sleeperId: p.player_id,
      name: displayName(p),
      position: pos,
      team: p.team ?? null,
      overallRank: rank,
      posRankAvailable,
      startersLeftAtPosition: startersLeft,
      fillsStartingNeed: neededPositions.includes(pos),
      positionSupply: supplyTotal > 0 ? Math.max(0, Math.min(1, startersLeft / supplyTotal)) : 0,
    };
  });

  return { players: out, needs, neededPositions };
}

/**
 * Reorders the board to put what you still have to start first.
 *
 * This is "best player available who fills a hole": players at positions with
 * an open starting slot come first, and within that group Sleeper's consensus
 * decides, untouched. Taking the 40th-best receiver when you have no
 * linebacker and two linebacker slots to fill is how rosters end up illegal.
 *
 * It deliberately does NOT reorder needed positions by scarcity. Doing that
 * hands you the scarcest position's best player even when a far better player
 * at another needed position is sitting there, which is a worse pick, not a
 * better one. Scarcity earns its place as the `Starters Left at Pos` column,
 * where it informs the choice instead of overriding it.
 */
export function sortByRosterNeed(board: BoardPlayer[]): BoardPlayer[] {
  return [...board].sort((a, b) => {
    if (a.fillsStartingNeed !== b.fillsStartingNeed) return a.fillsStartingNeed ? -1 : 1;
    return a.overallRank - b.overallRank;
  });
}
