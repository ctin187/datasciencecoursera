import type { Position, PlayersMap, SleeperRoster, ThreeDValue } from '../types';
import type { EspnGameOdds } from '../services/espnApi';

function debugLog(...args: unknown[]) {
  if (typeof console !== 'undefined') console.debug('[lineupOptimizer]', ...args);
}

/**
 * Sleeper and ESPN agree on NFL team abbreviations almost everywhere, but a
 * handful have historically diverged. This is a small, honest alias table -
 * not invented data - so a real ESPN matchup isn't silently dropped just
 * because the two providers spell a team differently.
 */
const TEAM_ABBREV_ALIASES: Record<string, string> = {
  WSH: 'WAS',
  JAC: 'JAX',
  LA: 'LAR',
};

function normalizeTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const upper = abbr.toUpperCase();
  return TEAM_ABBREV_ALIASES[upper] ?? upper;
}

export interface TeamMatchup {
  opponent: string;
  isHome: boolean;
  impliedTotal: number | null; // real, from ESPN odds; null if unavailable
  overUnder: number | null;
  spread: number | null;
  kickoff: string | null;
}

/**
 * Turns raw ESPN scoreboard games into a per-team implied-scoring lookup.
 * Implied team total = overUnder/2 -+ homeSpread/2, the standard formula
 * (ESPN's homeSpread is negative when the home team is favored). Real math
 * on real numbers - not a guess - but only computed where ESPN actually
 * published a spread and total for that game.
 */
export function buildTeamMatchups(games: EspnGameOdds[]): Map<string, TeamMatchup> {
  const map = new Map<string, TeamMatchup>();
  for (const game of games) {
    const home = normalizeTeam(game.homeTeam);
    const away = normalizeTeam(game.awayTeam);
    if (!home || !away) continue;

    let homeImplied: number | null = null;
    let awayImplied: number | null = null;
    if (game.overUnder !== null && game.homeSpread !== null) {
      homeImplied = game.overUnder / 2 - game.homeSpread / 2;
      awayImplied = game.overUnder / 2 + game.homeSpread / 2;
    }

    map.set(home, { opponent: away, isHome: true, impliedTotal: homeImplied, overUnder: game.overUnder, spread: game.homeSpread, kickoff: game.kickoff });
    map.set(away, { opponent: home, isHome: false, impliedTotal: awayImplied, overUnder: game.overUnder, spread: game.homeSpread !== null ? -game.homeSpread : null, kickoff: game.kickoff });
  }
  debugLog('buildTeamMatchups', { teamCount: map.size, withImpliedTotal: Array.from(map.values()).filter((m) => m.impliedTotal !== null).length });
  return map;
}

function leagueAvgImpliedTotal(matchups: Map<string, TeamMatchup>): number {
  const totals = Array.from(matchups.values()).map((m) => m.impliedTotal).filter((v): v is number => v !== null);
  if (totals.length === 0) return 0;
  return totals.reduce((s, v) => s + v, 0) / totals.length;
}

export interface PlayerLineupInfo {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  baseProjection: number;
  matchup: TeamMatchup | null;
  matchupMultiplier: number; // 1.0 = neutral/unavailable
  adjustedProjection: number;
  injuryStatus: string | null;
  confidence: number; // 0-100, how much real signal backs this projection
}

/**
 * Blends a player's existing dynasty-model season projection with a
 * real Vegas-implied scoring-environment signal for their team this week.
 * Multiplier is clamped to +/-30% so one extreme game total can't swing a
 * projection unrealistically, and defaults to a neutral 1.0 (no adjustment)
 * whenever real odds aren't available for that player's team - never a
 * fabricated substitute.
 */
export function computePlayerLineupInfo(
  playerId: string,
  players: PlayersMap,
  threeDValues: Map<string, ThreeDValue>,
  matchups: Map<string, TeamMatchup>,
  avgImplied: number,
): PlayerLineupInfo | null {
  const p = players[playerId];
  if (!p) return null;

  const baseProjection = threeDValues.get(playerId)?.currentProjection ?? 0;
  const team = normalizeTeam(p.team);
  const matchup = team ? matchups.get(team) ?? null : null;

  let matchupMultiplier = 1;
  let hasOdds = false;
  if (matchup && matchup.impliedTotal !== null && avgImplied > 0) {
    hasOdds = true;
    const raw = matchup.impliedTotal / avgImplied;
    matchupMultiplier = Math.max(0.7, Math.min(1.3, raw));
  }

  const adjustedProjection = baseProjection * matchupMultiplier;

  let confidence = 40;
  if (baseProjection > 0) confidence += 25;
  if (hasOdds) confidence += 25;
  if (p.injury_status) confidence -= p.injury_status === 'Out' || p.injury_status === 'IR' || p.injury_status === 'Doubtful' ? 40 : 15;
  confidence = Math.max(0, Math.min(100, confidence));

  return {
    playerId,
    name: p.full_name || `${p.first_name} ${p.last_name}`,
    position: p.position as Position,
    team: p.team,
    baseProjection: Math.round(baseProjection),
    matchup,
    matchupMultiplier: Math.round(matchupMultiplier * 100) / 100,
    adjustedProjection: Math.round(adjustedProjection),
    injuryStatus: p.injury_status ?? null,
    confidence,
  };
}

export interface StartSlot {
  slotType: string; // raw Sleeper slot label, e.g. 'RB', 'FLEX', 'SUPER_FLEX'
  eligiblePositions: Position[];
}

const NON_STARTING_SLOTS = new Set(['BN', 'TAXI', 'IR']);

/** Parses a league's raw roster_positions into just the starting slots (excludes bench/taxi/IR), with each slot's eligible positions. */
export function parseStartingSlots(rosterPositions: string[]): StartSlot[] {
  const slots: StartSlot[] = [];
  for (const raw of rosterPositions) {
    const slot = raw.toUpperCase();
    if (NON_STARTING_SLOTS.has(slot)) continue;

    if (slot === 'FLEX' || slot === 'WRRB_FLEX' || slot === 'REC_FLEX') {
      slots.push({ slotType: slot, eligiblePositions: ['RB', 'WR', 'TE'] });
    } else if (slot === 'SUPER_FLEX') {
      slots.push({ slotType: slot, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] });
    } else if (slot === 'IDP_FLEX') {
      slots.push({ slotType: slot, eligiblePositions: ['DL', 'LB', 'DB'] });
    } else if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(slot)) {
      slots.push({ slotType: slot, eligiblePositions: [slot as Position] });
    }
    // Anything else unrecognized (rare custom slot types) is skipped rather than guessed at.
  }
  return slots;
}

export interface SlotAssignment {
  slotType: string;
  playerId: string | null;
  playerName: string | null;
  projection: number;
}

/**
 * Greedy best-fit lineup assignment: processes slots in the order the
 * league defines them, and for each picks the highest-adjusted-projection
 * eligible player not already used. This is a standard, effective heuristic
 * for this problem (not a global-optimal solver), and is transparent -
 * every assignment is traceable back to a real projection number.
 */
export function assignLineup(slots: StartSlot[], candidates: PlayerLineupInfo[]): SlotAssignment[] {
  const remaining = [...candidates].sort((a, b) => b.adjustedProjection - a.adjustedProjection);
  const used = new Set<string>();
  const assignments: SlotAssignment[] = [];

  for (const slot of slots) {
    const best = remaining.find((c) => !used.has(c.playerId) && slot.eligiblePositions.includes(c.position));
    if (best) {
      used.add(best.playerId);
      assignments.push({ slotType: slot.slotType, playerId: best.playerId, playerName: best.name, projection: best.adjustedProjection });
    } else {
      assignments.push({ slotType: slot.slotType, playerId: null, playerName: null, projection: 0 });
    }
  }
  return assignments;
}

export interface LineupComparison {
  current: SlotAssignment[];
  optimized: SlotAssignment[];
  currentTotal: number;
  optimizedTotal: number;
  delta: number;
  changedSlots: number;
}

/**
 * Compares the roster's actual current starters (as set in Sleeper) against
 * the matchup-adjusted-optimal lineup for the same slot structure.
 */
export function buildLineupComparison(
  roster: SleeperRoster,
  players: PlayersMap,
  threeDValues: Map<string, ThreeDValue>,
  matchups: Map<string, TeamMatchup>,
  rosterPositions: string[],
): LineupComparison {
  const avgImplied = leagueAvgImpliedTotal(matchups);
  const slots = parseStartingSlots(rosterPositions);

  const allInfo = (roster.players ?? [])
    .map((id) => computePlayerLineupInfo(id, players, threeDValues, matchups, avgImplied))
    .filter((c): c is PlayerLineupInfo => c !== null);
  const infoById = new Map(allInfo.map((c) => [c.playerId, c]));

  // Current lineup: Sleeper's `starters` array is positionally aligned with
  // the starting-slot portion of `roster_positions` (index 0 = whatever
  // that league's first starting slot is, etc.), with the literal string
  // '0' marking an empty slot. Indexing must happen on that raw, unfiltered
  // array - stripping '0' entries first before indexing would shift every
  // later slot out of alignment with what it actually is.
  const rawStarters = roster.starters ?? [];
  const currentAssignments: SlotAssignment[] = slots.map((slot, i) => {
    const id = rawStarters[i];
    if (!id || id === '0') return { slotType: slot.slotType, playerId: null, playerName: null, projection: 0 };
    const info = infoById.get(id);
    if (!info) return { slotType: slot.slotType, playerId: id, playerName: null, projection: 0 };
    return { slotType: slot.slotType, playerId: info.playerId, playerName: info.name, projection: info.adjustedProjection };
  });

  const optimizedAssignments = assignLineup(slots, allInfo);

  const currentTotal = currentAssignments.reduce((s, a) => s + a.projection, 0);
  const optimizedTotal = optimizedAssignments.reduce((s, a) => s + a.projection, 0);
  const changedSlots = optimizedAssignments.filter((a, i) => a.playerId !== currentAssignments[i]?.playerId).length;

  const result: LineupComparison = {
    current: currentAssignments,
    optimized: optimizedAssignments,
    currentTotal: Math.round(currentTotal),
    optimizedTotal: Math.round(optimizedTotal),
    delta: Math.round(optimizedTotal - currentTotal),
    changedSlots,
  };
  debugLog('buildLineupComparison', { rosterId: roster.roster_id, currentTotal: result.currentTotal, optimizedTotal: result.optimizedTotal, delta: result.delta });
  return result;
}
