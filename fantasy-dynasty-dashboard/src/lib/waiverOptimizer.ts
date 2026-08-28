import type { FaabSuggestion, Position, SleeperPlayer, SleeperRoster, TradeValueEntry } from '../types';

/**
 * Deterministic pseudo-random generator seeded by player_id, so the same
 * player always gets the same simulated trend across renders/sessions.
 * Sleeper's public API does not expose snap counts or target share, and
 * NFL.com/FantasyData are not reachable from a browser-only client without
 * a paid key, so this stands in for that feed (per the spec's fallback
 * instruction) until a real stats source is wired up.
 */
function seededRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export interface SnapTrend {
  earlySnapShare: number;
  recentSnapShare: number;
  earlyTargetShare: number;
  recentTargetShare: number;
  trend: 'RISING' | 'FALLING' | 'STABLE';
  opportunityScore: number; // 0-100
}

export function estimateSnapTrend(player: SleeperPlayer): SnapTrend {
  const r1 = seededRandom(player.player_id + 'snap');
  const r2 = seededRandom(player.player_id + 'target');
  const depthBoost = player.depth_chart_order === 1 ? 0.25 : player.depth_chart_order === 2 ? 0.05 : -0.1;
  const expBoost = (player.years_exp ?? 0) <= 2 ? 0.1 : 0;

  const earlySnapShare = Math.max(0.05, Math.min(0.9, 0.3 + r1 * 0.3 - expBoost));
  const recentSnapShare = Math.max(0.05, Math.min(0.95, earlySnapShare + (r1 - 0.4) * 0.4 + depthBoost));
  const earlyTargetShare = Math.max(0.02, Math.min(0.35, 0.1 + r2 * 0.15));
  const recentTargetShare = Math.max(0.02, Math.min(0.4, earlyTargetShare + (r2 - 0.4) * 0.2 + depthBoost * 0.3));

  const snapDelta = recentSnapShare - earlySnapShare;
  const targetDelta = recentTargetShare - earlyTargetShare;
  const trend: SnapTrend['trend'] = snapDelta + targetDelta > 0.05 ? 'RISING' : snapDelta + targetDelta < -0.05 ? 'FALLING' : 'STABLE';

  const opportunityScore = Math.round(
    Math.min(100, Math.max(0, (recentSnapShare * 50 + recentTargetShare * 100 + (trend === 'RISING' ? 15 : 0)))),
  );

  return { earlySnapShare, recentSnapShare, earlyTargetShare, recentTargetShare, trend, opportunityScore };
}

export function rosteredPlayerIds(rosters: SleeperRoster[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rosters) {
    (r.players ?? []).forEach((id) => ids.add(id));
  }
  return ids;
}

export function faabSpentByRoster(rosters: SleeperRoster[]): Map<number, number> {
  return new Map(rosters.map((r) => [r.roster_id, r.settings.waiver_budget_used ?? 0]));
}

export interface FaabContext {
  startingBudget: number;
  spentByRoster: Map<number, number>;
}

export function suggestFaabBid(
  player: SleeperPlayer,
  trend: SnapTrend,
  tradeValue: TradeValueEntry | undefined,
  ctx: FaabContext,
): FaabSuggestion {
  const remainingBudgets = Array.from(ctx.spentByRoster.values()).map((spent) => ctx.startingBudget - spent);
  const avgRemaining = remainingBudgets.length
    ? remainingBudgets.reduce((s, v) => s + v, 0) / remainingBudgets.length
    : ctx.startingBudget;

  const valueFloor = tradeValue ? Math.min(15, tradeValue.consensusValue / 300) : 0;
  const opportunityFactor = trend.opportunityScore / 100;
  const trendBoost = trend.trend === 'RISING' ? 1.35 : trend.trend === 'FALLING' ? 0.6 : 1;

  const rawBid = (valueFloor + opportunityFactor * 18) * trendBoost;
  const budgetCap = avgRemaining * 0.35; // don't suggest blowing >35% of average remaining budget
  const suggestedBid = Math.round(Math.max(0, Math.min(rawBid, budgetCap)));

  let priority: FaabSuggestion['priority'] = 'LOW';
  if (trend.trend === 'RISING' && trend.opportunityScore >= 55) priority = 'HIGH PRIORITY';
  else if (trend.opportunityScore >= 40) priority = 'MEDIUM';
  else if (trend.opportunityScore >= 20) priority = 'LOW';
  else priority = 'SPECULATIVE';

  const reasonParts: string[] = [];
  if (trend.trend === 'RISING') {
    reasonParts.push(
      `Snap share ${(trend.earlySnapShare * 100).toFixed(0)}% -> ${(trend.recentSnapShare * 100).toFixed(0)}%, target share ${(trend.earlyTargetShare * 100).toFixed(0)}% -> ${(trend.recentTargetShare * 100).toFixed(0)}% (rising).`,
    );
  } else if (trend.trend === 'FALLING') {
    reasonParts.push('Usage trending down - lower priority add.');
  } else {
    reasonParts.push('Usage stable week over week.');
  }
  if (tradeValue) {
    reasonParts.push(`Consensus dynasty tier: ${tradeValue.tier}.`);
  }

  return {
    playerId: player.player_id,
    name: player.full_name || `${player.first_name} ${player.last_name}`,
    position: (player.position as Position) ?? 'WR',
    suggestedBid,
    minBid: Math.max(0, Math.round(suggestedBid * 0.6)),
    maxBid: Math.round(suggestedBid * 1.4 + 2),
    priority,
    reason: reasonParts.join(' '),
  };
}
