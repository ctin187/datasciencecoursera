// ---------------------------------------------------------------------------
// Monte Carlo season simulator: playoff & championship probability.
//
// Method: bootstrap-parametric hybrid.
//   1. Pull each team's REAL weekly scores from Sleeper's matchups endpoint
//      for every week that has actually been played this season.
//   2. Model each team's future weekly score as Normal(mean, stdev), where
//      mean/stdev are that team's own actual scores shrunk toward the
//      league-wide mean/stdev (empirical-Bayes style) to avoid overfitting to
//      a small number of games early in the season.
//   3. Replay the ALREADY-PLAYED weeks exactly as they happened (real
//      wins/losses/points, taken from roster.settings) and Monte Carlo the
//      REMAINING weeks using the real future schedule (Sleeper publishes
//      matchup_id pairings for the whole season upfront).
//   4. Seed a single-elimination playoff bracket from each simulated season's
//      final standings and simulate it through to a champion.
//
// This is a model estimate, not a forecast guarantee. Known simplifications,
// stated up front so they aren't mistaken for fact:
//   - Weekly scores are treated as independent draws from a Normal
//     distribution (no player-level correlation, no matchup-specific boosts).
//   - Regular-season tiebreaker is wins then points-for. Sleeper's actual
//     tiebreak rules can differ by league.
//   - The playoff bracket is assumed fully re-seeded each round (best
//     remaining seed vs. worst remaining seed). Some leagues use a fixed
//     bracket instead - this can shift championship odds slightly for the
//     specific pairing structure, not the underlying team strength.
//   - Rosters/starters are assumed unchanged for the rest of the season.
// ---------------------------------------------------------------------------

import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser, WinnersBracketMatchup } from '../types';

export interface TeamSimResult {
  rosterId: number;
  teamName: string;
  gamesPlayed: number;
  actualWins: number;
  actualLosses: number;
  actualTies: number;
  actualPointsFor: number;
  meanWeeklyScore: number;
  stdevWeeklyScore: number;
  playoffProbability: number;
  championshipProbability: number;
  finalsProbability: number;
  avgProjectedFinalWins: number;
}

export interface SeasonSimulationResult {
  status: 'ready' | 'insufficient-data' | 'season-complete';
  simulations: number;
  weeksPlayed: number[];
  weeksRemaining: number[];
  playoffTeams: number;
  playoffWeekStart: number;
  teams: TeamSimResult[];
  methodologyNotes: string[];
  actualChampionRosterId: number | null;
}

const SIMULATIONS = 4000;
const SHRINKAGE_K = 3; // games of "prior strength" the league-average blends in

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sampleStdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Standard Box-Muller normal sample, clipped at 0 (fantasy scores aren't negative in practice). */
function sampleNormal(mu: number, sigma: number): number {
  if (sigma <= 0) return mu;
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, mu + z * sigma);
}

interface WeekPairing {
  a: number;
  b: number;
}

function pairingsForWeek(matchups: SleeperMatchup[] | undefined): WeekPairing[] {
  if (!matchups) return [];
  const byMatchupId = new Map<number, number[]>();
  for (const m of matchups) {
    if (m.matchup_id === null || m.matchup_id === undefined) continue;
    const arr = byMatchupId.get(m.matchup_id) ?? [];
    arr.push(m.roster_id);
    byMatchupId.set(m.matchup_id, arr);
  }
  const pairings: WeekPairing[] = [];
  for (const rosterIds of byMatchupId.values()) {
    if (rosterIds.length === 2) pairings.push({ a: rosterIds[0], b: rosterIds[1] });
  }
  return pairings;
}

function weekWasPlayed(matchups: SleeperMatchup[] | undefined): boolean {
  if (!matchups || matchups.length === 0) return false;
  return matchups.some((m) => (m.points ?? 0) > 0);
}

/** Best-remaining-seed-vs-worst-remaining-seed bracket, reseeded every round. Returns the champion and the pair of finalists. */
function simulateBracket(
  seeds: number[], // roster_ids ordered 1st seed .. last seed
  strength: Map<number, { mean: number; stdev: number }>,
): { champion: number; finalists: [number, number] } {
  let alive = [...seeds];
  let finalists: [number, number] = [alive[0], alive[alive.length - 1]];

  while (alive.length > 1) {
    const n = alive.length;
    const pairCount = Math.floor(n / 2);
    const byes = alive.slice(0, n - pairCount * 2); // odd one(s) out advance automatically (shouldn't normally happen once byes are pre-applied)
    const winners: number[] = [];
    if (alive.length === 2) finalists = [alive[0], alive[1]];
    for (let i = 0; i < pairCount; i++) {
      const top = alive[i];
      const bottom = alive[n - 1 - i];
      const topStats = strength.get(top);
      const bottomStats = strength.get(bottom);
      const topScore = topStats ? sampleNormal(topStats.mean, topStats.stdev) : 0;
      const bottomScore = bottomStats ? sampleNormal(bottomStats.mean, bottomStats.stdev) : 0;
      winners.push(topScore >= bottomScore ? top : bottom);
    }
    // reseed: winners keep their relative seed order (they were pushed in best-to-worst pairing order)
    alive = [...byes, ...winners];
  }
  return { champion: alive[0], finalists };
}

export function runSeasonSimulation(params: {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  matchupsByWeek: Map<number, SleeperMatchup[]>;
  bracket?: WinnersBracketMatchup[];
  simulations?: number;
  /** Roster ID -> points/game to add to that team's modeled future mean score (e.g. a hypothetical trade's VOR delta). Only affects weeks not yet played. */
  meanAdjustments?: Map<number, number>;
}): SeasonSimulationResult {
  const { league, rosters, users, matchupsByWeek, bracket = [] } = params;
  const simulations = params.simulations ?? SIMULATIONS;
  const methodologyNotes: string[] = [];

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teamName = (r: SleeperRoster) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`;
  };

  const totalRosters = rosters.length;
  const playoffWeekStart = league.settings.playoff_week_start ?? 15;
  const playoffTeams = league.settings.playoff_teams ?? Math.max(2, Math.floor(totalRosters / 2));

  const allWeeks = Array.from({ length: Math.max(0, playoffWeekStart - 1) }, (_, i) => i + 1);
  const weeksPlayed = allWeeks.filter((w) => weekWasPlayed(matchupsByWeek.get(w)));
  const weeksRemaining = allWeeks.filter((w) => !weeksPlayed.includes(w));

  // Real per-week scores, for teams and for the league pool.
  const scoreHistory = new Map<number, number[]>();
  for (const r of rosters) scoreHistory.set(r.roster_id, []);
  for (const w of weeksPlayed) {
    for (const m of matchupsByWeek.get(w) ?? []) {
      scoreHistory.get(m.roster_id)?.push(m.points);
    }
  }

  const pooled = Array.from(scoreHistory.values()).flat();
  if (pooled.length === 0) {
    return {
      status: 'insufficient-data',
      simulations: 0,
      weeksPlayed: [],
      weeksRemaining: allWeeks,
      playoffTeams,
      playoffWeekStart,
      teams: [],
      methodologyNotes: [
        'No completed weeks with real scores yet - the simulator needs at least one played week to build a team scoring model. Nothing here is fabricated in the meantime.',
      ],
      actualChampionRosterId: null,
    };
  }

  const leagueMean = mean(pooled);
  const leagueStdev = sampleStdev(pooled) || leagueMean * 0.2 || 1; // fallback CV if literally every score so far was identical

  const strength = new Map<number, { mean: number; stdev: number }>();
  for (const r of rosters) {
    const scores = scoreHistory.get(r.roster_id) ?? [];
    const n = scores.length;
    const w = n / (n + SHRINKAGE_K);
    const teamMean = n > 0 ? mean(scores) : leagueMean;
    const teamStdev = n > 1 ? sampleStdev(scores) : leagueStdev;
    strength.set(r.roster_id, {
      mean: w * teamMean + (1 - w) * leagueMean,
      stdev: w * teamStdev + (1 - w) * leagueStdev,
    });
  }
  if (params.meanAdjustments) {
    for (const [rosterId, delta] of params.meanAdjustments) {
      const s = strength.get(rosterId);
      if (s) s.mean += delta;
    }
  }

  // Season already fully played out and playoffs resolved: report the real outcome, no simulation needed.
  const championshipMatch = bracket
    .filter((b) => !b.p)
    .reduce<WinnersBracketMatchup | null>((best, b) => (!best || b.r > best.r ? b : best), null);
  const seasonComplete = weeksRemaining.length === 0 && !!championshipMatch?.w;

  if (seasonComplete) {
    const rosterIdsInBracket = new Set<number>();
    for (const b of bracket) {
      if (b.t1) rosterIdsInBracket.add(b.t1);
      if (b.t2) rosterIdsInBracket.add(b.t2);
    }
    const finalistIds = new Set<number>();
    if (championshipMatch?.t1) finalistIds.add(championshipMatch.t1);
    if (championshipMatch?.t2) finalistIds.add(championshipMatch.t2);

    const teams: TeamSimResult[] = rosters.map((r) => ({
      rosterId: r.roster_id,
      teamName: teamName(r),
      gamesPlayed: scoreHistory.get(r.roster_id)?.length ?? 0,
      actualWins: r.settings.wins ?? 0,
      actualLosses: r.settings.losses ?? 0,
      actualTies: r.settings.ties ?? 0,
      actualPointsFor: r.settings.fpts ?? 0,
      meanWeeklyScore: strength.get(r.roster_id)?.mean ?? 0,
      stdevWeeklyScore: strength.get(r.roster_id)?.stdev ?? 0,
      playoffProbability: rosterIdsInBracket.has(r.roster_id) ? 1 : 0,
      championshipProbability: championshipMatch?.w === r.roster_id ? 1 : 0,
      finalsProbability: finalistIds.has(r.roster_id) ? 1 : 0,
      avgProjectedFinalWins: r.settings.wins ?? 0,
    }));

    return {
      status: 'season-complete',
      simulations: 0,
      weeksPlayed,
      weeksRemaining: [],
      playoffTeams,
      playoffWeekStart,
      teams: teams.sort((a, b) => b.championshipProbability - a.championshipProbability || b.actualWins - a.actualWins),
      methodologyNotes: ['Season and playoffs are complete - these are the actual final results, not a simulation.'],
      actualChampionRosterId: championshipMatch?.w ?? null,
    };
  }

  if (weeksRemaining.length > 0 && Array.from(matchupsByWeek.keys()).length < allWeeks.length) {
    methodologyNotes.push('Some future weeks\' schedule could not be fetched and were excluded from the simulation.');
  }

  const rosterIds = rosters.map((r) => r.roster_id);
  const playoffCount = new Map<number, number>(rosterIds.map((id) => [id, 0]));
  const championCount = new Map<number, number>(rosterIds.map((id) => [id, 0]));
  const finalsCount = new Map<number, number>(rosterIds.map((id) => [id, 0]));
  const winsSum = new Map<number, number>(rosterIds.map((id) => [id, 0]));

  const remainingPairingsByWeek = weeksRemaining.map((w) => pairingsForWeek(matchupsByWeek.get(w)));
  const missingScheduleWeeks = weeksRemaining.filter((_, i) => remainingPairingsByWeek[i].length === 0);
  if (missingScheduleWeeks.length > 0) {
    methodologyNotes.push(
      `No published matchup pairings for week(s) ${missingScheduleWeeks.join(', ')} - those weeks contribute no simulated games.`,
    );
  }

  for (let s = 0; s < simulations; s++) {
    const simWins = new Map<number, number>(rosters.map((r) => [r.roster_id, r.settings.wins ?? 0]));
    const simLosses = new Map<number, number>(rosters.map((r) => [r.roster_id, r.settings.losses ?? 0]));
    const simTies = new Map<number, number>(rosters.map((r) => [r.roster_id, r.settings.ties ?? 0]));
    const simPF = new Map<number, number>(rosters.map((r) => [r.roster_id, r.settings.fpts ?? 0]));

    for (const pairings of remainingPairingsByWeek) {
      for (const { a, b } of pairings) {
        const aStats = strength.get(a);
        const bStats = strength.get(b);
        const scoreA = aStats ? sampleNormal(aStats.mean, aStats.stdev) : 0;
        const scoreB = bStats ? sampleNormal(bStats.mean, bStats.stdev) : 0;
        simPF.set(a, (simPF.get(a) ?? 0) + scoreA);
        simPF.set(b, (simPF.get(b) ?? 0) + scoreB);
        if (scoreA > scoreB) {
          simWins.set(a, (simWins.get(a) ?? 0) + 1);
          simLosses.set(b, (simLosses.get(b) ?? 0) + 1);
        } else if (scoreB > scoreA) {
          simWins.set(b, (simWins.get(b) ?? 0) + 1);
          simLosses.set(a, (simLosses.get(a) ?? 0) + 1);
        } else {
          simTies.set(a, (simTies.get(a) ?? 0) + 1);
          simTies.set(b, (simTies.get(b) ?? 0) + 1);
        }
      }
    }

    const standings = [...rosterIds].sort((x, y) => {
      const winsDiff = (simWins.get(y) ?? 0) - (simWins.get(x) ?? 0);
      if (winsDiff !== 0) return winsDiff;
      return (simPF.get(y) ?? 0) - (simPF.get(x) ?? 0);
    });

    for (const id of rosterIds) winsSum.set(id, (winsSum.get(id) ?? 0) + (simWins.get(id) ?? 0));

    const qualifiers = standings.slice(0, Math.min(playoffTeams, standings.length));
    for (const id of qualifiers) playoffCount.set(id, (playoffCount.get(id) ?? 0) + 1);

    if (qualifiers.length >= 2) {
      const rounds = Math.ceil(Math.log2(qualifiers.length));
      const slots = 2 ** rounds;
      const byeCount = slots - qualifiers.length;
      const byeTeams = qualifiers.slice(0, byeCount);
      const playInTeams = qualifiers.slice(byeCount);
      const seedOrder = [...byeTeams, ...playInTeams];
      const { champion, finalists } = simulateBracket(seedOrder, strength);
      championCount.set(champion, (championCount.get(champion) ?? 0) + 1);
      for (const f of finalists) finalsCount.set(f, (finalsCount.get(f) ?? 0) + 1);
    }
  }

  methodologyNotes.push(
    `Bootstrap-parametric Monte Carlo, ${simulations.toLocaleString()} simulated seasons. Weekly scores modeled as Normal(mean, stdev) per team, shrunk toward the league average (${SHRINKAGE_K}-game prior) to avoid overfitting small samples.`,
  );

  const teams: TeamSimResult[] = rosters
    .map((r) => {
      const st = strength.get(r.roster_id)!;
      return {
        rosterId: r.roster_id,
        teamName: teamName(r),
        gamesPlayed: scoreHistory.get(r.roster_id)?.length ?? 0,
        actualWins: r.settings.wins ?? 0,
        actualLosses: r.settings.losses ?? 0,
        actualTies: r.settings.ties ?? 0,
        actualPointsFor: r.settings.fpts ?? 0,
        meanWeeklyScore: st.mean,
        stdevWeeklyScore: st.stdev,
        playoffProbability: (playoffCount.get(r.roster_id) ?? 0) / simulations,
        championshipProbability: (championCount.get(r.roster_id) ?? 0) / simulations,
        finalsProbability: (finalsCount.get(r.roster_id) ?? 0) / simulations,
        avgProjectedFinalWins: (winsSum.get(r.roster_id) ?? 0) / simulations,
      };
    })
    .sort((a, b) => b.championshipProbability - a.championshipProbability);

  return {
    status: 'ready',
    simulations,
    weeksPlayed,
    weeksRemaining,
    playoffTeams,
    playoffWeekStart,
    teams,
    methodologyNotes,
    actualChampionRosterId: null,
  };
}
