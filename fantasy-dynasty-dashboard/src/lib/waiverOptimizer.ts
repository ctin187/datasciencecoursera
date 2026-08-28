import type { DropCandidate, FaabSuggestion, PlayersMap, Position, SleeperPlayer, SleeperRoster, TradeValueEntry } from '../types';
import { retirementRisk } from './agingCurves';
import { resolvePlayerValue } from './playerValue';

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

/**
 * Blends the simulated usage trend with real dynasty value into a single
 * 0-100 ranking score, so a known, valuable player can never be buried
 * below a total unknown purely because that unknown's fake trend number
 * happened to land high. Value carries the majority weight deliberately -
 * the trend signal is fabricated (see estimateSnapTrend), real value is not.
 */
export function priorityScore(trend: SnapTrend, consensusValue: number): number {
  const valueSignal = Math.min(100, consensusValue / 80);
  return valueSignal * 0.65 + trend.opportunityScore * 0.35;
}

export function suggestFaabBid(
  player: SleeperPlayer,
  trend: SnapTrend,
  tradeValue: Pick<TradeValueEntry, 'consensusValue' | 'tier'> | undefined,
  ctx: FaabContext,
): FaabSuggestion {
  const remainingBudgets = Array.from(ctx.spentByRoster.values()).map((spent) => ctx.startingBudget - spent);
  const avgRemaining = remainingBudgets.length
    ? remainingBudgets.reduce((s, v) => s + v, 0) / remainingBudgets.length
    : ctx.startingBudget;

  const consensusValue = tradeValue?.consensusValue ?? 0;
  const valueFloor = Math.min(15, consensusValue / 300);
  const opportunityFactor = trend.opportunityScore / 100;
  const trendBoost = trend.trend === 'RISING' ? 1.35 : trend.trend === 'FALLING' ? 0.6 : 1;

  const rawBid = (valueFloor + opportunityFactor * 18) * trendBoost;
  const budgetCap = avgRemaining * 0.35; // don't suggest blowing >35% of average remaining budget
  const suggestedBid = Math.round(Math.max(0, Math.min(rawBid, budgetCap)));

  // Priority now requires real value to back it up, not just simulated trend -
  // a total unknown (no curated value, no search_rank estimate) can't reach
  // HIGH PRIORITY on trend noise alone.
  const score = priorityScore(trend, consensusValue);
  let priority: FaabSuggestion['priority'] = 'LOW';
  if (score >= 55 && trend.trend !== 'FALLING') priority = 'HIGH PRIORITY';
  else if (score >= 35) priority = 'MEDIUM';
  else if (score >= 15) priority = 'LOW';
  else priority = 'SPECULATIVE';

  const reasonParts: string[] = [];
  if (trend.trend === 'RISING') {
    reasonParts.push(
      `Simulated snap share ${(trend.earlySnapShare * 100).toFixed(0)}% -> ${(trend.recentSnapShare * 100).toFixed(0)}%, target share ${(trend.earlyTargetShare * 100).toFixed(0)}% -> ${(trend.recentTargetShare * 100).toFixed(0)}% (rising).`,
    );
  } else if (trend.trend === 'FALLING') {
    reasonParts.push('Simulated usage trending down - lower priority add.');
  } else {
    reasonParts.push('Simulated usage stable week over week.');
  }
  if (tradeValue) {
    reasonParts.push(`Consensus dynasty tier: ${tradeValue.tier}.`);
  } else {
    reasonParts.push('No real value signal for this player - treat as speculative.');
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

/** Roster spots not in the starting lineup, IR, or taxi squad - i.e. droppable without a lineup change. */
export function benchPlayerIds(roster: SleeperRoster): string[] {
  const all = roster.players ?? [];
  const exempt = new Set([...(roster.starters ?? []), ...(roster.taxi ?? []), ...(roster.reserve ?? [])]);
  return all.filter((id) => !exempt.has(id));
}

/**
 * Positions a league's plain FLEX spot makes interchangeable, inferred from
 * roster_positions (e.g. Sleeper's 'FLEX', 'WRRB_FLEX', 'REC_FLEX'). Used so a
 * drop suggestion never crosses positions the league itself wouldn't.
 *
 * Deliberately does NOT fold SUPER_FLEX's QB eligibility into this set: a
 * superflex *lineup slot* can hold a QB, but that doesn't mean a QB pickup
 * and a bench WR are equivalent roster-value trade-offs, and suggesting
 * "drop your WR for this QB" is a much bigger call than a same-tier flex
 * swap. QB targets only match other bench QBs.
 */
export function flexEligiblePositions(rosterPositions: string[]): Set<Position> {
  const flex = new Set<Position>();
  const upper = rosterPositions.map((p) => p.toUpperCase());
  if (upper.some((p) => p.includes('FLEX') && !p.includes('SUPER'))) {
    flex.add('RB');
    flex.add('WR');
    flex.add('TE');
  }
  return flex;
}

/**
 * Suggests which bench player(s) to drop in favor of a given waiver target,
 * restricted to the same position or a position the league's own FLEX rules
 * make interchangeable with it. Ranks by "keepability": low dynasty value,
 * a falling usage trend, and elevated decline risk all make a player safer
 * to cut.
 *
 * Critically, this never suggests dropping a bench player whose real value
 * meaningfully exceeds the pickup's own value - the simulated usage trend
 * that ranks *which* free agent to target has zero say in that comparison,
 * because it's fabricated data and value is not. Without this guardrail the
 * tool could (and did) recommend cutting a proven, high-value player for a
 * total unknown just because the unknown's fake trend number was high.
 */
export function suggestDropCandidates(
  benchIds: string[],
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  targetPosition: Position,
  rosterPositions: string[],
  pickupValue = 0,
  limit = 2,
): DropCandidate[] {
  const flex = flexEligiblePositions(rosterPositions);
  const valueBuffer = 400; // ~ one dynasty tier of slack, so a same-tier swap isn't blocked
  const eligible = benchIds.filter((id) => {
    const pos = players[id]?.position as Position | undefined;
    if (!pos) return false;
    if (pos !== targetPosition && !(flex.has(pos) && flex.has(targetPosition))) return false;
    const benchValue = resolvePlayerValue(id, players, tradeValues).consensusValue;
    return benchValue <= pickupValue + valueBuffer;
  });

  const scored = eligible.map((id) => {
    const p = players[id]!;
    const resolved = resolvePlayerValue(id, players, tradeValues);
    const trend = estimateSnapTrend(p);
    const risk = p.age ? retirementRisk(p.position, p.age) : { risk: 'low' as const, reason: '' };

    // Lower keepScore = safer to drop: low trade value, falling usage, elevated decline risk.
    const keepScore =
      resolved.consensusValue +
      (trend.trend === 'RISING' ? 800 : trend.trend === 'FALLING' ? -400 : 0) +
      (risk.risk === 'high' ? -600 : risk.risk === 'medium' ? -200 : 0);

    const reasonParts: string[] = [resolved.tier];
    if (trend.trend === 'FALLING') reasonParts.push('usage trending down');
    if (trend.trend === 'RISING') reasonParts.push('usage trending up - think twice');
    if (risk.risk !== 'low') reasonParts.push(risk.reason);

    const candidate: DropCandidate = {
      playerId: id,
      name: p.full_name || `${p.first_name} ${p.last_name}`,
      position: p.position as Position,
      reason: reasonParts.join(' · '),
    };
    return { candidate, keepScore };
  });

  return scored
    .sort((a, b) => a.keepScore - b.keepScore)
    .slice(0, limit)
    .map((s) => s.candidate);
}
