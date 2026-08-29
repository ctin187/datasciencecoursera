import type {
  LetterGrade,
  LifecyclePhase,
  Position,
  PlayersMap,
  RosterAnalysis,
  SleeperRoster,
  TeamGrade,
  ThreeDValue,
  TradeValueEntry,
} from '../types';
import { retirementRisk } from './agingCurves';
import { resolvePlayerValue } from './playerValue';

/** Zero/empty-initialized Record over exactly the positions this league actually rosters. */
function zeroRecord<T>(positions: Position[], init: () => T): Record<Position, T> {
  const record = {} as Record<Position, T>;
  for (const pos of positions) record[pos] = init();
  return record;
}

export function analyzeRoster(
  roster: SleeperRoster,
  ownerName: string,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  activePositions: Position[],
): RosterAnalysis {
  const playerIds = roster.players ?? [];
  const starterSet = new Set(roster.starters ?? []);
  const positionalAges = zeroRecord<number[]>(activePositions, () => []);
  const positionalValues = zeroRecord<number>(activePositions, () => 0);
  const retirementRiskList: RosterAnalysis['retirementRisk'] = [];

  let ageSum = 0;
  let ageCount = 0;
  let eliteAgingCount = 0;
  let youngAssetCount = 0;
  let totalValue = 0;
  let starterValue = 0;
  let benchValue = 0;

  for (const id of playerIds) {
    const p = players[id];
    if (!p) continue;
    const pos = (activePositions.includes(p.position as Position) ? p.position : null) as Position | null;

    const resolved = resolvePlayerValue(id, players, tradeValues);
    if (pos) positionalValues[pos] += resolved.consensusValue;
    totalValue += resolved.consensusValue;
    if (starterSet.has(id)) starterValue += resolved.consensusValue;
    else benchValue += resolved.consensusValue;

    if (!p.age || !pos) continue;

    positionalAges[pos].push(p.age);
    ageSum += p.age;
    ageCount++;

    const isElite = resolved.consensusValue >= 6000;
    if (isElite && p.age >= 28) eliteAgingCount++;
    if (resolved.consensusValue >= 1500 && p.age <= 24) youngAssetCount++;

    const risk = retirementRisk(pos, p.age);
    if (risk.risk !== 'low') {
      retirementRiskList.push({ playerId: id, risk: risk.risk, reason: risk.reason });
    }
  }

  const avgAge = ageCount ? ageSum / ageCount : 0;
  const phase = detectLifecyclePhase(eliteAgingCount, youngAssetCount, avgAge, roster.settings.wins ?? 0);

  return {
    rosterId: roster.roster_id,
    ownerName,
    phase,
    avgAge: Math.round(avgAge * 10) / 10,
    eliteAgingCount,
    youngAssetCount,
    totalValue,
    positionalAges,
    positionalValues,
    starterValue,
    benchValue,
    retirementRisk: retirementRiskList,
  };
}

export function detectLifecyclePhase(
  eliteAgingCount: number,
  youngAssetCount: number,
  avgAge: number,
  wins: number,
): LifecyclePhase {
  // Win-now: multiple aging elite players, low average age isn't required.
  if (eliteAgingCount >= 3 && avgAge >= 26.5) return 'win-now';
  if (eliteAgingCount >= 2 && wins >= 6) return 'contend';
  if (youngAssetCount >= 5 && avgAge <= 25) return 'rebuild';
  return 'middle';
}

export function phaseDescription(phase: LifecyclePhase): string {
  switch (phase) {
    case 'win-now':
      return 'Win-now: multiple elite players 28+, built to compete for a title this year or next.';
    case 'contend':
      return 'Contender: competitive roster with some aging pieces - a good trade could push you to win-now.';
    case 'rebuild':
      return 'Rebuild: young core with accumulating draft capital - prioritize picks and youth in trades.';
    case 'middle':
      return 'Stuck in the middle: neither a clear contender nor a clear rebuild. This is the riskiest phase - commit one direction.';
  }
}

/** Projects roster composition N years out by simple age shift + retirement-risk attrition heuristic. */
export function futureRosterProjection(
  positionalAges: Record<Position, number[]>,
  yearsOut: number,
  activePositions: Position[],
): { position: Position; startableCount: number }[] {
  return activePositions.map((position) => {
    const ages = positionalAges[position] ?? [];
    const stillStartable = ages.filter((age) => {
      const futureAge = age + yearsOut;
      const risk = retirementRisk(position, futureAge);
      return risk.risk !== 'high';
    });
    return { position, startableCount: stillStartable.length };
  });
}

// ---------------------------------------------------------------------------
// Multi-factor team grading (0-100 + letter grade)
//
// The lifecycle `phase` above is a coarse 4-bucket classification and, with
// thresholds tuned around the curated trade-value seed dataset, most real
// rosters in a league end up defaulting to 'middle' - they simply don't
// clear the eliteAgingCount>=3 / youngAssetCount>=5 bars in either
// direction, so most teams look the same. This is a genuinely continuous,
// weighted score built from five independent signals so teams actually
// differentiate, plus a human-readable `breakdown` so a grade is never a
// black box.
//
// Every position-iterating step here takes `activePositions` - the set of
// positions this specific league actually rosters (see lib/leagueFormat.ts) -
// rather than a hardcoded QB/RB/WR/TE array, so a league that starts
// K/DEF/IDP gets those positions counted in depth, age-curve alignment, and
// everywhere else instead of silently ignored.
// ---------------------------------------------------------------------------

/** "Solid Starter" tier floor (see lib/consensusData.ts tierForValue) used as the bar for "quality" depth. */
const QUALITY_STARTER_VALUE = 1500;

export interface LeagueGradeContext {
  avgAgeByPosition: Record<Position, number>;
  avgProjectedPoints: number;
}

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function letterForScore(score: number): LetterGrade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/** League-wide baselines every team's grade is measured against - avg age by position, avg starter projected points. */
export function computeLeagueGradeContext(
  rosters: SleeperRoster[],
  players: PlayersMap,
  threeDValues: Map<string, ThreeDValue>,
  activePositions: Position[],
): LeagueGradeContext {
  const ageSums = zeroRecord<number>(activePositions, () => 0);
  const ageCounts = zeroRecord<number>(activePositions, () => 0);
  let totalProjected = 0;

  for (const roster of rosters) {
    const starterSet = new Set((roster.starters ?? []).filter((id) => id !== '0'));
    let rosterProjected = 0;
    for (const id of roster.players ?? []) {
      const p = players[id];
      if (!p) continue;
      const pos = activePositions.includes(p.position as Position) ? (p.position as Position) : null;
      if (pos && p.age) {
        ageSums[pos] += p.age;
        ageCounts[pos] += 1;
      }
      if (starterSet.has(id)) {
        rosterProjected += threeDValues.get(id)?.currentProjection ?? 0;
      }
    }
    totalProjected += rosterProjected;
  }

  const avgAgeByPosition = zeroRecord<number>(activePositions, () => 0);
  activePositions.forEach((pos) => {
    avgAgeByPosition[pos] = ageCounts[pos] ? ageSums[pos] / ageCounts[pos] : 0;
  });

  return {
    avgAgeByPosition,
    avgProjectedPoints: rosters.length ? totalProjected / rosters.length : 0,
  };
}

export function gradeRoster(
  roster: SleeperRoster,
  ownerName: string,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  threeDValues: Map<string, ThreeDValue>,
  context: LeagueGradeContext,
  activePositions: Position[],
): TeamGrade {
  const starterSet = new Set((roster.starters ?? []).filter((id) => id !== '0'));
  const positionalAges = zeroRecord<number[]>(activePositions, () => []);
  const qualityCountByPos = zeroRecord<number>(activePositions, () => 0);

  let eliteAgingCount = 0;
  let youngAssetCount = 0;
  let middleZoneCount = 0;
  let injuryRiskPoints = 0;
  let starterProjected = 0;

  for (const id of roster.players ?? []) {
    const p = players[id];
    if (!p) continue;
    const pos = activePositions.includes(p.position as Position) ? (p.position as Position) : null;
    const resolved = resolvePlayerValue(id, players, tradeValues);

    if (pos && p.age) {
      positionalAges[pos].push(p.age);
      if (resolved.consensusValue >= 6000 && p.age >= 28) eliteAgingCount++;
      if (resolved.consensusValue >= 1500 && p.age <= 25) youngAssetCount++;
      if (p.age >= 26 && p.age <= 27) middleZoneCount++;
      if (p.age >= 30) injuryRiskPoints += 5;
    }
    // Sleeper's public data has no injury-history field - injury_status reflects
    // this week's report only, used here as the best available risk proxy.
    if (p.injury_status) injuryRiskPoints += 3;
    if (pos) qualityCountByPos[pos] += resolved.consensusValue >= QUALITY_STARTER_VALUE ? 1 : 0;

    if (starterSet.has(id)) {
      starterProjected += threeDValues.get(id)?.currentProjection ?? 0;
    }
  }

  const breakdown: string[] = [];

  // A. Contention phase (25%) - rewards a clear win-now OR rebuild core, penalizes a
  // roster stacked with 26-27yo players (too old to be a rebuild core, not yet the
  // proven aging stars that define a win-now core).
  const winNowStrength = Math.min(40, eliteAgingCount * 15);
  const rebuildStrength = Math.min(40, youngAssetCount * 8);
  const stuckPenalty = Math.min(40, middleZoneCount * 6);
  const contentionScore = clamp0to100(20 + Math.max(winNowStrength, rebuildStrength) - stuckPenalty * 0.5);
  breakdown.push(
    `Contention phase: 20 + max(win-now ${winNowStrength}, rebuild ${rebuildStrength}) - stuck-penalty ${(stuckPenalty * 0.5).toFixed(1)} = ${contentionScore.toFixed(1)}`,
  );

  // B. Age curve alignment (20%) - baseline 70 so a young roster can earn a bonus above it.
  let ageCurveScore = 70;
  for (const pos of activePositions) {
    const ages = positionalAges[pos];
    if (ages.length === 0) continue;
    const avg = ages.reduce((s, a) => s + a, 0) / ages.length;
    const diff = avg - context.avgAgeByPosition[pos];
    if (diff > 3) ageCurveScore -= 10;
    else if (diff < -3) ageCurveScore += 10;
  }
  ageCurveScore = clamp0to100(ageCurveScore);
  breakdown.push(`Age curve alignment: baseline 70, ±10 per position vs. league avg age = ${ageCurveScore.toFixed(1)}`);

  // C. Positional depth (25%) - 0 quality players at a position = 0, 1 = 40, 2+ = 80-100.
  const depthComponents = activePositions.map((pos) => Math.min(100, qualityCountByPos[pos] * 40));
  const depthScore = clamp0to100(depthComponents.reduce((s, v) => s + v, 0) / depthComponents.length);
  breakdown.push(
    `Positional depth: ${activePositions.map((pos) => `${pos} ${qualityCountByPos[pos]}`).join(', ')} quality (Tier ≤4) players = ${depthScore.toFixed(1)}`,
  );

  // D. Injury risk (15%, inverted so higher = safer roster)
  const injuryRiskScore = clamp0to100(100 - injuryRiskPoints);
  breakdown.push(
    `Injury risk: ${injuryRiskPoints} risk points (+5/player age 30+, +3/player on this week's injury report) -> safety ${injuryRiskScore.toFixed(1)}`,
  );

  // E. Projected points vs. league average (15%) - starters only, since that's what actually scores.
  const projectedPointsScore =
    context.avgProjectedPoints > 0
      ? clamp0to100(50 + ((starterProjected - context.avgProjectedPoints) / context.avgProjectedPoints) * 100)
      : 50;
  breakdown.push(
    `Projected points: starters project ${starterProjected.toFixed(0)} vs. league avg ${context.avgProjectedPoints.toFixed(0)} = ${projectedPointsScore.toFixed(1)}`,
  );

  const overall = clamp0to100(
    contentionScore * 0.25 + ageCurveScore * 0.2 + depthScore * 0.25 + injuryRiskScore * 0.15 + projectedPointsScore * 0.15,
  );
  breakdown.push(
    `Overall = (${contentionScore.toFixed(1)}×0.25) + (${ageCurveScore.toFixed(1)}×0.20) + (${depthScore.toFixed(1)}×0.25) + (${injuryRiskScore.toFixed(1)}×0.15) + (${projectedPointsScore.toFixed(1)}×0.15) = ${overall.toFixed(1)} (${letterForScore(overall)})`,
  );

  const allAges = activePositions.flatMap((p) => positionalAges[p]);
  const avgAge = allAges.length ? allAges.reduce((s, a) => s + a, 0) / allAges.length : 0;

  const winNowGrade = clamp0to100(eliteAgingCount * 20 + projectedPointsScore * 0.5 + (avgAge >= 26 ? 10 : 0));
  const rebuildGrade = clamp0to100(youngAssetCount * 15 + injuryRiskScore * 0.2 + (avgAge <= 25 ? 15 : 0) + depthScore * 0.2);
  const longevityScore = clamp0to100(ageCurveScore * 0.5 + rebuildGrade * 0.3 + depthScore * 0.2);

  console.debug('[rosterAnalyzer] gradeRoster', { rosterId: roster.roster_id, ownerName, overall: overall.toFixed(1), letter: letterForScore(overall) });

  return {
    rosterId: roster.roster_id,
    ownerName,
    contentionScore,
    ageCurveScore,
    depthScore,
    injuryRiskScore,
    projectedPointsScore,
    overall,
    letter: letterForScore(overall),
    winNowGrade,
    rebuildGrade,
    longevityScore,
    breakdown,
  };
}

/** Grades every roster in the league against a shared context, sorted best-to-worst. */
export function gradeLeague(
  rosters: SleeperRoster[],
  ownerNameFor: (rosterId: number) => string,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  threeDValues: Map<string, ThreeDValue>,
  activePositions: Position[],
): TeamGrade[] {
  const context = computeLeagueGradeContext(rosters, players, threeDValues, activePositions);
  return rosters
    .map((r) => gradeRoster(r, ownerNameFor(r.roster_id), players, tradeValues, threeDValues, context, activePositions))
    .sort((a, b) => b.overall - a.overall);
}
