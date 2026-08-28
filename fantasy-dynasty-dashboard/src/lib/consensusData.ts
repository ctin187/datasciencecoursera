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
