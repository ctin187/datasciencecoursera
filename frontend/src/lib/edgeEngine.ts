// ---------------------------------------------------------------------------
// Edge Engine: aggregates signals this app has already computed elsewhere
// (Season Outlook's Monte Carlo probabilities, Roster Value's VOR, the
// Draft Assistant's board, Waiver Wire's targets) into one summary. It
// computes nothing new - every number here is a comparison of two numbers
// that already exist. When an input isn't available (season sim hasn't run,
// draft isn't complete, backend not configured), the signal says
// "insufficient evidence" instead of showing zero or omitting the row
// silently, per the product spec's explicit instruction not to fabricate an
// edge score the methodology doesn't support.
// ---------------------------------------------------------------------------

import type { RosterHealthResponse, WaiverTargetsResponse } from '../services/backendApi';
import type { SeasonSimulationResult } from './seasonSimulator';
import type { SleeperDraft, SleeperDraftPick } from '../types';
import type { PooledPlayer } from '../hooks/useProjectionPool';

export interface EdgeSignal {
  key: string;
  label: string;
  valuePp: number | null; // percentage points, when applicable
  valueText: string; // always human-readable, even when valuePp is null
  detail: string;
  status: 'edge' | 'neutral' | 'deficit' | 'insufficient-evidence';
}

function classify(delta: number, threshold: number): EdgeSignal['status'] {
  if (delta > threshold) return 'edge';
  if (delta < -threshold) return 'deficit';
  return 'neutral';
}

export function computeEdgeSignals(params: {
  myRosterId: number | null;
  totalTeams: number;
  playoffTeams: number | null;
  seasonSim: SeasonSimulationResult | null;
  rosterHealth: RosterHealthResponse | null;
  waiverTargets: WaiverTargetsResponse | null;
  draft: SleeperDraft | undefined;
  draftPicks: SleeperDraftPick[];
  pool: Map<string, PooledPlayer>;
}): EdgeSignal[] {
  const { myRosterId, totalTeams, playoffTeams, seasonSim, rosterHealth, waiverTargets, draft, draftPicks, pool } = params;
  const signals: EdgeSignal[] = [];

  // --- Playoff / Championship edge ---
  if (myRosterId != null && seasonSim && seasonSim.status === 'ready' && totalTeams > 0) {
    const me = seasonSim.teams.find((t) => t.rosterId === myRosterId);
    if (me) {
      const fairChamp = 1 / totalTeams;
      const champDeltaPp = (me.championshipProbability - fairChamp) * 100;
      signals.push({
        key: 'championship',
        label: 'Championship Edge',
        valuePp: champDeltaPp,
        valueText: `${champDeltaPp >= 0 ? '+' : ''}${champDeltaPp.toFixed(1)} pp`,
        detail: `Your championship probability (${(me.championshipProbability * 100).toFixed(1)}%) vs. an equal share across ${totalTeams} teams (${(fairChamp * 100).toFixed(1)}%), from ${seasonSim.simulations.toLocaleString()} Monte Carlo simulations.`,
        status: classify(champDeltaPp, 2),
      });
      if (playoffTeams) {
        const fairPlayoff = playoffTeams / totalTeams;
        const playoffDeltaPp = (me.playoffProbability - fairPlayoff) * 100;
        signals.push({
          key: 'playoff',
          label: 'Playoff Edge',
          valuePp: playoffDeltaPp,
          valueText: `${playoffDeltaPp >= 0 ? '+' : ''}${playoffDeltaPp.toFixed(1)} pp`,
          detail: `Your playoff probability (${(me.playoffProbability * 100).toFixed(1)}%) vs. an equal share of ${playoffTeams} playoff spots across ${totalTeams} teams (${(fairPlayoff * 100).toFixed(1)}%).`,
          status: classify(playoffDeltaPp, 5),
        });
      }
    }
  } else {
    signals.push({
      key: 'championship',
      label: 'Championship Edge',
      valuePp: null,
      valueText: 'Insufficient evidence',
      detail: seasonSim?.status === 'insufficient-data' ? 'No completed weeks yet to build a season simulation from.' : 'Select your team and load the Season Outlook tab first.',
      status: 'insufficient-evidence',
    });
  }

  // --- Roster VOR edge ---
  if (myRosterId != null && rosterHealth) {
    const me = rosterHealth.teams.find((t) => t.roster_id === myRosterId);
    if (me && rosterHealth.teams.length > 0) {
      const leagueAvg = rosterHealth.teams.reduce((s, t) => s + t.starter_vor_total_per_game, 0) / rosterHealth.teams.length;
      const delta = me.starter_vor_total_per_game - leagueAvg;
      signals.push({
        key: 'roster-vor',
        label: 'Starting Lineup Edge',
        valuePp: null,
        valueText: `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} VOR/gm`,
        detail: `Your starter VOR total (${me.starter_vor_total_per_game.toFixed(2)}/gm) vs. the league average (${leagueAvg.toFixed(2)}/gm). League rank #${me.league_rank} of ${rosterHealth.teams.length}.`,
        status: classify(delta, 1),
      });

      const myBenchSurplus = me.bench.filter((b) => (b.vor_per_game ?? 0) > 0).reduce((s, b) => s + (b.vor_per_game ?? 0), 0);
      const leagueBenchAvg =
        rosterHealth.teams.reduce((s, t) => s + t.bench.filter((b) => (b.vor_per_game ?? 0) > 0).reduce((s2, b) => s2 + (b.vor_per_game ?? 0), 0), 0) /
        rosterHealth.teams.length;
      const benchDelta = myBenchSurplus - leagueBenchAvg;
      signals.push({
        key: 'bench-depth',
        label: 'Bench Depth Edge',
        valuePp: null,
        valueText: `${benchDelta >= 0 ? '+' : ''}${benchDelta.toFixed(2)} VOR/gm`,
        detail: `Sum of above-replacement bench VOR on your roster (${myBenchSurplus.toFixed(2)}) vs. the league average (${leagueBenchAvg.toFixed(2)}).`,
        status: classify(benchDelta, 1),
      });
    }
  } else {
    signals.push({
      key: 'roster-vor',
      label: 'Starting Lineup Edge',
      valuePp: null,
      valueText: 'Insufficient evidence',
      detail: 'Select your team and make sure the analytics backend is configured.',
      status: 'insufficient-evidence',
    });
  }

  // --- Draft-day retrospective edge ---
  if (myRosterId != null && draft?.status === 'complete' && draftPicks.length > 0 && pool.size > 0) {
    const vorByRoster = new Map<number, number>();
    for (const pick of draftPicks) {
      const v = pool.get(pick.player_id)?.vorPerGame;
      if (v !== null && v !== undefined) vorByRoster.set(pick.roster_id, (vorByRoster.get(pick.roster_id) ?? 0) + v);
    }
    const rosterIds = [...vorByRoster.keys()];
    if (rosterIds.length > 0 && vorByRoster.has(myRosterId)) {
      const leagueAvg = [...vorByRoster.values()].reduce((a, b) => a + b, 0) / vorByRoster.size;
      const mine = vorByRoster.get(myRosterId) ?? 0;
      const delta = mine - leagueAvg;
      signals.push({
        key: 'draft-retro',
        label: 'Draft-Day Edge (retrospective)',
        valuePp: null,
        valueText: `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} VOR/gm`,
        detail: `Sum of CURRENT VOR across everyone you drafted (${mine.toFixed(2)}) vs. the league average (${leagueAvg.toFixed(2)}) - measures draft value with hindsight, not what was knowable on draft day.`,
        status: classify(delta, 2),
      });
    }
  }

  // --- Waiver opportunity edge ---
  if (waiverTargets && waiverTargets.targets.length > 0) {
    const best = waiverTargets.targets[0];
    if (best.vor_per_game != null && best.vor_per_game > 0) {
      signals.push({
        key: 'waiver-opportunity',
        label: 'Waiver Opportunity',
        valuePp: null,
        valueText: `+${best.vor_per_game.toFixed(2)} VOR/gm available`,
        detail: `Best unrostered player right now: ${best.name ?? best.sleeper_id} (${best.position ?? '?'}). Whether this is an edge for YOUR team specifically depends on your roster fit - see the Waiver Wire tab.`,
        status: best.vor_per_game > 1 ? 'edge' : 'neutral',
      });
    }
  }

  return signals;
}
