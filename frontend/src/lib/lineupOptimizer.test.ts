import { describe, it, expect } from 'vitest';
import { optimizeLineup } from './lineupOptimizer';

describe('optimizeLineup', () => {
  it('fills dedicated slots first, then flex with the best remaining player', () => {
    const rosterPositions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];
    const pool = [
      { sleeperId: 'qb1', position: 'QB', vorPerGame: 5 },
      { sleeperId: 'rb1', position: 'RB', vorPerGame: 8 },
      { sleeperId: 'rb2', position: 'RB', vorPerGame: 3 },
      { sleeperId: 'rb3', position: 'RB', vorPerGame: 1 },
      { sleeperId: 'wr1', position: 'WR', vorPerGame: 6 },
      { sleeperId: 'wr2', position: 'WR', vorPerGame: 2 },
      { sleeperId: 'te1', position: 'TE', vorPerGame: 4 },
    ];

    const result = optimizeLineup(rosterPositions, pool);

    expect(result.starterVorTotal).toBe(29); // 5+8+3+6+2+4+1
    const flexSlot = result.assignments.find((a) => a.slot === 'FLEX');
    expect(flexSlot?.sleeperId).toBe('rb3'); // only RB left over after dedicated slots fill
  });

  it('leaves a slot empty when nobody eligible remains', () => {
    const result = optimizeLineup(['QB', 'RB'], [{ sleeperId: 'rb1', position: 'RB', vorPerGame: 4 }]);
    const qbSlot = result.assignments.find((a) => a.slot === 'QB');
    expect(qbSlot?.sleeperId).toBeNull();
    expect(result.starterVorTotal).toBe(4);
  });

  it('never assigns a player with a null VOR (unprojected)', () => {
    const result = optimizeLineup(['RB'], [{ sleeperId: 'rb1', position: 'RB', vorPerGame: null }]);
    expect(result.assignments[0].sleeperId).toBeNull();
  });

  it('recognizes SUPER_FLEX as QB/RB/WR/TE eligible', () => {
    const result = optimizeLineup(
      ['QB', 'SUPER_FLEX'],
      [
        { sleeperId: 'qb1', position: 'QB', vorPerGame: 5 },
        { sleeperId: 'qb2', position: 'QB', vorPerGame: 10 },
      ],
    );
    // Most-restrictive-first ordering means QB (1 eligible pos) fills before SUPER_FLEX (4 eligible pos).
    // Both QBs are eligible for both slots, so the optimizer should still place both since it's a pure greedy
    // best-VOR-first fill within each slot's eligible pool.
    expect(result.starterVorTotal).toBe(15);
  });
});
