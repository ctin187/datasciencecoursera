import type { SleeperDraft, SleeperDraftPick } from '../types';
import type { PooledPlayer } from '../hooks/useProjectionPool';
import { optimizeLineup } from './lineupOptimizer';

export interface DraftBoardState {
  totalSlots: number;
  totalRounds: number | null;
  picksMade: number;
  onClockRosterId: number | null;
  onClockPickNo: number;
  onClockRound: number;
  isNomination: boolean; // true for auction drafts, where "on the clock" means "nominates next"
}

/** Sleeper snake-draft slot math: odd rounds go slot 1..N, even rounds reverse. Linear drafts never reverse. */
export function computeDraftBoard(draft: SleeperDraft, picks: SleeperDraftPick[]): DraftBoardState {
  const totalSlots = draft.settings?.teams ?? Object.keys(draft.slot_to_roster_id ?? {}).length ?? 0;
  const totalRounds = draft.settings?.rounds ?? null;
  const pickNo = picks.length + 1;
  const round = totalSlots > 0 ? Math.ceil(pickNo / totalSlots) : 1;
  const posInRound = totalSlots > 0 ? (pickNo - 1) % totalSlots : 0;
  const reversed = draft.type !== 'linear' && round % 2 === 0;
  const slot = reversed ? totalSlots - posInRound : posInRound + 1;
  const onClockRosterId = draft.slot_to_roster_id?.[String(slot)] ?? null;

  return {
    totalSlots,
    totalRounds,
    picksMade: picks.length,
    onClockRosterId: totalRounds && round > totalRounds ? null : onClockRosterId,
    onClockPickNo: pickNo,
    onClockRound: round,
    isNomination: draft.type === 'auction',
  };
}

export interface AvailablePlayerRow {
  sleeperId: string;
  name: string | null;
  position: string | null;
  team: string | null;
  vorPerGame: number | null;
  dropToNextAtPosition: number | null;
  marginalValueForMyTeam: number | null;
}

/**
 * Ranks undrafted players by VOR, adds each one's positional drop-off (the
 * scarcity signal - how much value falls off if this exact player is gone by
 * your next turn), and, for the top N by VOR, the real marginal value of
 * adding that specific player to your specific roster right now (computed by
 * re-running the greedy lineup optimizer with and without the candidate).
 * This is the opportunity-cost number the product spec asks for; it does not
 * model "probability still available at your next pick" (needs ADP + a
 * variance model this app has no honest data source for) - that's a known,
 * stated gap, not a hidden one.
 */
export function buildAvailableBoard(params: {
  pool: Map<string, PooledPlayer>;
  draftedSleeperIds: Set<string>;
  rosterPositions: string[];
  myCurrentPlayerIds: string[];
  marginalTopN?: number;
}): AvailablePlayerRow[] {
  const { pool, draftedSleeperIds, rosterPositions, myCurrentPlayerIds } = params;
  const marginalTopN = params.marginalTopN ?? 40;

  const available = [...pool.values()]
    .filter((p) => !draftedSleeperIds.has(p.sleeperId) && p.vorPerGame !== null)
    .sort((a, b) => (b.vorPerGame ?? 0) - (a.vorPerGame ?? 0));

  const byPosition = new Map<string, PooledPlayer[]>();
  for (const p of available) {
    const pos = p.position ?? '?';
    const arr = byPosition.get(pos) ?? [];
    arr.push(p);
    byPosition.set(pos, arr);
  }

  const currentPool = myCurrentPlayerIds.map((id) => {
    const p = pool.get(id);
    return { sleeperId: id, position: p?.position ?? null, vorPerGame: p?.vorPerGame ?? null };
  });
  const baselineStarterVor = optimizeLineup(rosterPositions, currentPool).starterVorTotal;

  return available.map((p, i) => {
    const posGroup = byPosition.get(p.position ?? '?') ?? [];
    const idxInPos = posGroup.findIndex((x) => x.sleeperId === p.sleeperId);
    const next = posGroup[idxInPos + 1];
    const dropToNextAtPosition = next ? (p.vorPerGame ?? 0) - (next.vorPerGame ?? 0) : null;

    let marginalValueForMyTeam: number | null = null;
    if (i < marginalTopN) {
      const withCandidate = optimizeLineup(rosterPositions, [
        ...currentPool,
        { sleeperId: p.sleeperId, position: p.position, vorPerGame: p.vorPerGame },
      ]).starterVorTotal;
      marginalValueForMyTeam = withCandidate - baselineStarterVor;
    }

    return {
      sleeperId: p.sleeperId,
      name: p.name,
      position: p.position,
      team: p.team,
      vorPerGame: p.vorPerGame,
      dropToNextAtPosition,
      marginalValueForMyTeam,
    };
  });
}
