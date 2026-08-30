// ---------------------------------------------------------------------------
// Rules-based explanation layer: turns already-computed structured results
// into short natural-language summaries. This is template logic over real
// numbers, NOT a call to a language model - it cannot invent a number that
// doesn't already exist elsewhere in the app, which is the point. Every
// function here takes a typed result object and returns strings built
// entirely from its own fields.
// ---------------------------------------------------------------------------

import type { TradeImpact } from './tradeSimulator';
import type { AvailablePlayerRow } from './draftAssistant';

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function pp(delta: number): string {
  const p = delta * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)} pp`;
}

function vorStr(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
}

export function explainTrade(impact: TradeImpact): string[] {
  const lines: string[] = [];
  const { sideA, sideB } = impact;

  lines.push(
    `${sideA.teamName}: starter value over replacement moves ${vorStr(sideA.vorDelta)} pts/game ` +
      `(${sideA.beforeStarterVor.toFixed(2)} → ${sideA.afterStarterVor.toFixed(2)}), sending ` +
      `${sideA.playersOut.map((p) => p.name ?? p.sleeperId).join(', ') || 'nothing'} for ` +
      `${sideA.playersIn.map((p) => p.name ?? p.sleeperId).join(', ') || 'nothing'}.`,
  );
  lines.push(
    `${sideB.teamName}: starter value over replacement moves ${vorStr(sideB.vorDelta)} pts/game ` +
      `(${sideB.beforeStarterVor.toFixed(2)} → ${sideB.afterStarterVor.toFixed(2)}).`,
  );

  if (impact.probabilityImpactA) {
    const p = impact.probabilityImpactA;
    const champDelta = p.after.championship - p.before.championship;
    lines.push(
      `${sideA.teamName} championship probability: ${pct(p.before.championship)} → ${pct(p.after.championship)} (${pp(champDelta)}), ` +
        `playoff probability ${pct(p.before.playoff)} → ${pct(p.after.playoff)}. Based on ${p.simulations.toLocaleString()} Monte Carlo simulations - a model estimate, not a guarantee.`,
    );
  }
  if (impact.probabilityImpactB) {
    const p = impact.probabilityImpactB;
    const champDelta = p.after.championship - p.before.championship;
    lines.push(
      `${sideB.teamName} championship probability: ${pct(p.before.championship)} → ${pct(p.after.championship)} (${pp(champDelta)}), ` +
        `playoff probability ${pct(p.before.playoff)} → ${pct(p.after.playoff)}.`,
    );
  }
  if (impact.probabilityUnavailableReason) {
    lines.push(impact.probabilityUnavailableReason);
  }

  const winner =
    sideA.vorDelta === sideB.vorDelta ? null : sideA.vorDelta > sideB.vorDelta ? sideA.teamName : sideB.teamName;
  if (winner) {
    lines.push(`By starter VOR alone, this trade favors ${winner} — but check the championship-probability lines above, which account for the rest of the league's own trajectory too.`);
  }

  return lines;
}

/**
 * Explains a draft-board recommendation using the opportunity-cost logic the
 * board already computed: raw VOR vs. marginal value added to your specific
 * roster right now. Mirrors the product spec's Player-A-vs-Player-B example
 * directly - it just uses this league's real VOR instead of a hypothetical.
 */
export function explainDraftPick(byMarginal: AvailablePlayerRow[], byRawVor: AvailablePlayerRow[]): string[] {
  const lines: string[] = [];
  const topMarginal = byMarginal.find((p) => p.marginalValueForMyTeam !== null);
  const topRaw = byRawVor[0];

  if (topMarginal) {
    lines.push(
      `Best fit for your roster right now: ${topMarginal.name ?? topMarginal.sleeperId} (${topMarginal.position ?? '?'}) - adds ` +
        `${vorStr(topMarginal.marginalValueForMyTeam ?? 0)} pts/gm to your optimized starting lineup, the largest gain of any available player checked.`,
    );
  }
  if (topRaw && topRaw.sleeperId !== topMarginal?.sleeperId) {
    lines.push(
      `Highest raw VOR available: ${topRaw.name ?? topRaw.sleeperId} (${topRaw.position ?? '?'}, ${vorStr(topRaw.vorPerGame ?? 0)} VOR/gm) - ` +
        `differs from the best-fit pick because your roster is already strong enough at ${topRaw.position ?? 'that position'} that adding another one there gains less than the best-fit alternative would.`,
    );
  }
  if (topMarginal?.dropToNextAtPosition != null && topMarginal.dropToNextAtPosition > 1) {
    lines.push(
      `Positional scarcity: the next available ${topMarginal.position} drops off by ${topMarginal.dropToNextAtPosition.toFixed(2)} VOR/gm from this one - waiting a round costs more here than at a position with a shallower drop-off.`,
    );
  }
  lines.push('This does not model the probability a specific player is still available at your next pick - that needs real ADP data this app does not have a legitimate free source for.');

  return lines;
}
