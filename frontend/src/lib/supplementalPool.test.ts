import { describe, it, expect } from 'vitest';
import { buildSupplementalPool, buildFullFallbackPool, unprojectedPositions } from './supplementalPool';
import { detectLeagueFormat } from './leagueFormat';
import { buildAvailableBoard } from './draftAssistant';
import type { PlayersMap } from '../types';
import type { PooledPlayer } from '../hooks/useProjectionPool';

function player(id: string, position: string, rank: number | null, over: Partial<Record<string, unknown>> = {}) {
  return {
    player_id: id,
    first_name: 'First',
    last_name: id,
    full_name: `Player ${id}`,
    position,
    team: 'NE',
    age: 26,
    years_exp: 3,
    status: 'Active',
    search_rank: rank,
    ...over,
  };
}

const IDP_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'BN', 'BN'];
const STANDARD_LEAGUE = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'];

const players: PlayersMap = Object.fromEntries(
  [
    player('qb1', 'QB', 10),
    player('rb1', 'RB', 5),
    player('k1', 'K', 300),
    player('k2', 'K', 150),
    player('def1', 'DEF', 400, { team: null, status: undefined }),
    player('dl1', 'DL', 500),
    player('lb1', 'LB', 450),
    player('db1', 'DB', 600),
    player('retired', 'K', 9999999),
    player('inactive', 'LB', 200, { status: 'Inactive' }),
    player('noteam', 'DL', 210, { team: null }),
  ].map((p) => [p.player_id, p]),
) as unknown as PlayersMap;

describe('unprojectedPositions', () => {
  it('names only team defense - every other rostered position is projected', () => {
    // K and IDP were here until nflverse's kicking and defensive columns were
    // wired into the scoring engine. A team defense has no per-player stat
    // line to project, so it is the one position that still needs a fallback.
    expect(unprojectedPositions(detectLeagueFormat(IDP_LEAGUE))).toEqual(['DEF']);
  });

  it('is empty for a standard league, so nothing is supplemented needlessly', () => {
    expect(unprojectedPositions(detectLeagueFormat(STANDARD_LEAGUE))).toEqual([]);
  });
});

describe('buildSupplementalPool', () => {
  const pool = buildSupplementalPool(players, detectLeagueFormat(IDP_LEAGUE), new Set());

  it('includes team defenses', () => {
    const positions = new Set([...pool.values()].map((p) => p.position));
    expect(positions).toEqual(new Set(['DEF']));
  });

  it('does NOT include any position the backend projects', () => {
    // Everything here now arrives with a real VOR, so supplementing it would
    // shadow a real number with a relevance ordinal.
    for (const id of ['qb1', 'rb1', 'k1', 'k2', 'dl1', 'lb1', 'db1']) {
      expect(pool.has(id)).toBe(false);
    }
  });

  it('orders by Sleeper rank, best first', () => {
    const defenses = [...pool.values()].filter((p) => p.position === 'DEF');
    expect(defenses.map((d) => d.sleeperId)).toEqual(['def1']);
  });

  it('keeps team defenses, which legitimately have no status or team', () => {
    expect(pool.has('def1')).toBe(true);
  });

  it('never shadows a player the backend already valued', () => {
    const withExisting = buildSupplementalPool(players, detectLeagueFormat(IDP_LEAGUE), new Set(['def1']));
    expect(withExisting.has('def1')).toBe(false);
  });

  it('marks every row as rank-sourced, never as a projection', () => {
    expect([...pool.values()].every((p) => p.valueSource === 'sleeper-rank')).toBe(true);
  });
});

// The roster filters live in the shared collector, so they are exercised
// against the full fallback pool - the one path that still pools kickers and
// IDP, when the backend is unreachable and there are no projections at all.
describe('buildFullFallbackPool roster filters', () => {
  const pool = buildFullFallbackPool(players, detectLeagueFormat(IDP_LEAGUE));

  it('drops retired/irrelevant players above the rank ceiling', () => {
    expect(pool.has('retired')).toBe(false);
  });

  it('drops inactive players and free agents without a team', () => {
    expect(pool.has('inactive')).toBe(false);
    expect(pool.has('noteam')).toBe(false);
  });

  it('keeps team defenses, which legitimately have no status or team', () => {
    expect(pool.has('def1')).toBe(true);
  });

  it('orders each position by Sleeper rank, best first', () => {
    const kickers = [...pool.values()].filter((p) => p.position === 'K');
    expect(kickers.map((k) => k.sleeperId)).toEqual(['k2', 'k1']);
  });
});

describe('buildFullFallbackPool', () => {
  it('covers skill positions too, so the board still works with no backend', () => {
    const pool = buildFullFallbackPool(players, detectLeagueFormat(IDP_LEAGUE));
    expect(pool.has('qb1')).toBe(true);
    expect(pool.has('rb1')).toBe(true);
    expect(pool.has('k1')).toBe(true);
  });
});

describe('buildAvailableBoard keeps unprojected positions on the board', () => {
  const pooled = new Map<string, PooledPlayer>([
    ['rb1', { sleeperId: 'rb1', gsisId: 'g1', name: 'RB One', position: 'RB', team: 'NE', projectedPointsPerGame: 18, vorPerGame: 6, restOfSeasonPoints: 0, valueSource: 'backend-vor', sleeperRank: null }],
    ['rb2', { sleeperId: 'rb2', gsisId: 'g2', name: 'RB Two', position: 'RB', team: 'NE', projectedPointsPerGame: 12, vorPerGame: 2, restOfSeasonPoints: 0, valueSource: 'backend-vor', sleeperRank: null }],
    ['k1', { sleeperId: 'k1', gsisId: '', name: 'Kicker One', position: 'K', team: 'NE', projectedPointsPerGame: 0, vorPerGame: null, restOfSeasonPoints: 0, valueSource: 'sleeper-rank', sleeperRank: 150 }],
    ['lb1', { sleeperId: 'lb1', gsisId: '', name: 'Backer One', position: 'LB', team: 'NE', projectedPointsPerGame: 0, vorPerGame: null, restOfSeasonPoints: 0, valueSource: 'sleeper-rank', sleeperRank: 90 }],
  ]);

  const board = buildAvailableBoard({
    pool: pooled,
    draftedSleeperIds: new Set(),
    rosterPositions: IDP_LEAGUE,
    myCurrentPlayerIds: [],
  });

  it('includes rank-only players instead of filtering them out (the original bug)', () => {
    expect(board.map((r) => r.sleeperId).sort()).toEqual(['k1', 'lb1', 'rb1', 'rb2']);
  });

  it('sorts VOR-scored players ahead of rank-only ones', () => {
    expect(board.slice(0, 2).map((r) => r.sleeperId)).toEqual(['rb1', 'rb2']);
  });

  it('orders rank-only players among themselves by Sleeper rank', () => {
    expect(board.slice(2).map((r) => r.sleeperId)).toEqual(['lb1', 'k1']);
  });

  it('leaves VOR null for rank-only players rather than inventing one', () => {
    expect(board.find((r) => r.sleeperId === 'k1')?.vorPerGame).toBeNull();
  });

  it('does not report a positional drop-off between two rank-only players', () => {
    expect(board.find((r) => r.sleeperId === 'lb1')?.dropToNextAtPosition).toBeNull();
  });

  it('still computes drop-off between two genuinely projected players', () => {
    expect(board.find((r) => r.sleeperId === 'rb1')?.dropToNextAtPosition).toBeCloseTo(4);
  });

  it('respects drafted players', () => {
    const after = buildAvailableBoard({
      pool: pooled,
      draftedSleeperIds: new Set(['k1']),
      rosterPositions: IDP_LEAGUE,
      myCurrentPlayerIds: [],
    });
    expect(after.some((r) => r.sleeperId === 'k1')).toBe(false);
  });
});
