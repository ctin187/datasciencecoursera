import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser, WinnersBracketMatchup } from '../types';
import { optimizeLineup, type LineupPlayer } from './lineupOptimizer';
import { runSeasonSimulation } from './seasonSimulator';

export interface TradeSideResult {
  rosterId: number;
  teamName: string;
  beforeStarterVor: number;
  afterStarterVor: number;
  vorDelta: number;
  playersOut: { sleeperId: string; name: string | null; position: string | null; vorPerGame: number | null }[];
  playersIn: { sleeperId: string; name: string | null; position: string | null; vorPerGame: number | null }[];
}

export interface ProbabilityImpact {
  simulations: number;
  before: { playoff: number; championship: number };
  after: { playoff: number; championship: number };
}

export interface TradeImpact {
  sideA: TradeSideResult;
  sideB: TradeSideResult;
  probabilityImpactA: ProbabilityImpact | null;
  probabilityImpactB: ProbabilityImpact | null;
  probabilityUnavailableReason: string | null;
}

export interface TradePlayerInfo {
  name: string | null;
  position: string | null;
  vorPerGame: number | null;
}

function sideResult(
  rosterId: number,
  teamName: string,
  currentPlayerIds: string[],
  outIds: string[],
  inIds: string[],
  rosterPositions: string[],
  playerInfo: Map<string, TradePlayerInfo>,
): TradeSideResult {
  const toLineupPlayer = (id: string): LineupPlayer => {
    const info = playerInfo.get(id);
    return { sleeperId: id, position: info?.position ?? null, vorPerGame: info?.vorPerGame ?? null };
  };
  const before = optimizeLineup(rosterPositions, currentPlayerIds.map(toLineupPlayer));
  const outSet = new Set(outIds);
  const newPool = [...currentPlayerIds.filter((id) => !outSet.has(id)), ...inIds];
  const after = optimizeLineup(rosterPositions, newPool.map(toLineupPlayer));

  const describe = (id: string) => {
    const info = playerInfo.get(id);
    return { sleeperId: id, name: info?.name ?? null, position: info?.position ?? null, vorPerGame: info?.vorPerGame ?? null };
  };

  return {
    rosterId,
    teamName,
    beforeStarterVor: before.starterVorTotal,
    afterStarterVor: after.starterVorTotal,
    vorDelta: after.starterVorTotal - before.starterVorTotal,
    playersOut: outIds.map(describe),
    playersIn: inIds.map(describe),
  };
}

export function evaluateTrade(params: {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  rosterAId: number;
  rosterBId: number;
  playersAOut: string[];
  playersBOut: string[];
  playerInfo: Map<string, TradePlayerInfo>;
  seasonRawInputs: { matchupsByWeek: Map<number, SleeperMatchup[]>; bracket: WinnersBracketMatchup[] } | null;
  seasonStatusReady: boolean;
  simulations?: number;
}): TradeImpact {
  const { league, rosters, users, rosterAId, rosterBId, playersAOut, playersBOut, playerInfo } = params;
  const rosterA = rosters.find((r) => r.roster_id === rosterAId)!;
  const rosterB = rosters.find((r) => r.roster_id === rosterBId)!;
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const teamName = (r: SleeperRoster) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${r.roster_id}`;
  };

  const sideA = sideResult(rosterAId, teamName(rosterA), rosterA.players ?? [], playersAOut, playersBOut, league.roster_positions, playerInfo);
  const sideB = sideResult(rosterBId, teamName(rosterB), rosterB.players ?? [], playersBOut, playersAOut, league.roster_positions, playerInfo);

  let probabilityImpactA: ProbabilityImpact | null = null;
  let probabilityImpactB: ProbabilityImpact | null = null;
  let probabilityUnavailableReason: string | null = null;

  if (!params.seasonStatusReady || !params.seasonRawInputs) {
    probabilityUnavailableReason =
      'Championship-probability impact needs at least one completed week of real scoring this season - not available yet (or the season is already over).';
  } else {
    const simulations = params.simulations ?? 2500;
    const before = runSeasonSimulation({
      league, rosters, users,
      matchupsByWeek: params.seasonRawInputs.matchupsByWeek,
      bracket: params.seasonRawInputs.bracket,
      simulations,
    });
    const after = runSeasonSimulation({
      league, rosters, users,
      matchupsByWeek: params.seasonRawInputs.matchupsByWeek,
      bracket: params.seasonRawInputs.bracket,
      simulations,
      meanAdjustments: new Map([[rosterAId, sideA.vorDelta], [rosterBId, sideB.vorDelta]]),
    });
    if (before.status === 'ready' && after.status === 'ready') {
      const bA = before.teams.find((t) => t.rosterId === rosterAId);
      const aA = after.teams.find((t) => t.rosterId === rosterAId);
      const bB = before.teams.find((t) => t.rosterId === rosterBId);
      const aB = after.teams.find((t) => t.rosterId === rosterBId);
      if (bA && aA) {
        probabilityImpactA = {
          simulations,
          before: { playoff: bA.playoffProbability, championship: bA.championshipProbability },
          after: { playoff: aA.playoffProbability, championship: aA.championshipProbability },
        };
      }
      if (bB && aB) {
        probabilityImpactB = {
          simulations,
          before: { playoff: bB.playoffProbability, championship: bB.championshipProbability },
          after: { playoff: aB.playoffProbability, championship: aB.championshipProbability },
        };
      }
    } else {
      probabilityUnavailableReason = 'Season simulation could not run for this league right now.';
    }
  }

  return { sideA, sideB, probabilityImpactA, probabilityImpactB, probabilityUnavailableReason };
}
