import { describe, it, expect } from 'vitest';
import { evaluateTrade } from './tradeSimulator';
import { explainTrade } from './explain';
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser } from '../types';

describe('evaluateTrade', () => {
  it('computes symmetric VOR deltas and a real championship-probability swing for a lopsided trade', () => {
    const NUM_TEAMS = 8;
    const rosters: SleeperRoster[] = Array.from({ length: NUM_TEAMS }, (_, i) => ({
      roster_id: i + 1,
      owner_id: `u${i + 1}`,
      league_id: 'L',
      players: i < 2 ? [] : [`p${i}a`, `p${i}b`],
      starters: [],
      settings: { wins: 4, losses: 4, ties: 0, fpts: 800 },
    }));
    rosters[0].players = ['a_qb', 'a_rb1', 'a_rb2', 'a_wr1'];
    rosters[1].players = ['b_qb', 'b_rb1', 'b_wr1', 'b_wr2'];
    const users: SleeperUser[] = rosters.map((r) => ({ user_id: r.owner_id!, display_name: `Team ${r.roster_id}`, avatar: null }));
    const league: SleeperLeague = {
      league_id: 'L', name: 'T', season: '2025', season_type: 'regular', sport: 'nfl', status: 'in_season',
      total_rosters: NUM_TEAMS, roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN'],
      scoring_settings: {}, settings: { playoff_teams: 4, playoff_week_start: 15 },
    };

    const rosterIds = rosters.map((r) => r.roster_id);
    const matchupsByWeek = new Map<number, SleeperMatchup[]>();
    for (let w = 1; w <= 6; w++) {
      const entries: SleeperMatchup[] = [];
      for (let i = 0; i < rosterIds.length; i += 2) {
        entries.push({ matchup_id: i, roster_id: rosterIds[i], points: 100 });
        entries.push({ matchup_id: i, roster_id: rosterIds[i + 1], points: 100 });
      }
      matchupsByWeek.set(w, entries);
    }
    for (let w = 7; w <= 14; w++) {
      const entries: SleeperMatchup[] = [];
      for (let i = 0; i < rosterIds.length; i += 2) {
        entries.push({ matchup_id: i, roster_id: rosterIds[i], points: 0 });
        entries.push({ matchup_id: i, roster_id: rosterIds[i + 1], points: 0 });
      }
      matchupsByWeek.set(w, entries);
    }

    const playerInfo = new Map([
      ['a_qb', { name: 'A QB', position: 'QB', vorPerGame: 3 }],
      ['a_rb1', { name: 'A RB1', position: 'RB', vorPerGame: 8 }],
      ['a_rb2', { name: 'A RB2', position: 'RB', vorPerGame: -1 }],
      ['a_wr1', { name: 'A WR1', position: 'WR', vorPerGame: 2 }],
      ['b_qb', { name: 'B QB', position: 'QB', vorPerGame: 4 }],
      ['b_rb1', { name: 'B RB1', position: 'RB', vorPerGame: 1 }],
      ['b_wr1', { name: 'B WR1', position: 'WR', vorPerGame: 9 }],
      ['b_wr2', { name: 'B WR2', position: 'WR', vorPerGame: -2 }],
    ]);

    const impact = evaluateTrade({
      league, rosters, users,
      rosterAId: 1, rosterBId: 2,
      playersAOut: ['a_rb2'],
      playersBOut: ['b_wr1'],
      playerInfo,
      seasonRawInputs: { matchupsByWeek, bracket: [] },
      seasonStatusReady: true,
      simulations: 800,
    });

    expect(impact.sideA.vorDelta).toBe(10); // gains a 9-VOR WR, loses a -1-VOR RB
    expect(impact.sideB.vorDelta).toBe(-10);
    expect(impact.probabilityImpactA).not.toBeNull();
    expect(impact.probabilityImpactA!.after.championship).toBeGreaterThan(impact.probabilityImpactA!.before.championship);
    expect(impact.probabilityImpactB!.after.championship).toBeLessThanOrEqual(impact.probabilityImpactB!.before.championship);

    // explain.ts should narrate only numbers already present on the result object.
    const lines = explainTrade(impact);
    expect(lines.join(' ')).toContain('Team 1');
    expect(lines.join(' ')).toContain('championship probability');
  });

  it('reports an explicit reason instead of a probability when the season sim is not ready', () => {
    const rosters: SleeperRoster[] = [
      { roster_id: 1, owner_id: 'u1', league_id: 'L', players: ['p1'], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
      { roster_id: 2, owner_id: 'u2', league_id: 'L', players: ['p2'], starters: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
    ];
    const users: SleeperUser[] = rosters.map((r) => ({ user_id: r.owner_id!, display_name: `Team ${r.roster_id}`, avatar: null }));
    const league: SleeperLeague = {
      league_id: 'L', name: 'T', season: '2025', season_type: 'regular', sport: 'nfl', status: 'pre_draft',
      total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: {}, settings: { playoff_teams: 2, playoff_week_start: 15 },
    };
    const impact = evaluateTrade({
      league, rosters, users, rosterAId: 1, rosterBId: 2,
      playersAOut: ['p1'], playersBOut: ['p2'],
      playerInfo: new Map(), seasonRawInputs: null, seasonStatusReady: false,
    });
    expect(impact.probabilityImpactA).toBeNull();
    expect(impact.probabilityUnavailableReason).toBeTruthy();
  });
});
