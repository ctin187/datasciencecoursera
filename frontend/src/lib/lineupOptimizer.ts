// ---------------------------------------------------------------------------
// Greedy lineup optimizer: given a set of starting slots (from Sleeper's
// roster_positions, BN/IR/TAXI already excluded) and a pool of players with a
// known VOR, assigns players to slots to maximize total starter VOR.
//
// Method: sort slots most-restrictive-first (a dedicated QB slot before a
// SUPER_FLEX, a SUPER_FLEX before a wide-open flex), then for each slot
// greedily take the highest-VOR unassigned eligible player. This is not a
// globally optimal assignment (a true optimum needs bipartite matching / the
// Hungarian algorithm) but is a close, fast, and transparent approximation -
// good enough for "does this trade help", not claimed to be exact to the
// decimal point.
// ---------------------------------------------------------------------------

export interface LineupPlayer {
  sleeperId: string;
  position: string | null;
  vorPerGame: number | null;
}

export interface LineupResult {
  starterVorTotal: number;
  assignments: { slot: string; sleeperId: string | null; vorPerGame: number | null }[];
  benchVorTotal: number;
}

const NON_STARTING_SLOTS = new Set(['BN', 'IR', 'TAXI']);

const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};

export function startingSlots(rosterPositions: string[]): string[] {
  return rosterPositions.map((p) => p.toUpperCase()).filter((p) => !NON_STARTING_SLOTS.has(p));
}

function eligiblePositions(slot: string): string[] {
  return SLOT_ELIGIBILITY[slot] ?? []; // unknown slot codes accept nobody rather than everybody, to avoid silently misassigning
}

/** Greedily fills every starting slot to maximize total VOR, given the full player pool available to one roster. */
export function optimizeLineup(rosterPositions: string[], pool: LineupPlayer[]): LineupResult {
  const slots = startingSlots(rosterPositions);
  // Most-restrictive-first: fewer eligible positions = filled earlier, so a
  // dedicated QB doesn't get scooped by a superflex slot processed first.
  const orderedSlots = slots
    .map((slot, i) => ({ slot, i, eligibleCount: eligiblePositions(slot).length || 99 }))
    .sort((a, b) => a.eligibleCount - b.eligibleCount || a.i - b.i);

  const available = [...pool].filter((p) => p.vorPerGame !== null).sort((a, b) => (b.vorPerGame ?? 0) - (a.vorPerGame ?? 0));
  const used = new Set<string>();
  const bySlot = new Map<number, { slot: string; sleeperId: string | null; vorPerGame: number | null }>();

  for (const { slot, i } of orderedSlots) {
    const eligible = eligiblePositions(slot);
    const pick = available.find((p) => !used.has(p.sleeperId) && (eligible.length === 0 || eligible.includes((p.position ?? '').toUpperCase())));
    if (pick) {
      used.add(pick.sleeperId);
      bySlot.set(i, { slot, sleeperId: pick.sleeperId, vorPerGame: pick.vorPerGame });
    } else {
      bySlot.set(i, { slot, sleeperId: null, vorPerGame: null });
    }
  }

  const assignments = orderedSlots
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => bySlot.get(i)!);

  const starterVorTotal = assignments.reduce((sum, a) => sum + (a.vorPerGame ?? 0), 0);
  const benchVorTotal = available
    .filter((p) => !used.has(p.sleeperId))
    .reduce((sum, p) => sum + Math.max(0, p.vorPerGame ?? 0), 0);

  return { starterVorTotal, assignments, benchVorTotal };
}
