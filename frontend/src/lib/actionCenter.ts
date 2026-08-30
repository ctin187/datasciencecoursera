// ---------------------------------------------------------------------------
// Action Center: prioritizes already-computed results into a short "what
// should I do" digest. Purely a synthesis/ranking layer over structured
// data other modules computed - the rules-based stand-in for the product
// spec's "AI/Claude Analyst" section. It is deliberately NOT a live language
// model call: every sentence it produces is a template filled from typed
// fields, so it is structurally incapable of inventing a number. Labeled as
// rules-based in the UI so it's never mistaken for a generative model.
// ---------------------------------------------------------------------------

import type { EdgeSignal } from './edgeEngine';
import type { TeamReport, WaiverTarget } from '../services/backendApi';

export interface ActionItem {
  category: 'LINEUP' | 'WAIVER' | 'PLAYOFFS' | 'ROSTER' | 'DRAFT';
  text: string;
  severity: 'high' | 'medium' | 'low';
}

export function buildActionCenter(params: {
  edgeSignals: EdgeSignal[];
  myTeam: TeamReport | null;
  bestWaiverTarget: WaiverTarget | null;
}): ActionItem[] {
  const items: ActionItem[] = [];
  const { edgeSignals, myTeam, bestWaiverTarget } = params;

  // Biggest weakness: the starting slot with the lowest (or most negative) VOR.
  if (myTeam) {
    const filled = myTeam.starters.filter((s) => !s.empty && s.player);
    const weakest = [...filled].sort((a, b) => (a.player!.vor_per_game ?? 0) - (b.player!.vor_per_game ?? 0))[0];
    const empty = myTeam.starters.find((s) => s.empty);
    if (empty) {
      items.push({ category: 'LINEUP', text: `You have an empty ${empty.slot} slot - fill it before your next matchup locks.`, severity: 'high' });
    } else if (weakest && (weakest.player!.vor_per_game ?? 0) < 0) {
      items.push({
        category: 'ROSTER',
        text: `Your weakest starter is ${weakest.player!.name ?? weakest.player!.sleeper_id} at ${weakest.slot} (${(weakest.player!.vor_per_game ?? 0).toFixed(2)} VOR/gm, below replacement) - your first priority for an upgrade.`,
        severity: 'high',
      });
    }
  }

  if (bestWaiverTarget && bestWaiverTarget.vor_per_game != null && bestWaiverTarget.vor_per_game > 0) {
    const upgrade = bestWaiverTarget.upgrade_over_weakest_starter;
    items.push({
      category: 'WAIVER',
      text: `Best available add: ${bestWaiverTarget.name ?? bestWaiverTarget.sleeper_id} (${bestWaiverTarget.position ?? '?'}), ${bestWaiverTarget.vor_per_game.toFixed(2)} VOR/gm${
        upgrade != null && upgrade > 0 ? ` - a real +${upgrade.toFixed(2)} upgrade over your weakest starter there` : ''
      }. See the Waiver Wire tab for a bid range.`,
      severity: upgrade != null && upgrade > 0.5 ? 'high' : 'medium',
    });
  }

  const champSignal = edgeSignals.find((s) => s.key === 'championship');
  if (champSignal && champSignal.valuePp !== null) {
    items.push({
      category: 'PLAYOFFS',
      text: `Championship Edge: ${champSignal.valueText}. ${champSignal.detail}`,
      severity: Math.abs(champSignal.valuePp) > 5 ? 'high' : 'medium',
    });
  }

  const draftEdge = edgeSignals.find((s) => s.key === 'draft-retro');
  if (draftEdge) {
    items.push({ category: 'DRAFT', text: draftEdge.detail, severity: 'low' });
  }

  const severityRank = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
