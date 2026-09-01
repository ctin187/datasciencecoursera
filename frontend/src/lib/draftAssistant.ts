import type { SleeperDraft, SleeperDraftPick } from '../types';

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
