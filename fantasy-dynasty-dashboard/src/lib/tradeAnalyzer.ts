import type { LifecyclePhase, ThreeDValue, TradeValueEntry } from '../types';
import { peakAgeRange } from './agingCurves';

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
  tradeValues: Map<string, TradeValueEntry>,
): { value: number; age: number | null } {
  if (asset.type === 'pick') {
    return { value: asset.pickValue ?? 0, age: null };
  }
  const entry = asset.playerId ? tradeValues.get(asset.playerId) : undefined;
  return { value: entry?.consensusValue ?? 0, age: entry?.age ?? null };
}

function summarizeSide(assets: TradeAsset[], tradeValues: Map<string, TradeValueEntry>): TradeSideResult {
  const withValues = assets.map((a) => assetValue(a, tradeValues));
  const totalValue = withValues.reduce((s, v) => s + v.value, 0);
  const ages = withValues.map((v) => v.age).filter((a): a is number => a !== null);
  const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
  return { assets, totalValue, avgAge };
}

export function analyzeTrade(
  sideAAssets: TradeAsset[],
  sideBAssets: TradeAsset[],
  tradeValues: Map<string, TradeValueEntry>,
): TradeResult {
  const sideA = summarizeSide(sideAAssets, tradeValues);
  const sideB = summarizeSide(sideBAssets, tradeValues);

  const total = sideA.totalValue + sideB.totalValue;
  const deltaPct = total === 0 ? 0 : Math.round(((sideA.totalValue - sideB.totalValue) / total) * 200);

  let winner: 'A' | 'B' | 'even' = 'even';
  if (deltaPct > 3) winner = 'A';
  else if (deltaPct < -3) winner = 'B';

  return { sideA, sideB, deltaPct, winner };
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
