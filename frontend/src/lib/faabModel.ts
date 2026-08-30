// ---------------------------------------------------------------------------
// FAAB bid guidance from this league's own real bidding history - not a
// generic "typical FAAB %" heuristic and not a fabricated win-probability
// model. Every winning FAAB waiver claim this season is a real data point:
// (amount paid, player added). Joined against that player's CURRENT VOR
// (the best available signal - the value at the time of the add isn't
// recoverable from Sleeper's API), it gives an empirical $-per-VOR-point
// rate for this specific league. A new target's suggested bid is that
// rate's own percentile band applied to the target's VOR - a real
// distribution's spread, not an invented confidence interval.
// ---------------------------------------------------------------------------

import type { SleeperTransaction } from '../types';

export interface FaabDataPoint {
  playerId: string;
  playerName: string | null;
  rosterId: number;
  bid: number;
  currentVorPerGame: number | null;
  dollarsPerVor: number | null; // null when vorPerGame <= 0 (ratio would be meaningless/negative)
  week: number;
}

export interface FaabRateDistribution {
  n: number;
  p25: number;
  p50: number;
  p75: number;
}

export interface BidSuggestion {
  low: number;
  mid: number;
  high: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Extracts every winning FAAB waiver claim from a season's transactions, joined against current VOR by sleeper_id. */
export function extractFaabHistory(
  transactionsByWeek: Map<number, SleeperTransaction[]>,
  vorLookup: Map<string, { name: string | null; vorPerGame: number | null }>,
): FaabDataPoint[] {
  const out: FaabDataPoint[] = [];
  for (const [week, txs] of transactionsByWeek) {
    for (const tx of txs) {
      if (tx.type !== 'waiver' || tx.status !== 'complete') continue;
      const bid = tx.settings?.waiver_bid;
      if (bid === undefined || bid === null) continue;
      if (!tx.adds) continue;
      for (const [playerId, rosterId] of Object.entries(tx.adds)) {
        const v = vorLookup.get(playerId);
        const vor = v?.vorPerGame ?? null;
        out.push({
          playerId,
          playerName: v?.name ?? null,
          rosterId,
          bid,
          currentVorPerGame: vor,
          dollarsPerVor: vor !== null && vor > 0.1 ? bid / vor : null,
          week,
        });
      }
    }
  }
  return out;
}

export function computeRateDistribution(history: FaabDataPoint[]): FaabRateDistribution | null {
  const rates = history.map((h) => h.dollarsPerVor).filter((r): r is number => r !== null).sort((a, b) => a - b);
  if (rates.length < 3) return null; // too few real data points to trust a percentile band
  return { n: rates.length, p25: percentile(rates, 0.25), p50: percentile(rates, 0.5), p75: percentile(rates, 0.75) };
}

export function suggestBid(vorPerGame: number, distribution: FaabRateDistribution, budgetRemaining: number | null): BidSuggestion {
  const clamp = (x: number) => Math.max(0, Math.round(budgetRemaining !== null ? Math.min(x, budgetRemaining) : x));
  return {
    low: clamp(vorPerGame * distribution.p25),
    mid: clamp(vorPerGame * distribution.p50),
    high: clamp(vorPerGame * distribution.p75),
  };
}
