import type { PlayersMap, Position, ResolvedPlayerValue, TradeValueEntry } from '../types';
import { tierForValue } from './consensusData';

const KNOWN_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

/**
 * The curated seed dataset (src/data/consensusPlayers.ts) only covers ~130
 * players - nowhere near enough for a real 10-team dynasty league, where
 * rosters commonly run 20-25 spots and easily add up to 150-250 distinct
 * rostered players. Every consumer that only checked the curated
 * TradeValueEntry map (Trade Analyzer search/quick-add/math, Roster Health's
 * grading and full-roster table, Waivers) was silently treating anyone
 * outside that list as worth zero - which is why real leagues saw values on
 * a handful of players and roster grades clustering at the bottom.
 *
 * Sleeper's public player objects carry a `search_rank` field: a relevance
 * ordinal across its *entire* player database (lower = more notable). It
 * isn't fantasy-specific and won't match a real ADP, but it's the only
 * universal signal available for the thousands of players outside the
 * curated list, so it's used here as an explicitly-labeled *estimate* -
 * distinct in tier naming from curated ("Tier N - ...") so the UI never
 * implies false precision.
 */
function estimateValueFromSearchRank(searchRank: number | null | undefined, position: Position): number {
  if (!searchRank || searchRank <= 0 || searchRank > 6000) return 0;
  // K/DEF genuinely carry minimal dynasty trade value in the real market -
  // mainstream consensus sources (KTC, FantasyPros dynasty rankings) barely
  // rank them at all, so a low base here matches reality, not a shortcut.
  // IDP (DL/LB/DB) has real dynasty value in IDP-format leagues, generally
  // lower than offensive skill positions.
  const base =
    position === 'QB'
      ? 3200
      : position === 'RB' || position === 'WR'
        ? 3000
        : position === 'TE'
          ? 2600
          : position === 'LB'
            ? 1600
            : position === 'DL'
              ? 1500
              : position === 'DB'
                ? 1400
                : position === 'K' || position === 'DEF'
                  ? 500
                  : 900;
  const decay = base / Math.pow(1 + searchRank / 150, 0.9);
  return Math.max(0, Math.round(decay));
}

function tierForEstimate(value: number): string {
  if (value >= 2200) return 'Est. Starter-caliber';
  if (value >= 900) return 'Est. Depth/Upside';
  if (value > 0) return 'Est. Deep Bench';
  return 'Unranked / deep roster';
}

/**
 * Single source of truth for "what is this player worth": checks the
 * curated trade-value seed dataset first, then falls back to a search_rank
 * estimate for any live Sleeper player missing from it. Every part of the
 * app that needs a player's value (trade math, roster grading, the full
 * roster table, waiver scoring) should go through this rather than reading
 * the curated map directly, or non-curated players silently score as zero.
 */
export function resolvePlayerValue(
  playerId: string,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
): ResolvedPlayerValue {
  const tv = tradeValues.get(playerId);
  const p = players[playerId];

  if (tv) {
    return {
      playerId,
      name: tv.name,
      position: tv.position,
      age: tv.age,
      team: p?.team ?? null,
      status: p?.status ?? 'Unknown',
      consensusValue: tv.consensusValue,
      tier: tv.tier,
      source: 'curated',
    };
  }

  if (!p) {
    return {
      playerId,
      name: playerId,
      position: 'WR',
      age: null,
      team: null,
      status: 'Unknown',
      consensusValue: 0,
      tier: 'Unranked / deep roster',
      source: 'none',
    };
  }

  // Previously forced any non-QB/RB/WR/TE player (kickers, team defenses,
  // every IDP player) to 'WR' here - wrong position, wrong aging curve,
  // wrong estimate base. Now only truly unrecognized position strings
  // (e.g. FB/LS/P, which no fantasy league starts) fall back to WR.
  const pos: Position = KNOWN_POSITIONS.includes(p.position as Position) ? (p.position as Position) : 'WR';
  const estimated = estimateValueFromSearchRank(p.search_rank, pos);

  return {
    playerId,
    name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
    position: pos,
    age: p.age,
    team: p.team,
    status: p.status,
    consensusValue: estimated,
    tier: estimated > 0 ? tierForEstimate(estimated) : 'Unranked / deep roster',
    source: estimated > 0 ? 'estimated' : 'none',
  };
}

/** Re-exported for spots that want the curated-only tier labels for consistency (e.g. quality thresholds). */
export { tierForValue };
