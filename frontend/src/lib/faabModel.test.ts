import { describe, it, expect } from 'vitest';
import { extractFaabHistory, computeRateDistribution, suggestBid } from './faabModel';
import type { SleeperTransaction } from '../types';

function waiverTx(overrides: Partial<SleeperTransaction> = {}): SleeperTransaction {
  return { type: 'waiver', status: 'complete', roster_ids: [], settings: {}, adds: null, drops: null, created: 0, leg: 1, ...overrides };
}

describe('extractFaabHistory', () => {
  const vorLookup = new Map([
    ['p1', { name: 'Player 1', vorPerGame: 4 }],
    ['p2', { name: 'Player 2', vorPerGame: 2 }],
    ['p4', { name: 'Player 4', vorPerGame: -1 }], // below replacement now
  ]);

  it('extracts only completed waiver claims and excludes non-waiver/failed transactions', () => {
    const txByWeek = new Map<number, SleeperTransaction[]>([
      [1, [
        waiverTx({ settings: { waiver_bid: 20 }, adds: { p1: 10 } }),
        { type: 'trade', status: 'complete', roster_ids: [10, 20], settings: {}, adds: null, drops: null, created: 0, leg: 1 },
      ]],
      [2, [
        waiverTx({ settings: { waiver_bid: 8 }, adds: { p2: 20 } }),
        waiverTx({ status: 'failed', settings: { waiver_bid: 50 }, adds: { p2: 30 } }),
      ]],
    ]);
    const history = extractFaabHistory(txByWeek, vorLookup);
    expect(history).toHaveLength(2);
    expect(history[0].dollarsPerVor).toBe(5); // 20/4
    expect(history[1].dollarsPerVor).toBe(4); // 8/2
  });

  it('nulls out the rate for a player who is below replacement now, without dropping the data point', () => {
    const txByWeek = new Map<number, SleeperTransaction[]>([[1, [waiverTx({ settings: { waiver_bid: 5 }, adds: { p4: 40 } })]]]);
    const history = extractFaabHistory(txByWeek, vorLookup);
    expect(history).toHaveLength(1);
    expect(history[0].dollarsPerVor).toBeNull();
  });
});

describe('computeRateDistribution', () => {
  it('refuses to compute a distribution from fewer than 3 real data points', () => {
    const oneDataPoint = [{ playerId: 'p', playerName: null, rosterId: 1, bid: 20, currentVorPerGame: 4, dollarsPerVor: 5, week: 1 }];
    expect(computeRateDistribution(oneDataPoint)).toBeNull();
  });

  it('computes percentile bands from real bids only (skipping null rates)', () => {
    const history = [
      { playerId: 'a', playerName: null, rosterId: 1, bid: 20, currentVorPerGame: 4, dollarsPerVor: 5, week: 1 },
      { playerId: 'b', playerName: null, rosterId: 2, bid: 8, currentVorPerGame: 2, dollarsPerVor: 4, week: 2 },
      { playerId: 'c', playerName: null, rosterId: 3, bid: 30, currentVorPerGame: 6, dollarsPerVor: 5, week: 3 },
      { playerId: 'd', playerName: null, rosterId: 4, bid: 5, currentVorPerGame: -1, dollarsPerVor: null, week: 3 },
    ];
    const dist = computeRateDistribution(history);
    expect(dist).toEqual({ n: 3, p25: 4.5, p50: 5, p75: 5 });
  });
});

describe('suggestBid', () => {
  it('scales the rate distribution by VOR and clamps to the remaining budget', () => {
    const dist = { n: 3, p25: 4, p50: 5, p75: 6 };
    expect(suggestBid(3, dist, 50)).toEqual({ low: 12, mid: 15, high: 18 });
    expect(suggestBid(3, dist, 10)).toEqual({ low: 10, mid: 10, high: 10 });
  });
});
