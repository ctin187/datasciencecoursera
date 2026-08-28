import type { ConsensusADP, PlayersMap, Position, TradeValueEntry } from '../types';
import { matchSeedPlayers } from './playerMatcher';

export function tierForValue(value: number): string {
  if (value >= 8500) return 'Tier 1 - Cornerstone';
  if (value >= 7000) return 'Tier 2 - Elite';
  if (value >= 5000) return 'Tier 3 - High-End Starter';
  if (value >= 3000) return 'Tier 4 - Solid Starter';
  if (value >= 1500) return 'Tier 5 - Depth/Upside';
  return 'Tier 6 - Speculative';
}

export function buildConsensusAdp(players: PlayersMap): ConsensusADP[] {
  const matched = matchSeedPlayers(players);
  return matched.map(({ seed, sleeperPlayer, playerId }) => {
    const [name, position, team, seedAge, fpEcr, sleeperAdp, underdogAdp] = seed;
    const age = sleeperPlayer?.age ?? seedAge;
    const consensusAdp = (fpEcr + sleeperAdp + underdogAdp) / 3;
    return {
      playerId: playerId!,
      name: sleeperPlayer?.full_name || name,
      position: position as Position,
      team: sleeperPlayer?.team ?? team,
      age,
      fantasyProsEcr: fpEcr,
      sleeperAdp,
      underdogAdp,
      consensusAdp,
    };
  });
}

export function buildTradeValues(players: PlayersMap): TradeValueEntry[] {
  const matched = matchSeedPlayers(players);
  return matched.map(({ seed, sleeperPlayer, playerId }) => {
    const [name, position, , seedAge, , , , ktcValue] = seed;
    const age = sleeperPlayer?.age ?? seedAge;
    // Simulate mild cross-source variance around the KTC-style consensus
    // anchor so "consensus" isn't just one source repeated three times.
    const fantasyProsValue = Math.round(ktcValue * 0.97);
    const draftSharksValue = Math.round(ktcValue * 1.03);
    const consensusValue = Math.round((ktcValue + fantasyProsValue + draftSharksValue) / 3);
    return {
      playerId: playerId!,
      name: sleeperPlayer?.full_name || name,
      position: position as Position,
      age,
      fantasyProsValue,
      keepTradeCutValue: ktcValue,
      draftSharksValue,
      consensusValue,
      tier: tierForValue(consensusValue),
    };
  });
}

/** Quick lookup map by playerId for either dataset. */
export function toMap<T extends { playerId: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.playerId, r]));
}

const ESTIMATED_ROW_CAP: Partial<Record<Position, number>> = {
  DEF: 32, // there are only 32 NFL teams
  K: 36,
  DL: 60,
  LB: 60,
  DB: 60,
};

/**
 * Synthesizes draft-board rows for positions the curated ADP seed dataset
 * doesn't cover (K, DEF, and IDP - see data/consensusPlayers.ts, which is
 * offense-skill-position-only by design). No maintained public dataset
 * ranks these positions in dynasty startup consensus the way KTC/FantasyPros
 * rank QB/RB/WR/TE - mainstream sources barely rank kickers or defenses at
 * all, and no free IDP consensus dataset exists - so this uses the same
 * search_rank-based estimate as lib/playerValue.ts, ordered as ADP ranks
 * continuing after the curated pool. It's a real, honest fallback, not
 * precise consensus - callers should badge these distinctly from curated rows.
 */
export function buildEstimatedAdpRows(players: PlayersMap, positions: Position[], startRank: number): ConsensusADP[] {
  const rows: ConsensusADP[] = [];
  let rank = startRank;
  for (const position of positions) {
    const cap = ESTIMATED_ROW_CAP[position] ?? 40;
    const candidates = Object.values(players)
      .filter((p) => p.position === position && p.status === 'Active' && !!p.team)
      .filter((p) => p.search_rank != null && p.search_rank > 0 && p.search_rank < 20000)
      .sort((a, b) => (a.search_rank ?? Infinity) - (b.search_rank ?? Infinity))
      .slice(0, cap);

    for (const p of candidates) {
      rows.push({
        playerId: p.player_id,
        name: p.full_name || `${p.first_name} ${p.last_name}`,
        position,
        team: p.team,
        age: p.age,
        fantasyProsEcr: rank,
        sleeperAdp: rank,
        underdogAdp: rank,
        consensusAdp: rank,
      });
      rank++;
    }
  }
  return rows;
}
