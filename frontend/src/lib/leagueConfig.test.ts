import { describe, it, expect } from 'vitest';
import { detectLeagueConfig } from './leagueConfig';
import type { SleeperLeague } from '../types';

function makeLeague(overrides: Partial<SleeperLeague> = {}): SleeperLeague {
  return {
    league_id: 'L',
    name: 'Test League',
    season: '2025',
    season_type: 'regular',
    sport: 'nfl',
    status: 'in_season',
    total_rosters: 10,
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    scoring_settings: { rec: 1 },
    settings: {},
    ...overrides,
  };
}

describe('detectLeagueConfig', () => {
  it('reports league type directly from settings.type with high confidence', () => {
    const config = detectLeagueConfig(makeLeague({ settings: { type: 2 } }), []);
    expect(config.leagueType).toBe('dynasty');
    expect(config.leagueTypeConfidence).toBe('reported');
  });

  it('infers dynasty from taxi slots when settings.type is absent', () => {
    const config = detectLeagueConfig(makeLeague({ settings: { taxi_slots: 2 } }), []);
    expect(config.leagueType).toBe('dynasty');
    expect(config.leagueTypeConfidence).toBe('inferred');
  });

  it('falls back to unknown when there is no signal at all', () => {
    const config = detectLeagueConfig(makeLeague({ settings: {} }), []);
    expect(config.leagueType).toBe('unknown');
    expect(config.leagueTypeConfidence).toBe('unknown');
  });

  it('detects FAAB from a nonzero waiver_budget, not from waiver_type', () => {
    const config = detectLeagueConfig(makeLeague({ settings: { waiver_budget: 200 } }), []);
    expect(config.waiverSystem).toBe('faab');
    expect(config.faabBudget).toBe(200);
  });

  it('labels QB format correctly for standard, superflex, and 2QB leagues', () => {
    const standard = detectLeagueConfig(makeLeague({ roster_positions: ['QB', 'RB', 'WR', 'BN'] }), []);
    expect(standard.qbFormatLabel).toBe('Standard 1QB');

    const superflex = detectLeagueConfig(makeLeague({ roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'BN'] }), []);
    expect(superflex.qbFormatLabel).toBe('Superflex');

    const twoQb = detectLeagueConfig(makeLeague({ roster_positions: ['QB', 'QB', 'RB', 'WR', 'BN'] }), []);
    expect(twoQb.qbFormatLabel).toBe('2QB');
  });

  it('reads TE premium from bonus_rec_te', () => {
    const config = detectLeagueConfig(makeLeague({ scoring_settings: { rec: 1, bonus_rec_te: 0.5 } }), []);
    expect(config.tePremiumBonus).toBe(0.5);
  });

  it('labels PPR format from the rec scoring value', () => {
    expect(detectLeagueConfig(makeLeague({ scoring_settings: { rec: 1 } }), []).pprLabel).toBe('Full PPR');
    expect(detectLeagueConfig(makeLeague({ scoring_settings: { rec: 0.5 } }), []).pprLabel).toBe('Half PPR');
    expect(detectLeagueConfig(makeLeague({ scoring_settings: { rec: 0 } }), []).pprLabel).toBe('Standard (no PPR)');
  });
});
