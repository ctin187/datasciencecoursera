import { describe, it, expect } from 'vitest';
import { runSeasonSimulation } from './seasonSimulator';
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser } from '../types';

function makeLeague(overrides: Partial<SleeperLeague['settings']> = {}): SleeperLeague {
  return {
    league_id: 'L',
    name: 'Test League',
    season: '2025',
    season_type: 'regular',
    sport: 'nfl',
    status: 'in_season',
    total_rosters: 10,
    roster_positions: [],
    scoring_settings: {},
    settings: { playoff_teams: 6, playoff_week_start: 15, ...overrides },
  };
}

function makeRosters(n: number): SleeperRoster[] {
  return Array.from({ length: n }, (_, i) => ({
    roster_id: i + 1,
    owner_id: `u${i + 1}`,
    league_id: 'L',
    players: [],
    starters: [],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0 },
  }));
}

function makeUsers(rosters: SleeperRoster[]): SleeperUser[] {
  return rosters.map((r) => ({ user_id: r.owner_id!, display_name: `Team ${r.roster_id}`, avatar: null }));
}

describe('runSeasonSimulation', () => {
  it('refuses to simulate with zero completed weeks', () => {
    const rosters = makeRosters(4);
    const result = runSeasonSimulation({
      league: makeLeague({ playoff_teams: 2 }),
      rosters,
      users: makeUsers(rosters),
      matchupsByWeek: new Map(),
    });
    expect(result.status).toBe('insufficient-data');
    expect(result.teams).toHaveLength(0);
  });

  it('playoff and championship probabilities sum to exactly the playoff-team count and 1, respectively', () => {
    const NUM_TEAMS = 10;
    const rosters = makeRosters(NUM_TEAMS);
    const users = makeUsers(rosters);
    const league = makeLeague({ playoff_teams: 6, playoff_week_start: 15 });
    const rosterIds = rosters.map((r) => r.roster_id);

    const matchupsByWeek = new Map<number, SleeperMatchup[]>();
    // 8 played weeks with random-ish but deterministic scores around a per-team true mean.
    const trueMean = (id: number) => 100 + id * 2;
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 1000) / 1000;
    };
    for (let w = 1; w <= 8; w++) {
      const entries: SleeperMatchup[] = [];
      for (let i = 0; i < rosterIds.length; i += 2) {
        const a = rosterIds[i];
        const b = rosterIds[i + 1];
        const scoreA = Math.max(0, trueMean(a) + (rand() - 0.5) * 20);
        const scoreB = Math.max(0, trueMean(b) + (rand() - 0.5) * 20);
        entries.push({ matchup_id: i, roster_id: a, points: scoreA });
        entries.push({ matchup_id: i, roster_id: b, points: scoreB });
        const rosterA = rosters.find((r) => r.roster_id === a)!;
        const rosterB = rosters.find((r) => r.roster_id === b)!;
        rosterA.settings.fpts += scoreA;
        rosterB.settings.fpts += scoreB;
        if (scoreA > scoreB) {
          rosterA.settings.wins++;
          rosterB.settings.losses++;
        } else {
          rosterB.settings.wins++;
          rosterA.settings.losses++;
        }
      }
      matchupsByWeek.set(w, entries);
    }
    // Future weeks: published schedule, points 0.
    for (let w = 9; w <= 14; w++) {
      const shuffled = [...rosterIds].sort(() => rand() - 0.5);
      const entries: SleeperMatchup[] = [];
      for (let i = 0; i < shuffled.length; i += 2) {
        entries.push({ matchup_id: i, roster_id: shuffled[i], points: 0 });
        entries.push({ matchup_id: i, roster_id: shuffled[i + 1], points: 0 });
      }
      matchupsByWeek.set(w, entries);
    }

    const result = runSeasonSimulation({ league, rosters, users, matchupsByWeek, bracket: [], simulations: 2000 });

    expect(result.status).toBe('ready');
    const sumPlayoff = result.teams.reduce((s, t) => s + t.playoffProbability, 0);
    const sumChampionship = result.teams.reduce((s, t) => s + t.championshipProbability, 0);
    expect(sumPlayoff).toBeCloseTo(6, 0);
    expect(sumChampionship).toBeCloseTo(1, 1);
  });

  it('applies meanAdjustments as a per-team score shift for what-if trade simulation', () => {
    const rosters = makeRosters(4);
    const users = makeUsers(rosters);
    const league = makeLeague({ playoff_teams: 2, playoff_week_start: 3 });
    const matchupsByWeek = new Map<number, SleeperMatchup[]>([
      [
        1,
        [
          { matchup_id: 1, roster_id: 1, points: 100 },
          { matchup_id: 1, roster_id: 2, points: 100 },
          { matchup_id: 2, roster_id: 3, points: 100 },
          { matchup_id: 2, roster_id: 4, points: 100 },
        ],
      ],
      [
        2,
        [
          { matchup_id: 1, roster_id: 1, points: 0 },
          { matchup_id: 1, roster_id: 2, points: 0 },
          { matchup_id: 2, roster_id: 3, points: 0 },
          { matchup_id: 2, roster_id: 4, points: 0 },
        ],
      ],
    ]);

    const baseline = runSeasonSimulation({ league, rosters, users, matchupsByWeek, simulations: 500 });
    const boosted = runSeasonSimulation({
      league, rosters, users, matchupsByWeek, simulations: 500,
      meanAdjustments: new Map([[1, 1000]]), // massive boost to roster 1's modeled score
    });

    expect(boosted.status).toBe('ready');
    const roster1Before = baseline.teams.find((t) => t.rosterId === 1)!;
    const roster1After = boosted.teams.find((t) => t.rosterId === 1)!;
    expect(roster1After.championshipProbability).toBeGreaterThan(roster1Before.championshipProbability);
    expect(roster1After.meanWeeklyScore).toBeGreaterThan(roster1Before.meanWeeklyScore);
  });

  it('reports season-complete status with the real champion when the bracket is fully resolved', () => {
    const rosters = makeRosters(4);
    const users = makeUsers(rosters);
    const league = makeLeague({ playoff_teams: 2, playoff_week_start: 2 });
    const matchupsByWeek = new Map<number, SleeperMatchup[]>([
      [
        1,
        [
          { matchup_id: 1, roster_id: 1, points: 120 },
          { matchup_id: 1, roster_id: 2, points: 90 },
          { matchup_id: 2, roster_id: 3, points: 80 },
          { matchup_id: 2, roster_id: 4, points: 70 },
        ],
      ],
    ]);
    const bracket = [
      { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
      { r: 2, m: 2, t1: 1, t2: 3, w: 1, l: 3 },
    ];

    const result = runSeasonSimulation({ league, rosters, users, matchupsByWeek, bracket });
    expect(result.status).toBe('season-complete');
    expect(result.actualChampionRosterId).toBe(1);
  });
});
