import { describe, it, expect } from 'vitest';
import { buildDraftBoard, sortByRosterNeed, startingSlots } from './draftBoard';
import type { PlayersMap } from '../types';

const player = (id: string, position: string, search_rank: number, extra: Record<string, unknown> = {}) => ({
  player_id: id, first_name: id.toUpperCase(), last_name: 'X', full_name: `${id} X`,
  position, team: 'NE', status: 'Active', search_rank, ...extra,
});

const IDP_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'LB', 'DB', 'BN', 'BN'];

const players = Object.fromEntries(
  [
    player('wr1', 'WR', 1), player('wr2', 'WR', 4), player('wr3', 'WR', 9),
    player('rb1', 'RB', 2), player('rb2', 'RB', 6),
    player('qb1', 'QB', 3),
    player('te1', 'TE', 8),
    player('lb1', 'LB', 5), player('lb2', 'LB', 7),
    player('dl1', 'DL', 10),
    player('db1', 'DB', 11),
    player('k1', 'K', 12),
    player('def1', 'DEF', 13, { team: null, status: undefined }),
    player('retired', 'WR', 9999999),
    player('inactive', 'RB', 14, { status: 'Inactive' }),
    player('noteam', 'LB', 15, { team: null }),
  ].map((p) => [p.player_id, p]),
) as unknown as PlayersMap;

const build = (drafted: string[] = [], mine: string[] = []) =>
  buildDraftBoard({
    players,
    draftedSleeperIds: new Set(drafted),
    rosterPositions: IDP_LEAGUE,
    numTeams: 10,
    myPlayerIds: mine,
  });

describe('startingSlots', () => {
  it('separates dedicated slots from flex, and ignores bench', () => {
    const s = startingSlots(IDP_LEAGUE);
    expect(s.dedicated).toMatchObject({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, DL: 1, LB: 2, DB: 1 });
    expect(s.offenseFlex).toBe(1);
    expect(s.dedicated.BN).toBeUndefined();
  });
});

describe('buildDraftBoard', () => {
  it('orders by Sleeper consensus across every position', () => {
    const { players: board } = build();
    expect(board.slice(0, 5).map((p) => p.sleeperId)).toEqual(['wr1', 'rb1', 'qb1', 'wr2', 'lb1']);
  });

  it('covers every position the league starts, including K, DEF and IDP', () => {
    const positions = new Set(build().players.map((p) => p.position));
    expect(positions).toEqual(new Set(['WR', 'RB', 'QB', 'TE', 'LB', 'DL', 'DB', 'K', 'DEF']));
  });

  it('drops retired, inactive and teamless players, but keeps team defenses', () => {
    const ids = new Set(build().players.map((p) => p.sleeperId));
    expect(ids.has('retired')).toBe(false);
    expect(ids.has('inactive')).toBe(false);
    expect(ids.has('noteam')).toBe(false);
    expect(ids.has('def1')).toBe(true);
  });

  it('removes drafted players and re-ranks the position behind them', () => {
    const { players: board } = build(['wr1']);
    expect(board.some((p) => p.sleeperId === 'wr1')).toBe(false);
    // wr2 was WR2; with wr1 gone it is now the best receiver available.
    expect(board.find((p) => p.sleeperId === 'wr2')?.posRankAvailable).toBe(1);
  });

  it('counts a flex slot toward the positions eligible for it', () => {
    // 10 teams x 2 RB = 20 dedicated, plus 10 flex split across RB/WR/TE.
    const rb = build().players.find((p) => p.sleeperId === 'rb1')!;
    expect(rb.startersLeftAtPosition).toBeGreaterThan(20);
  });

  it('reports roster needs against dedicated starting slots only', () => {
    const { needs } = build([], ['lb1']);
    expect(needs.find((n) => n.position === 'LB')).toMatchObject({ required: 2, filled: 1, remaining: 1 });
    expect(needs.find((n) => n.position === 'QB')).toMatchObject({ required: 1, filled: 0, remaining: 1 });
  });

  it('stops flagging a need once its slots are full', () => {
    const { neededPositions } = build([], ['qb1', 'lb1', 'lb2']);
    expect(neededPositions).not.toContain('QB');
    expect(neededPositions).not.toContain('LB');
  });

  it('does not let extra depth at one position mask a real hole', () => {
    // Three receivers for two slots must not count toward anything else.
    const { needs } = build([], ['wr1', 'wr2', 'wr3']);
    expect(needs.find((n) => n.position === 'WR')?.remaining).toBe(0);
    expect(needs.find((n) => n.position === 'RB')?.remaining).toBe(2);
  });
});

describe('sortByRosterNeed', () => {
  it('puts positions you still have to start ahead of ones you do not', () => {
    // Roster already has both receivers; RB/QB/etc are still open.
    const { players: board } = build([], ['wr1', 'wr2']);
    const sorted = sortByRosterNeed(board);
    expect(sorted[0].fillsStartingNeed).toBe(true);
    const firstWr = sorted.findIndex((p) => p.position === 'WR');
    const firstRb = sorted.findIndex((p) => p.position === 'RB');
    expect(firstRb).toBeLessThan(firstWr);
  });

  it('keeps Sleeper consensus order within a position', () => {
    const sorted = sortByRosterNeed(build().players);
    const wrs = sorted.filter((p) => p.position === 'WR').map((p) => p.sleeperId);
    expect(wrs).toEqual(['wr1', 'wr2', 'wr3']);
  });

  it('never buries a better player behind a worse one at another needed position', () => {
    // Regression: an earlier version ordered needed positions by scarcity using
    // a per-PLAYER supply figure that shrinks with positional rank, so the sort
    // surfaced each position's worst players first - RB14 above RB1.
    const sorted = sortByRosterNeed(build().players).filter((p) => p.fillsStartingNeed);
    const ranks = sorted.map((p) => p.overallRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('offers the best available player who fills a hole', () => {
    // Roster has both receivers, so the top pick must be the best non-WR.
    const { players: board } = build([], ['wr1', 'wr2']);
    const best = sortByRosterNeed(board)[0];
    expect(best.fillsStartingNeed).toBe(true);
    expect(best.sleeperId).toBe('rb1'); // rank 2, best of everything still needed
  });
});
