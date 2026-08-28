import type { ConsensusADP, DraftTier, Position, ThreeDValue } from '../types';

const TIER_LABELS = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6', 'Tier 7', 'Tier 8'];

/**
 * Groups players into tiers using a simple gap-based clustering over
 * blended 3D value: whenever the drop-off between consecutive players
 * exceeds `gapThreshold` (relative to the pool's overall spread), start a
 * new tier. This approximates how analysts draw tier lines on a cheat
 * sheet by eye.
 */
export function buildTiers(
  adpRows: ConsensusADP[],
  values: Map<string, ThreeDValue>,
  position: Position | 'ALL',
  gapThreshold = 0.06,
): DraftTier[] {
  const pool = (position === 'ALL' ? adpRows : adpRows.filter((p) => p.position === position))
    .map((p) => ({ p, v: values.get(p.playerId)?.blendedValue ?? 0 }))
    .sort((a, b) => b.v - a.v);

  if (pool.length === 0) return [];

  const maxV = pool[0].v || 1;
  const tiers: DraftTier[] = [];
  let currentTierPlayers: string[] = [];
  let tierIdx = 0;
  let currentMax = pool[0].v;

  for (let i = 0; i < pool.length; i++) {
    const { p, v } = pool[i];
    if (i > 0) {
      const prev = pool[i - 1].v;
      const gap = (prev - v) / maxV;
      if (gap > gapThreshold) {
        tiers.push({
          tier: TIER_LABELS[tierIdx] ?? `Tier ${tierIdx + 1}`,
          position,
          minValue: pool[i - 1].v,
          maxValue: currentMax,
          players: currentTierPlayers,
        });
        tierIdx++;
        currentTierPlayers = [];
        currentMax = v;
      }
    }
    currentTierPlayers.push(p.playerId);
  }
  tiers.push({
    tier: TIER_LABELS[tierIdx] ?? `Tier ${tierIdx + 1}`,
    position,
    minValue: pool[pool.length - 1].v,
    maxValue: currentMax,
    players: currentTierPlayers,
  });

  return tiers;
}

/** Finds the tier a given player belongs to, and whether they're the last player in it (tier breakpoint). */
export function tierBreakpointInfo(tiers: DraftTier[], playerId: string) {
  for (const tier of tiers) {
    const idx = tier.players.indexOf(playerId);
    if (idx !== -1) {
      return {
        tier,
        isLastInTier: idx === tier.players.length - 1,
        remainingInTier: tier.players.length - idx - 1,
      };
    }
  }
  return null;
}

export interface PositionalScarcity {
  position: Position;
  remainingInTierA: number;
  totalStartQualityRemaining: number;
  recommendation: string;
}

/**
 * Rough positional-scarcity signal: how many "startable tier" players
 * (top 3 tiers) remain at each position among players not yet drafted.
 */
export function positionalScarcity(
  adpRows: ConsensusADP[],
  values: Map<string, ThreeDValue>,
  draftedPlayerIds: Set<string>,
  positions: Position[] = ['QB', 'RB', 'WR', 'TE'],
): PositionalScarcity[] {
  return positions.map((position) => {
    const tiers = buildTiers(adpRows, values, position);
    const startQualityTiers = tiers.slice(0, 3);
    const remaining = startQualityTiers.flatMap((t) => t.players).filter((id) => !draftedPlayerIds.has(id));
    const tierA = tiers[0]?.players.filter((id) => !draftedPlayerIds.has(id)).length ?? 0;

    let recommendation = `${position}: healthy depth remains.`;
    if (tierA <= 1 && remaining.length <= 3) {
      recommendation = `${position}: scarcity alert - elite tier nearly gone, few startable options left.`;
    } else if (tierA === 0) {
      recommendation = `${position}: Tier 1 is fully off the board.`;
    }

    return {
      position,
      remainingInTierA: tierA,
      totalStartQualityRemaining: remaining.length,
      recommendation,
    };
  });
}
