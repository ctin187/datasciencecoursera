import type {
  LifecyclePhase,
  Position,
  PlayersMap,
  RosterAnalysis,
  SleeperRoster,
  TradeValueEntry,
} from '../types';
import { retirementRisk } from './agingCurves';

const SKILL_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export function analyzeRoster(
  roster: SleeperRoster,
  ownerName: string,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
): RosterAnalysis {
  const playerIds = roster.players ?? [];
  const starterSet = new Set(roster.starters ?? []);
  const positionalAges: Record<Position, number[]> = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  const positionalValues: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
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
    const pos = (SKILL_POSITIONS.includes(p.position as Position) ? p.position : null) as Position | null;

    const tv = tradeValues.get(id);
    if (pos) positionalValues[pos] += tv?.consensusValue ?? 0;
    totalValue += tv?.consensusValue ?? 0;
    if (starterSet.has(id)) starterValue += tv?.consensusValue ?? 0;
    else benchValue += tv?.consensusValue ?? 0;

    if (!p.age || !pos) continue;

    positionalAges[pos].push(p.age);
    ageSum += p.age;
    ageCount++;

    const isElite = (tv?.consensusValue ?? 0) >= 6000;
    if (isElite && p.age >= 28) eliteAgingCount++;
    if ((tv?.consensusValue ?? 0) >= 1500 && p.age <= 24) youngAssetCount++;

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
): { position: Position; startableCount: number }[] {
  return SKILL_POSITIONS.map((position) => {
    const ages = positionalAges[position] ?? [];
    const stillStartable = ages.filter((age) => {
      const futureAge = age + yearsOut;
      const risk = retirementRisk(position, futureAge);
      return risk.risk !== 'high';
    });
    return { position, startableCount: stillStartable.length };
  });
}
