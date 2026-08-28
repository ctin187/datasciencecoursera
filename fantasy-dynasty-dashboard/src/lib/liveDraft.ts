import type { SleeperDraft, SleeperDraftPick, SleeperRoster } from '../types';

export function isDraftLive(draft: SleeperDraft | null | undefined): boolean {
  return draft?.status === 'drafting';
}

/** Picks the draft the Draft Assistant should track: an in-progress one first, else the league's most recent. */
export function findRelevantDraft(drafts: SleeperDraft[]): SleeperDraft | null {
  if (drafts.length === 0) return null;
  const live = drafts.find((d) => d.status === 'drafting');
  if (live) return live;
  return [...drafts].sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0))[0] ?? null;
}

export interface DraftProgress {
  totalPicks: number;
  picksMade: number;
  currentPickNo: number; // 1-indexed, the next pick to be made
  currentRound: number;
  teams: number;
  onClockSlot: number | null; // 1-indexed draft slot
  onClockRosterId: number | null;
}

/**
 * Snake-draft pick order: odd rounds go slot 1..N, even rounds go N..1.
 * Sleeper's draft object doesn't expose "current pick" directly - it's
 * derived from how many picks have landed so far.
 */
export function computeDraftProgress(draft: SleeperDraft, picks: SleeperDraftPick[]): DraftProgress {
  const teams = draft.settings.teams || 10;
  const rounds = draft.settings.rounds || 1;
  const totalPicks = teams * rounds;
  const picksMade = picks.length;
  const currentPickNo = Math.min(totalPicks, picksMade + 1);
  const currentRound = Math.min(rounds, Math.floor((currentPickNo - 1) / teams) + 1);

  const posInRound = ((currentPickNo - 1) % teams) + 1;
  const isEvenRound = currentRound % 2 === 0;
  const isSnake = draft.type === 'snake';
  const onClockSlot = picksMade >= totalPicks ? null : isSnake && isEvenRound ? teams - posInRound + 1 : posInRound;

  const onClockRosterId =
    onClockSlot !== null && draft.slot_to_roster_id ? (draft.slot_to_roster_id[String(onClockSlot)] ?? null) : null;

  return { totalPicks, picksMade, currentPickNo, currentRound, teams, onClockSlot, onClockRosterId };
}

/** How many picks (including the on-the-clock one) until the given roster is up, following snake order. */
export function picksUntilRosterTurn(draft: SleeperDraft, picks: SleeperDraftPick[], rosterId: number): number | null {
  if (!draft.slot_to_roster_id) return null;
  const teams = draft.settings.teams || 10;
  const rounds = draft.settings.rounds || 1;
  const totalPicks = teams * rounds;
  const progress = computeDraftProgress(draft, picks);
  if (progress.onClockSlot === null) return null;

  for (let pickNo = progress.currentPickNo; pickNo <= totalPicks; pickNo++) {
    const round = Math.floor((pickNo - 1) / teams) + 1;
    const posInRound = ((pickNo - 1) % teams) + 1;
    const isEvenRound = round % 2 === 0;
    const slot = draft.type === 'snake' && isEvenRound ? teams - posInRound + 1 : posInRound;
    const rid = draft.slot_to_roster_id[String(slot)];
    if (rid === rosterId) return pickNo - progress.currentPickNo;
  }
  return null;
}

export function rosterIdForSlot(draft: SleeperDraft, slot: number | null): number | null {
  if (slot === null || !draft.slot_to_roster_id) return null;
  return draft.slot_to_roster_id[String(slot)] ?? null;
}

export function findUserRosterId(rosters: SleeperRoster[], userId: string): number | null {
  return rosters.find((r) => r.owner_id === userId)?.roster_id ?? null;
}

/**
 * Estimates seconds-per-pick from pick timestamps observed locally during
 * this browsing session (Sleeper's public picks payload carries no
 * per-pick timestamp, so there is no historical pace data to read - this
 * reflects only what this session has watched happen in real time).
 */
export function estimateSecondsPerPick(observedTimestamps: number[]): number | null {
  if (observedTimestamps.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < observedTimestamps.length; i++) {
    deltas.push((observedTimestamps[i] - observedTimestamps[i - 1]) / 1000);
  }
  return deltas.reduce((s, d) => s + d, 0) / deltas.length;
}
