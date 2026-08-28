import type { ConsensusADP, Position, ThreeDValue } from '../types';
import { projectMultiYear } from './agingCurves';

/**
 * Approximates a current-season fantasy-points baseline from consensus ADP
 * rank using a decay curve. This is a relative ranking signal (for
 * percentile comparison and aging-curve projection), not a precise points
 * projection - the app does not have access to a licensed weekly
 * points-projection feed, so this stands in for "Sleeper player
 * projections" referenced in the spec.
 */
const POSITION_BASE: Record<Position, number> = {
  QB: 380,
  RB: 300,
  WR: 290,
  TE: 220,
  K: 140,
  DEF: 130,
  DL: 200,
  LB: 220,
  DB: 190,
};

function baselineProjection(position: Position, consensusAdpRank: number): number {
  const base = POSITION_BASE[position] ?? 250;
  // Smooth decay: rank 1 ~= base, rank 100 ~= ~35% of base, asymptotic floor.
  const decay = base / Math.pow(1 + consensusAdpRank / 18, 0.9);
  return Math.max(15, Math.round(decay));
}

const CURRENT_SEASON = new Date().getFullYear();

export function computeThreeDValue(adp: ConsensusADP): ThreeDValue {
  const current = baselineProjection(adp.position, adp.consensusAdp);
  const age = adp.age ?? 25;
  const multiYear = projectMultiYear(adp.position, age, CURRENT_SEASON, current, 10);

  const avg = (n: number) => multiYear.slice(0, n).reduce((s, p) => s + p.projectedPoints, 0) / n;
  const threeYearOutlook = avg(3);
  const fiveYearOutlook = avg(5);
  const tenYearOutlook = avg(10);

  const blendedValue = current * 0.4 + threeYearOutlook * 0.3 + fiveYearOutlook * 0.2 + tenYearOutlook * 0.1;

  return {
    playerId: adp.playerId,
    currentProjection: current,
    threeYearOutlook,
    fiveYearOutlook,
    tenYearOutlook,
    blendedValue,
    percentile: 0, // filled in by computePercentiles
    multiYear,
  };
}

/** Computes 0-100 percentile of blendedValue within the given pool, mutating in place-safe copies. */
export function computePercentiles(values: ThreeDValue[]): ThreeDValue[] {
  const sorted = [...values].sort((a, b) => a.blendedValue - b.blendedValue);
  const n = sorted.length;
  const rankById = new Map<string, number>();
  sorted.forEach((v, i) => rankById.set(v.playerId, i));
  return values.map((v) => ({
    ...v,
    percentile: n <= 1 ? 100 : Math.round((rankById.get(v.playerId)! / (n - 1)) * 100),
  }));
}

export function computeThreeDValuesForPool(adpRows: ConsensusADP[]): Map<string, ThreeDValue> {
  const raw = adpRows.map(computeThreeDValue);
  const withPercentiles = computePercentiles(raw);
  return new Map(withPercentiles.map((v) => [v.playerId, v]));
}

/**
 * 3D-Value overall rank vs. consensus ADP rank tells us sleeper/reach status.
 * Positive delta (ADP rank number > 3D value rank number) = player going
 * later than their long-term value suggests = sleeper.
 */
export function adpValueRank(adpRows: ConsensusADP[], threeDValues: Map<string, ThreeDValue>) {
  const byBlended = [...adpRows].sort((a, b) => {
    const av = threeDValues.get(a.playerId)?.blendedValue ?? 0;
    const bv = threeDValues.get(b.playerId)?.blendedValue ?? 0;
    return bv - av;
  });
  const valueRank = new Map<string, number>();
  byBlended.forEach((p, i) => valueRank.set(p.playerId, i + 1));

  const byAdp = [...adpRows].sort((a, b) => a.consensusAdp - b.consensusAdp);
  const adpRank = new Map<string, number>();
  byAdp.forEach((p, i) => adpRank.set(p.playerId, i + 1));

  return { valueRank, adpRank };
}

export type SleeperReachStatus = 'SLEEPER' | 'REACH' | 'FAIR';

export function classifySleeperReach(adpRank: number, valueRank: number): SleeperReachStatus {
  const delta = adpRank - valueRank; // positive = value rank better (lower number) than ADP rank
  if (delta >= 8) return 'SLEEPER';
  if (delta <= -8) return 'REACH';
  return 'FAIR';
}
