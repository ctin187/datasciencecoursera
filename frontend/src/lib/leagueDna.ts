// ---------------------------------------------------------------------------
// League DNA: per-manager behavioral profiles built entirely from this
// league's own real Sleeper data - draft picks (current season plus, when
// available, every prior season Franchise History fetched), this season's
// transactions, and Sleeper's own roster aggregates (total_moves,
// waiver_budget_used).
//
// Explicitly NOT included: "reach vs. ADP" in the market sense the product
// spec describes, because that needs a real external ADP feed this app has
// no legitimate free source for. What's here instead is a clean substitute
// that needs no external data at all: how many rounds earlier or later than
// THIS LEAGUE'S OWN AVERAGE (pooled across every season available) a manager
// drafts each position - a real, self-referential signal, not a market
// comparison.
//
// Draft tendency can span multiple seasons (whatever Franchise History's
// previous_league_id walk found); waiver/trade/FAAB activity is always
// current-season-only (fetching full transaction history for every prior
// season would multiply the API call count by ~18 weeks per season, and
// "how is this manager behaving lately" is the more decision-relevant
// question for those signals anyway). Every profile states its sample size
// explicitly rather than implying more track record than the data supports.
//
// roster_id is NOT stable across Sleeper seasons - only owner_id (user_id)
// is - so every season's picks are mapped through THAT season's own
// roster_id -> owner_id table before being attributed to a manager.
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
  ownerId: string;
  rosterId: number; // current season's roster id
  teamName: string;
  draftSampleSize: number;
  seasonsOfDraftHistory: number;
  positionTendencies: PositionTendency[];
  totalMoves: number | null; // Sleeper's own aggregate, adds+drops+trades combined, current season
  tradesCount: number; // current season
  tradesPercentile: number; // 0-100 among this league's own managers
  faabSpent: number | null; // current season
  faabSpentPct: number | null; // 0-100
  faabPercentile: number | null;
}

export interface SeasonDraftData {
  season: string;
  rosters: SleeperRoster[]; // that season's own rosters, to map roster_id -> owner_id for that season specifically
  draftPicks: SleeperDraftPick[];
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
  draftSeasons: SeasonDraftData[]; // include the current season as one entry
  transactionsByWeek: Map<number, SleeperTransaction[]>; // current season only
}): ManagerProfile[] {
  const { league, rosters, users, draftSeasons, transactionsByWeek } = params;
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teamName = (r: SleeperRoster) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`;
  };

  // Every (position, round) pick across every fetched season, owner-agnostic -
  // the self-referential league-wide baseline. Pooling seasons gives a bigger,
  // steadier sample than any single draft would.
  const leagueRoundsByPos = new Map<string, number[]>();
  for (const season of draftSeasons) {
    for (const pick of season.draftPicks) {
      const pos = pick.metadata?.position;
      if (!pos) continue;
      const arr = leagueRoundsByPos.get(pos) ?? [];
      arr.push(pick.round);
      leagueRoundsByPos.set(pos, arr);
    }
  }
  const leagueAvgByPos = new Map<string, number>();
  for (const [pos, roundsList] of leagueRoundsByPos) {
    leagueAvgByPos.set(pos, roundsList.reduce((a, b) => a + b, 0) / roundsList.length);
  }

  // Per current-league owner: pooled (position, round) picks across every
  // season they appear in, found by mapping each season's picks through THAT
  // season's own roster_id -> owner_id table (never the current one).
  const roundsByOwnerPos = new Map<string, Map<string, number[]>>();
  const seasonsWithPicksByOwner = new Map<string, Set<string>>();
  for (const season of draftSeasons) {
    const rosterToOwner = new Map(season.rosters.map((r) => [r.roster_id, r.owner_id]));
    for (const pick of season.draftPicks) {
      const ownerId = rosterToOwner.get(pick.roster_id);
      const pos = pick.metadata?.position;
      if (!ownerId || !pos) continue;
      const posMap = roundsByOwnerPos.get(ownerId) ?? new Map<string, number[]>();
      const arr = posMap.get(pos) ?? [];
      arr.push(pick.round);
      posMap.set(pos, arr);
      roundsByOwnerPos.set(ownerId, posMap);

      const seasonSet = seasonsWithPicksByOwner.get(ownerId) ?? new Set<string>();
      seasonSet.add(season.season);
      seasonsWithPicksByOwner.set(ownerId, seasonSet);
    }
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

  return rosters
    .filter((r) => r.owner_id)
    .map((r) => {
      const ownerId = r.owner_id!;
      const myRoundsByPos = roundsByOwnerPos.get(ownerId) ?? new Map<string, number[]>();
      const positionTendencies: PositionTendency[] = [...myRoundsByPos.entries()]
        .map(([position, roundsList]) => {
          const avgRound = roundsList.reduce((a, b) => a + b, 0) / roundsList.length;
          const leagueAvgRound = leagueAvgByPos.get(position) ?? avgRound;
          return { position, picksAtPosition: roundsList.length, avgRound, leagueAvgRound, deltaRounds: leagueAvgRound - avgRound };
        })
        .sort((a, b) => Math.abs(b.deltaRounds) - Math.abs(a.deltaRounds));

      const draftSampleSize = [...myRoundsByPos.values()].reduce((sum, arr) => sum + arr.length, 0);
      const tradesCount = tradesCountByRoster.get(r.roster_id) ?? 0;
      const faabSpent = faabBudget > 0 ? (r.settings.waiver_budget_used ?? 0) : null;

      return {
        ownerId,
        rosterId: r.roster_id,
        teamName: teamName(r),
        draftSampleSize,
        seasonsOfDraftHistory: seasonsWithPicksByOwner.get(ownerId)?.size ?? 0,
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
