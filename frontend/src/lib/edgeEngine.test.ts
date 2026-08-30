import { describe, it, expect } from 'vitest';
import { computeEdgeSignals } from './edgeEngine';

describe('computeEdgeSignals', () => {
  it('reports insufficient evidence when the season sim and roster health are unavailable', () => {
    const signals = computeEdgeSignals({
      myRosterId: 1,
      totalTeams: 10,
      playoffTeams: 6,
      seasonSim: { status: 'insufficient-data', simulations: 0, teams: [] } as never,
      rosterHealth: null,
      waiverTargets: null,
      draft: undefined,
      draftPicks: [],
      pool: new Map(),
    });
    const champ = signals.find((s) => s.key === 'championship');
    expect(champ?.status).toBe('insufficient-evidence');
    const roster = signals.find((s) => s.key === 'roster-vor');
    expect(roster?.status).toBe('insufficient-evidence');
  });

  it('computes real deltas against fair-share and league-average baselines', () => {
    const seasonSim = {
      status: 'ready',
      simulations: 4000,
      teams: [
        { rosterId: 1, championshipProbability: 0.3, playoffProbability: 0.9 },
        { rosterId: 2, championshipProbability: 0.05, playoffProbability: 0.3 },
      ],
    } as never;
    const rosterHealth = {
      teams: [
        { roster_id: 1, starter_vor_total_per_game: 15, league_rank: 1, bench: [{ vor_per_game: 3 }, { vor_per_game: -1 }] },
        { roster_id: 2, starter_vor_total_per_game: 5, league_rank: 2, bench: [{ vor_per_game: 1 }] },
      ],
    } as never;

    const signals = computeEdgeSignals({
      myRosterId: 1,
      totalTeams: 2,
      playoffTeams: 1,
      seasonSim,
      rosterHealth,
      waiverTargets: null,
      draft: undefined,
      draftPicks: [],
      pool: new Map(),
    });

    const champ = signals.find((s) => s.key === 'championship')!;
    expect(champ.valuePp).toBeCloseTo(-20, 5); // 30% actual vs. 50% fair share in a 2-team league
    const rosterVor = signals.find((s) => s.key === 'roster-vor')!;
    expect(rosterVor.status).toBe('edge'); // 15 vs. league avg of 10
  });
});
