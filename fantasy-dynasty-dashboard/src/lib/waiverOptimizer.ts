import type { SleeperRoster } from '../types';

/**
 * Roster bookkeeping helpers for the waiver view.
 *
 * HISTORY, so it isn't reintroduced: this module used to export
 * `estimateSnapTrend()`, which manufactured snap share, target share and a
 * RISING/FALLING/STABLE verdict from a hash of the player's ID. It was
 * deterministic noise dressed as a usage signal, and `priorityScore()`,
 * `suggestFaabBid()` and `suggestDropCandidates()` all ranked players partly on
 * it. A disclaimer was attached, but a disclaimer does not make a fabricated
 * number safe to rank on - people read the ranking, not the footnote.
 *
 * All of that is deleted. Real usage (targets, carries, target share, snap
 * share, and direction of travel measured against earlier weeks) now comes from
 * the backend's /waiver-targets endpoint, sourced from nflverse game logs, and
 * ranking is Value Over Replacement computed against the league's own settings.
 *
 * What remains here is only what it says: three functions that read a Sleeper
 * roster. No inference, no estimation.
 */

/** Every player ID rostered anywhere in the league. */
export function rosteredPlayerIds(rosters: SleeperRoster[]): Set<string> {
  const ids = new Set<string>();
  for (const r of rosters) {
    (r.players ?? []).forEach((id) => ids.add(id));
  }
  return ids;
}

/** FAAB spent per roster, straight from Sleeper's settings. */
export function faabSpentByRoster(rosters: SleeperRoster[]): Map<number, number> {
  return new Map(rosters.map((r) => [r.roster_id, r.settings.waiver_budget_used ?? 0]));
}

/** Roster spots not in the starting lineup, IR, or taxi squad - i.e. droppable without a lineup change. */
export function benchPlayerIds(roster: SleeperRoster): string[] {
  const all = roster.players ?? [];
  const exempt = new Set([...(roster.starters ?? []), ...(roster.taxi ?? []), ...(roster.reserve ?? [])]);
  return all.filter((id) => !exempt.has(id));
}
