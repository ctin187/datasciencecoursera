import { describe, it, expect } from 'vitest';
import { computeDraftBoard } from './draftAssistant';
import type { SleeperDraft, SleeperDraftPick } from '../types';

function pick(overrides: Partial<SleeperDraftPick> = {}): SleeperDraftPick {
  return { round: 1, roster_id: 1, player_id: 'p', picked_by: '', pick_no: 1, draft_id: 'd1', ...overrides };
}

describe('computeDraftBoard', () => {
  const draft: SleeperDraft = {
    draft_id: 'd1', league_id: 'L', status: 'drafting', type: 'snake', start_time: null,
    settings: { rounds: 3, teams: 4 }, season: '2025',
    slot_to_roster_id: { '1': 10, '2': 20, '3': 30, '4': 40 },
  };

  it('computes pick 1 as round 1, slot 1', () => {
    const board = computeDraftBoard(draft, []);
    expect(board).toMatchObject({ onClockPickNo: 1, onClockRound: 1, onClockRosterId: 10 });
  });

  it('reverses slot order on even rounds (snake)', () => {
    const board = computeDraftBoard(draft, Array(4).fill(pick()));
    expect(board).toMatchObject({ onClockPickNo: 5, onClockRound: 2, onClockRosterId: 40 });
  });

  it('does not reverse on a linear draft', () => {
    const linear: SleeperDraft = { ...draft, type: 'linear' };
    const board = computeDraftBoard(linear, Array(4).fill(pick()));
    expect(board.onClockRosterId).toBe(10);
  });

  it('reports nobody on the clock once every round has been picked', () => {
    const board = computeDraftBoard(draft, Array(12).fill(pick())); // 3 rounds x 4 teams
    expect(board.onClockRosterId).toBeNull();
  });
});

