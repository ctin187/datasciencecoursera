// ---------------------------------------------------------------------------
// League DNA: per-manager behavioral profiles built entirely from this
// league's own real Sleeper data - this season's draft picks, transactions,
// and Sleeper's own roster aggregates (total_moves, waiver_budget_used).
//
// Explicitly NOT included: "reach vs. ADP" in the market sense the product
// spec describes, because that needs a real external ADP feed this app has
// no legitimate free source for. What's here instead is a clean substitute
// that needs no external data at all: how many rounds earlier or later than
// THIS LEAGUE'S OWN AVERAGE a manager drafts each position - a real,
// self-referential signal, not a market comparison.
//
// Only one season of draft/transaction history is fetched, so every profile
// states its sample size explicitly rather than implying a longer track
// record than the data actually supports.
// ---------------------------------------------------------------------------

import type { SleeperDraftPick, SleeperLeague, SleeperRoster, SleeperTransaction, SleeperUser } from '../types';

export interface PositionTendency {
  position: string;
  picksAtPosition: number;
  avgRound: number;
  leagueAvgRound: number;
  deltaRounds: number; // positive = drafts this position earlier than the league average
}

export interface ManagerProfile {
  rosterId: number;
  teamName: string;
  draftSampleSize: number;
  positionTendencies: PositionTendency[];
  totalMoves: number | null; // Sleeper's own aggregate, adds+drops+trades combined
  tradesCount: number;
  tradesPercentile: number; // 0-100 among this league's own managers
  faabSpent: number | null;
  faabSpentPct: number | null; // 0-100
  faabPercentile: number | null;
}

function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 50;
  const below = all.filter((v) => v < value).length;
  return Math.round((below / (all.length - 1)) * 100);
}

export function buildLeagueDna(params: {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  draftPicks: SleeperDraftPick[];
  transactionsByWeek: Map<number, SleeperTransaction[]>;
}): ManagerProfile[] {
  const { league, rosters, users, draftPicks, transactionsByWeek } = params;
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teamName = (r: SleeperRoster) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`;
  };

  // League-wide average draft round per position, the self-referential baseline.
  const leagueRoundsByPos = new Map<string, number[]>();
  for (const pick of draftPicks) {
    const pos = pick.metadata?.position;
    if (!pos) continue;
    const arr = leagueRoundsByPos.get(pos) ?? [];
    arr.push(pick.round);
    leagueRoundsByPos.set(pos, arr);
  }
  const leagueAvgByPos = new Map<string, number>();
  for (const [pos, rounds] of leagueRoundsByPos) {
    leagueAvgByPos.set(pos, rounds.reduce((a, b) => a + b, 0) / rounds.length);
  }

  const trades: SleeperTransaction[] = [];
  for (const txs of transactionsByWeek.values()) {
    for (const tx of txs) {
      if (tx.type === 'trade' && tx.status === 'complete') trades.push(tx);
    }
  }
  const tradesCountByRoster = new Map<number, number>();
  for (const tx of trades) {
    for (const rid of tx.roster_ids) {
      tradesCountByRoster.set(rid, (tradesCountByRoster.get(rid) ?? 0) + 1);
    }
  }
  const allTradeCounts = rosters.map((r) => tradesCountByRoster.get(r.roster_id) ?? 0);

  const faabBudget = league.settings.waiver_budget ?? 0;
  const allFaabSpent = faabBudget > 0 ? rosters.map((r) => r.settings.waiver_budget_used ?? 0) : [];

  return rosters.map((r) => {
    const myPicks = draftPicks.filter((p) => p.roster_id === r.roster_id);
    const myRoundsByPos = new Map<string, number[]>();
    for (const pick of myPicks) {
      const pos = pick.metadata?.position;
      if (!pos) continue;
      const arr = myRoundsByPos.get(pos) ?? [];
      arr.push(pick.round);
      myRoundsByPos.set(pos, arr);
    }
    const positionTendencies: PositionTendency[] = [...myRoundsByPos.entries()]
      .map(([position, rounds]) => {
        const avgRound = rounds.reduce((a, b) => a + b, 0) / rounds.length;
        const leagueAvgRound = leagueAvgByPos.get(position) ?? avgRound;
        return { position, picksAtPosition: rounds.length, avgRound, leagueAvgRound, deltaRounds: leagueAvgRound - avgRound };
      })
      .sort((a, b) => Math.abs(b.deltaRounds) - Math.abs(a.deltaRounds));

    const tradesCount = tradesCountByRoster.get(r.roster_id) ?? 0;
    const faabSpent = faabBudget > 0 ? (r.settings.waiver_budget_used ?? 0) : null;

    return {
      rosterId: r.roster_id,
      teamName: teamName(r),
      draftSampleSize: myPicks.length,
      positionTendencies,
      totalMoves: r.settings.total_moves ?? null,
      tradesCount,
      tradesPercentile: percentileRank(tradesCount, allTradeCounts),
      faabSpent,
      faabSpentPct: faabSpent !== null && faabBudget > 0 ? Math.round((faabSpent / faabBudget) * 100) : null,
      faabPercentile: faabSpent !== null ? percentileRank(faabSpent, allFaabSpent) : null,
    };
  });
}
