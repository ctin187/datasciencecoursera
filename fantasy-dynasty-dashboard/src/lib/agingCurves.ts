import type { AgingCurveModel, MultiYearProjection, Position } from '../types';

/**
 * Position-specific aging curve models.
 *
 * These are informed by widely-cited fantasy football aging-curve research
 * (e.g. PlayerProfiler, PFF, and FantasyPoints studies on production by age):
 *  - RBs peak earliest and decline fastest (workload/injury attrition).
 *  - WRs peak a bit later (26-28) with a gentler decline curve.
 *  - TEs develop latest and hold value longest among skill positions.
 *  - QBs age most gracefully, often sustaining elite play into their mid-30s.
 *
 * Values are deliberately conservative, tunable approximations rather than a
 * fitted regression - treat them as directional guidance, not ground truth.
 */
export const AGING_CURVES: Record<Position, AgingCurveModel> = {
  QB: {
    position: 'QB',
    peakStart: 28,
    peakEnd: 32,
    declineStartRate: 0.02, // 2%/yr right after peak
    declineLateRate: 0.08, // 8%/yr past the cliff
    cliffAge: 36,
    breakoutFloor: 23,
  },
  RB: {
    position: 'RB',
    peakStart: 24,
    peakEnd: 27,
    declineStartRate: 0.05,
    declineLateRate: 0.12,
    cliffAge: 30,
    breakoutFloor: 21,
  },
  WR: {
    position: 'WR',
    peakStart: 26,
    peakEnd: 28,
    declineStartRate: 0.03,
    declineLateRate: 0.09,
    cliffAge: 31,
    breakoutFloor: 22,
  },
  TE: {
    position: 'TE',
    peakStart: 27,
    peakEnd: 30,
    declineStartRate: 0.03,
    declineLateRate: 0.08,
    cliffAge: 33,
    breakoutFloor: 23,
  },
  K: {
    position: 'K',
    peakStart: 26,
    peakEnd: 38,
    declineStartRate: 0.005,
    declineLateRate: 0.02,
    cliffAge: 42,
    breakoutFloor: 22,
  },
  DEF: {
    position: 'DEF',
    peakStart: 0,
    peakEnd: 99,
    declineStartRate: 0,
    declineLateRate: 0,
    cliffAge: 99,
    breakoutFloor: 0,
  },
};

function normalizePosition(position: string): Position {
  const p = position.toUpperCase();
  if (p in AGING_CURVES) return p as Position;
  return 'WR';
}

/**
 * Returns a multiplier relative to peak performance (1.0 = peak) for a given
 * age at a given position. Below peakStart, we ramp a player up from their
 * "breakout floor" age toward peak (rookies/sophomores rarely hit true peak
 * value immediately). At/within the peak window, multiplier is 1.0. After
 * peakEnd, we apply compounding annual decline, accelerating past cliffAge.
 */
export function ageMultiplier(position: string, age: number): number {
  const curve = AGING_CURVES[normalizePosition(position)];
  if (age <= curve.peakStart) {
    if (age <= curve.breakoutFloor) {
      // Rough linear ramp-in for very young players (limited opportunity/role).
      const ramp = Math.max(0.55, 0.55 + (age - (curve.breakoutFloor - 3)) * 0.1);
      return Math.min(1, Math.max(0.5, ramp));
    }
    // Ramp from breakout floor to peakStart.
    const span = Math.max(1, curve.peakStart - curve.breakoutFloor);
    const progress = (age - curve.breakoutFloor) / span;
    return 0.75 + 0.25 * Math.min(1, Math.max(0, progress));
  }
  if (age <= curve.peakEnd) {
    return 1.0;
  }
  // Post-peak decline, compounding year over year.
  let mult = 1.0;
  for (let y = curve.peakEnd + 1; y <= age; y++) {
    const rate = y > curve.cliffAge ? curve.declineLateRate : curve.declineStartRate;
    mult *= 1 - rate;
  }
  return Math.max(0.05, mult);
}

export function peakAgeRange(position: string): { start: number; end: number } {
  const curve = AGING_CURVES[normalizePosition(position)];
  return { start: curve.peakStart, end: curve.peakEnd };
}

export function isPastCliff(position: string, age: number): boolean {
  const curve = AGING_CURVES[normalizePosition(position)];
  return age > curve.cliffAge;
}

/**
 * Projects fantasy output for `years` seasons forward, applying the aging
 * curve to a current-season baseline projection.
 */
export function projectMultiYear(
  position: string,
  currentAge: number,
  currentYear: number,
  baselineProjection: number,
  years: number,
): MultiYearProjection[] {
  const baseMultiplier = ageMultiplier(position, currentAge);
  const projections: MultiYearProjection[] = [];
  for (let i = 0; i < years; i++) {
    const age = currentAge + i;
    const futureMultiplier = ageMultiplier(position, age);
    // Scale relative to the player's *current* multiplier so the baseline
    // projection anchors year 0 exactly, then future years move with the curve.
    const relative = baseMultiplier > 0 ? futureMultiplier / baseMultiplier : futureMultiplier;
    projections.push({
      year: currentYear + i,
      age,
      projectedPoints: Math.max(0, baselineProjection * relative),
      percentOfPeak: Math.round(futureMultiplier * 100),
    });
  }
  return projections;
}

export function retirementRisk(
  position: string,
  age: number,
): { risk: 'low' | 'medium' | 'high'; reason: string } {
  const curve = AGING_CURVES[normalizePosition(position)];
  const pos = normalizePosition(position);
  if (pos === 'RB' && age >= 29) {
    return { risk: 'high', reason: `RB at age ${age} is well past the typical decline cliff (${curve.cliffAge}); high injury-attrition risk.` };
  }
  if (pos === 'WR' && age >= 31) {
    return { risk: 'high', reason: `WR at age ${age} is past the typical decline cliff (${curve.cliffAge}).` };
  }
  if (pos === 'TE' && age >= 33) {
    return { risk: 'high', reason: `TE at age ${age} is past the typical decline cliff (${curve.cliffAge}).` };
  }
  if (pos === 'QB' && age >= 37) {
    return { risk: 'high', reason: `QB at age ${age} is past the typical decline cliff (${curve.cliffAge}).` };
  }
  if (age > curve.peakEnd) {
    return { risk: 'medium', reason: `${pos} at age ${age} is past peak (${curve.peakStart}-${curve.peakEnd}) but not yet at the decline cliff.` };
  }
  return { risk: 'low', reason: `${pos} at age ${age} is within or approaching peak window (${curve.peakStart}-${curve.peakEnd}).` };
}
