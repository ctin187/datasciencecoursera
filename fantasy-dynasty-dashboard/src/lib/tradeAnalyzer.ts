import type { LifecyclePhase, PlayersMap, ThreeDValue, TradeValueEntry } from '../types';
import { peakAgeRange } from './agingCurves';
import { resolvePlayerValue } from './playerValue';

function debugLog(...args: unknown[]) {
  if (typeof console !== 'undefined') console.debug('[tradeAnalyzer]', ...args);
}

export interface TradeAsset {
  type: 'player' | 'pick';
  playerId?: string;
  pickLabel?: string; // e.g. "2027 1st (early)"
  pickValue?: number; // consensus value for a pick, 0-9999 scale
}

export interface TradeSideResult {
  assets: TradeAsset[];
  totalValue: number;
  avgAge: number | null;
}

export interface TradeResult {
  sideA: TradeSideResult;
  sideB: TradeSideResult;
  deltaPct: number; // positive = side A wins
  winner: 'A' | 'B' | 'even';
}

/** Rough dynasty pick value chart (1st/2nd/3rd, early/mid/late) on the same 0-9999 scale as player values. */
export const PICK_VALUES: Record<string, number> = {
  '1st (early)': 6800,
  '1st (mid)': 5200,
  '1st (late)': 4000,
  '2nd (early)': 2400,
  '2nd (mid)': 1800,
  '2nd (late)': 1400,
  '3rd (early)': 900,
  '3rd (mid)': 650,
  '3rd (late)': 450,
  '4th+': 250,
};

function assetValue(
  asset: TradeAsset,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
): { value: number; age: number | null } {
  if (asset.type === 'pick') {
    return { value: asset.pickValue ?? 0, age: null };
  }
  if (!asset.playerId) return { value: 0, age: null };
  // Goes through the shared resolver (curated value, falling back to a
  // search_rank estimate) rather than reading the curated map directly -
  // otherwise any non-curated player added to a trade silently counted as
  // worth zero in this exact math, even though the UI displayed a value for them.
  const resolved = resolvePlayerValue(asset.playerId, players, tradeValues);
  return { value: resolved.consensusValue, age: resolved.age };
}

function summarizeSide(assets: TradeAsset[], players: PlayersMap, tradeValues: Map<string, TradeValueEntry>): TradeSideResult {
  const withValues = assets.map((a) => assetValue(a, players, tradeValues));
  const totalValue = withValues.reduce((s, v) => s + v.value, 0);
  const ages = withValues.map((v) => v.age).filter((a): a is number => a !== null);
  const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
  return { assets, totalValue, avgAge };
}

export function analyzeTrade(
  sideAAssets: TradeAsset[],
  sideBAssets: TradeAsset[],
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
): TradeResult {
  const sideA = summarizeSide(sideAAssets, players, tradeValues);
  const sideB = summarizeSide(sideBAssets, players, tradeValues);

  const total = sideA.totalValue + sideB.totalValue;
  // "Team A gives" sideA, "Team B gives" sideB - so Team A *receives* sideB's
  // value and *gives up* sideA's value. Team A comes out ahead when what they
  // receive (sideB) exceeds what they give (sideA), i.e. deltaPct should be
  // positive when sideB.totalValue > sideA.totalValue. (Previously this was
  // inverted - the side that GAVE more value was shown as the "winner",
  // which is backwards: giving away more than you receive is a loss, not a
  // win. That inversion is what surfaced as "wrong winner" reports.)
  const deltaPct = total === 0 ? 0 : Math.round(((sideB.totalValue - sideA.totalValue) / total) * 200);

  let winner: 'A' | 'B' | 'even' = 'even';
  if (deltaPct > 3) winner = 'A';
  else if (deltaPct < -3) winner = 'B';

  debugLog('analyzeTrade', {
    sideAValue: sideA.totalValue,
    sideBValue: sideB.totalValue,
    deltaPct,
    winner,
  });

  return { sideA, sideB, deltaPct, winner };
}

type AssetFit = 'future' | 'winNow' | 'neutral';

/** Whether an asset's profile leans toward a rebuild ("future") or a win-now push, based on player age vs. positional peak, or pick=future. */
function assetFit(asset: TradeAsset, players: PlayersMap, tradeValues: Map<string, TradeValueEntry>): AssetFit {
  if (asset.type === 'pick') return 'future';
  if (!asset.playerId) return 'neutral';
  const resolved = resolvePlayerValue(asset.playerId, players, tradeValues);
  if (resolved.age == null) return 'neutral';
  const { start } = peakAgeRange(resolved.position);
  return resolved.age < start ? 'future' : 'winNow';
}

/** How well an asset's fit ("future" vs. "winNow") matches a team's current roster-construction phase. */
function fitMultiplier(fit: AssetFit, phase: LifecyclePhase | null): number {
  if (fit === 'neutral' || phase === null || phase === 'middle') return 1;
  if (phase === 'rebuild') return fit === 'future' ? 1.15 : 0.85;
  if (phase === 'win-now') return fit === 'winNow' ? 1.15 : 0.85;
  // 'contend' - still wants win-now value but less punitively than a full rebuild penalizes futures
  return fit === 'winNow' ? 1.05 : 0.95;
}

export interface ContextualTradeResult {
  sideAContextualValue: number; // what Team A gives, valued through Team B's timeline (what B is receiving)
  sideBContextualValue: number; // what Team B gives, valued through Team A's timeline (what A is receiving)
  deltaPct: number; // positive = favors Team A, same convention as TradeResult.deltaPct
  winner: 'A' | 'B' | 'even';
  hasContext: boolean; // false when neither roster was selected, so this is identical to pure value
}

/**
 * Re-scores each side's assets by how well they fit the *receiving* team's
 * timeline (rebuild teams get more value from picks/young players, win-now
 * teams get more value from proven ready-now players), rather than the flat
 * consensus value used by analyzeTrade. Requires both rosters to be
 * selected (phaseA/phaseB) - falls back to the pure-value numbers otherwise.
 */
export function analyzeTradeContextual(
  sideAAssets: TradeAsset[],
  sideBAssets: TradeAsset[],
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  phaseA: LifecyclePhase | null,
  phaseB: LifecyclePhase | null,
): ContextualTradeResult {
  const hasContext = phaseA !== null && phaseB !== null;

  // sideA assets flow to Team B, so their contextual worth is judged against phaseB.
  const sideAContextualValue = sideAAssets.reduce((sum, asset) => {
    const { value } = assetValue(asset, players, tradeValues);
    return sum + value * fitMultiplier(assetFit(asset, players, tradeValues), phaseB);
  }, 0);
  // sideB assets flow to Team A, so their contextual worth is judged against phaseA.
  const sideBContextualValue = sideBAssets.reduce((sum, asset) => {
    const { value } = assetValue(asset, players, tradeValues);
    return sum + value * fitMultiplier(assetFit(asset, players, tradeValues), phaseA);
  }, 0);

  const total = sideAContextualValue + sideBContextualValue;
  const deltaPct = total === 0 ? 0 : Math.round(((sideBContextualValue - sideAContextualValue) / total) * 200);

  let winner: 'A' | 'B' | 'even' = 'even';
  if (deltaPct > 3) winner = 'A';
  else if (deltaPct < -3) winner = 'B';

  debugLog('analyzeTradeContextual', { sideAContextualValue, sideBContextualValue, deltaPct, winner, hasContext });

  return { sideAContextualValue: Math.round(sideAContextualValue), sideBContextualValue: Math.round(sideBContextualValue), deltaPct, winner, hasContext };
}

export function contextLabel(phase: LifecyclePhase): string {
  switch (phase) {
    case 'win-now':
      return 'win-now contender';
    case 'contend':
      return 'contender';
    case 'rebuild':
      return 'rebuild';
    default:
      return 'roster stuck in the middle';
  }
}

export function tradeContextAssessment(
  sideA: TradeSideResult,
  sideB: TradeSideResult,
  phaseA: LifecyclePhase | null,
  phaseB: LifecyclePhase | null,
): string {
  const ageDeltaAvailable = sideA.avgAge !== null && sideB.avgAge !== null;
  const gettingYounger = ageDeltaAvailable && sideB.avgAge! > sideA.avgAge!;

  const parts: string[] = [];
  if (ageDeltaAvailable) {
    const diff = Math.abs(sideA.avgAge! - sideB.avgAge!).toFixed(1);
    parts.push(
      gettingYounger
        ? `Team A is acquiring the younger assets on average (by ${diff} yrs) - fits a rebuild timeline.`
        : `Team A is acquiring the older assets on average (by ${diff} yrs) - fits a win-now push.`,
    );
  }
  if (phaseA) {
    parts.push(`Team A currently profiles as a ${contextLabel(phaseA)}.`);
  }
  if (phaseB) {
    parts.push(`Team B currently profiles as a ${contextLabel(phaseB)}.`);
  }
  return parts.join(' ');
}

export function playerPeakDescriptor(position: string): string {
  const { start, end } = peakAgeRange(position);
  return `${position} typically peaks ${start}-${end}`;
}

export function threeDValueSummary(v: ThreeDValue | undefined): string {
  if (!v) return 'No 3D-value data available.';
  return `Current: ${Math.round(v.currentProjection)} pts | 3-yr avg: ${Math.round(v.threeYearOutlook)} | 5-yr avg: ${Math.round(v.fiveYearOutlook)}`;
}
