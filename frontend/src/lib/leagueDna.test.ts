import { describe, it, expect } from 'vitest';
import { buildLeagueDna } from './leagueDna';
import type { SleeperLeague, SleeperRoster, SleeperUser, SleeperTransaction } from '../types';

describe('buildLeagueDna', () => {
  it('attributes a manager\'s picks correctly across seasons even when their roster_id changes', () => {
    const league: SleeperLeague = {
      league_id: 'L25', name: 'T', season: '2025', season_type: 'regular', sport: 'nfl', status: 'in_season',
      total_rosters: 2, roster_positions: [], scoring_settings: {}, settings: { waiver_budget: 100 },
    };
    // Current season: u1 has roster_id=1, u2 has roster_id=2.
    const currentRosters: SleeperRoster[] = [
      { roster_id: 1, owner_id: 'u1', league_id: 'L25', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, total_moves: 5, waiver_budget_used: 20 } },
      { roster_id: 2, owner_id: 'u2', league_id: 'L25', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, total_moves: 2, waiver_budget_used: 0 } },
    ];
    const users: SleeperUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null },
      { user_id: 'u2', display_name: 'Bob', avatar: null },
    ];
    const currentPicks = [
      { round: 1, roster_id: 1, player_id: 'p1', picked_by: 'u1', pick_no: 1, draft_id: 'd25', metadata: { position: 'RB' } },
      { round: 6, roster_id: 2, player_id: 'p2', picked_by: 'u2', pick_no: 11, draft_id: 'd25', metadata: { position: 'RB' } },
    ];
    // Prior season: roster_id numbering is DIFFERENT - u1 was 9, u2 was 4.
    const priorRosters: SleeperRoster[] = [
      { roster_id: 9, owner_id: 'u1', league_id: 'L24', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
      { roster_id: 4, owner_id: 'u2', league_id: 'L24', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
    ];
    const priorPicks = [
      { round: 1, roster_id: 9, player_id: 'q1', picked_by: 'u1', pick_no: 1, draft_id: 'd24', metadata: { position: 'RB' } },
      { round: 6, roster_id: 4, player_id: 'q2', picked_by: 'u2', pick_no: 11, draft_id: 'd24', metadata: { position: 'RB' } },
    ];

    const profiles = buildLeagueDna({
      league,
      rosters: currentRosters,
      users,
      draftSeasons: [
        { season: '2025', rosters: currentRosters, draftPicks: currentPicks },
        { season: '2024', rosters: priorRosters, draftPicks: priorPicks },
      ],
      transactionsByWeek: new Map(),
    });

    const alice = profiles.find((p) => p.ownerId === 'u1')!;
    const bob = profiles.find((p) => p.ownerId === 'u2')!;

    expect(alice.draftSampleSize).toBe(2);
    expect(alice.seasonsOfDraftHistory).toBe(2);
    expect(alice.positionTendencies.find((t) => t.position === 'RB')?.avgRound).toBe(1);
    expect(bob.positionTendencies.find((t) => t.position === 'RB')?.avgRound).toBe(6);
    // League average pools all 4 picks: (1+6+1+6)/4 = 3.5
    expect(alice.positionTendencies.find((t) => t.position === 'RB')?.leagueAvgRound).toBe(3.5);
    expect(alice.positionTendencies.find((t) => t.position === 'RB')?.deltaRounds).toBe(2.5);
  });

  it('counts each side of a trade once and computes FAAB spend from real roster aggregates', () => {
    const league: SleeperLeague = {
      league_id: 'L', name: 'T', season: '2025', season_type: 'regular', sport: 'nfl', status: 'in_season',
      total_rosters: 2, roster_positions: [], scoring_settings: {}, settings: { waiver_budget: 100 },
    };
    const rosters: SleeperRoster[] = [
      { roster_id: 1, owner_id: 'u1', league_id: 'L', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, waiver_budget_used: 40 } },
      { roster_id: 2, owner_id: 'u2', league_id: 'L', players: [], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, waiver_budget_used: 0 } },
    ];
    const users: SleeperUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null },
      { user_id: 'u2', display_name: 'Bob', avatar: null },
    ];
    const transactionsByWeek = new Map<number, SleeperTransaction[]>([
      [1, [{ type: 'trade', status: 'complete', roster_ids: [1, 2], settings: {}, adds: null, drops: null, created: 0, leg: 1 }]],
    ]);

    const profiles = buildLeagueDna({
      league, rosters, users,
      draftSeasons: [{ season: '2025', rosters, draftPicks: [] }],
      transactionsByWeek,
    });

    expect(profiles.find((p) => p.ownerId === 'u1')?.tradesCount).toBe(1);
    expect(profiles.find((p) => p.ownerId === 'u2')?.tradesCount).toBe(1);
    expect(profiles.find((p) => p.ownerId === 'u1')?.faabSpentPct).toBe(40);
    expect(profiles.find((p) => p.ownerId === 'u2')?.faabSpentPct).toBe(0);
  });
});
