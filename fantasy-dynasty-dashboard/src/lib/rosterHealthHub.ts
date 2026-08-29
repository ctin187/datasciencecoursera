import type {
  Position,
  PlayersMap,
  SleeperRoster,
  SleeperTradedPick,
  ThreeDValue,
  TradeValueEntry,
} from '../types';
import { resolvePlayerValue } from './playerValue';

function debugLog(...args: unknown[]) {
  if (typeof console !== 'undefined') console.debug('[rosterHealthHub]', ...args);
}

export type Severity = 'CRITICAL' | 'MEDIUM' | 'LOW' | 'STRENGTH';

export interface PositionHealth {
  position: Position;
  yourPlayerName: string | null;
  yourProjection: number;
  replacementPlayerId: string | null;
  replacementPlayerName: string | null;
  replacementProjection: number;
  gap: number; // yourProjection - replacementProjection; negative = weakness
  severity: Severity;
}

function severityForGap(gap: number): Severity {
  if (gap >= 0) return 'STRENGTH';
  const magnitude = Math.abs(gap);
  if (magnitude >= 50) return 'CRITICAL';
  if (magnitude >= 20) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compares your best starter at each position against the best *available*
 * (unrostered) player at that position league-wide - the real, standard
 * "replacement level" concept in fantasy analytics (the player you could
 * actually add off waivers right now). Only positions with real projection
 * coverage (currentProjection from the curated 3D-value model, i.e.
 * QB/RB/WR/TE) are scored - K/DEF/IDP lack reliable free projection data in
 * this app, so they're omitted here rather than scored against a made-up
 * number. See lib/valueCalculator.ts / data/consensusPlayers.ts.
 */
export function computeStrengthsWeaknesses(
  roster: SleeperRoster,
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  threeDValues: Map<string, ThreeDValue>,
  rosteredIds: Set<string>,
  scorablePositions: Position[],
): PositionHealth[] {
  const starterSet = new Set((roster.starters ?? []).filter((id) => id !== '0'));

  const results: PositionHealth[] = scorablePositions.map((position) => {
    // Your best starter at this position.
    let bestMine: { id: string; projection: number } | null = null;
    for (const id of roster.players ?? []) {
      if (!starterSet.has(id)) continue;
      const p = players[id];
      if (!p || p.position !== position) continue;
      const proj = threeDValues.get(id)?.currentProjection ?? 0;
      if (!bestMine || proj > bestMine.projection) bestMine = { id, projection: proj };
    }

    // Best free agent (unrostered, league-wide) at this position - real replacement level.
    let bestReplacement: { id: string; projection: number } | null = null;
    for (const p of Object.values(players)) {
      if (p.position !== position || p.status !== 'Active' || !p.team) continue;
      if (rosteredIds.has(p.player_id)) continue;
      const proj = threeDValues.get(p.player_id)?.currentProjection ?? 0;
      if (proj <= 0) continue;
      if (!bestReplacement || proj > bestReplacement.projection) bestReplacement = { id: p.player_id, projection: proj };
    }

    const yourProjection = bestMine?.projection ?? 0;
    const replacementProjection = bestReplacement?.projection ?? 0;
    const gap = Math.round(yourProjection - replacementProjection);

    return {
      position,
      yourPlayerName: bestMine ? resolvePlayerValue(bestMine.id, players, tradeValues).name : null,
      yourProjection: Math.round(yourProjection),
      replacementPlayerId: bestReplacement?.id ?? null,
      replacementPlayerName: bestReplacement ? resolvePlayerValue(bestReplacement.id, players, tradeValues).name : null,
      replacementProjection: Math.round(replacementProjection),
      gap,
      severity: bestMine ? severityForGap(gap) : 'CRITICAL', // no starter at all at this position is always critical
    };
  });

  // Every scorable position gets a row, even when you have no starter and no
  // free agent exists at that position - an empty starting slot with
  // nothing to fill it is itself a critical, real finding, not noise to hide.
  debugLog('computeStrengthsWeaknesses', { rosterId: roster.roster_id, results });
  return results;
}

export interface ImprovementPath {
  position: Position;
  severity: Severity;
  impact: number; // abs(gap), used for ranking
  waiverRoute: { targetName: string; targetValue: number } | null;
  tradeRoute: { targetName: string; targetOwnerName: string; targetValue: number } | null;
}

/**
 * For each weakness (negative gap), surfaces two concrete, real routes to
 * fix it: the best actual free agent at that position (waiver route), and
 * the best actual player at that position on ANOTHER team's roster in this
 * league (trade route) - both are real players pulled from live league
 * data, not invented suggestions. Ranked by impact (biggest gap first).
 */
export function computeImprovementPaths(
  weaknesses: PositionHealth[],
  myRosterId: number,
  rosters: SleeperRoster[],
  players: PlayersMap,
  tradeValues: Map<string, TradeValueEntry>,
  ownerNameFor: (rosterId: number) => string,
): ImprovementPath[] {
  const paths = weaknesses
    .filter((w) => w.severity === 'CRITICAL' || w.severity === 'MEDIUM')
    .map((w) => {
      const waiverRoute =
        w.replacementPlayerName && w.replacementPlayerId
          ? { targetName: w.replacementPlayerName, targetValue: resolvePlayerValue(w.replacementPlayerId, players, tradeValues).consensusValue }
          : null;

      // Best rostered player at this position on any OTHER team, by consensus value.
      let bestTrade: { id: string; rosterId: number; value: number } | null = null;
      for (const roster of rosters) {
        if (roster.roster_id === myRosterId) continue;
        for (const id of roster.players ?? []) {
          const p = players[id];
          if (!p || p.position !== w.position) continue;
          const value = resolvePlayerValue(id, players, tradeValues).consensusValue;
          if (!bestTrade || value > bestTrade.value) bestTrade = { id, rosterId: roster.roster_id, value };
        }
      }

      const tradeRoute = bestTrade
        ? {
            targetName: resolvePlayerValue(bestTrade.id, players, tradeValues).name,
            targetOwnerName: ownerNameFor(bestTrade.rosterId),
            targetValue: bestTrade.value,
          }
        : null;

      return {
        position: w.position,
        severity: w.severity,
        impact: Math.abs(w.gap),
        waiverRoute,
        tradeRoute,
      };
    })
    .sort((a, b) => b.impact - a.impact);

  debugLog('computeImprovementPaths', paths);
  return paths;
}

export interface DraftCapitalSummary {
  picksAcquired: { season: string; round: number; fromOwnerName: string }[];
  picksTradedAway: { season: string; round: number; toOwnerName: string }[];
}

/**
 * Draft capital derived ONLY from Sleeper's real traded_picks data - shows
 * picks this team has acquired or given away via trade. Every roster also
 * still owns all of its original picks that were never traded; those don't
 * appear in Sleeper's traded_picks response at all, so they're not listed
 * here (that would require assuming a rounds/years convention this app
 * can't confirm from the league's actual settings), and the UI says so
 * explicitly rather than implying this is the team's full draft slate.
 */
export function computeDraftCapital(
  myRosterId: number,
  tradedPicks: SleeperTradedPick[],
  ownerNameFor: (rosterId: number) => string,
): DraftCapitalSummary {
  const picksAcquired = tradedPicks
    .filter((tp) => tp.owner_id === myRosterId && tp.roster_id !== myRosterId)
    .map((tp) => ({ season: tp.season, round: tp.round, fromOwnerName: ownerNameFor(tp.previous_owner_id) }));

  const picksTradedAway = tradedPicks
    .filter((tp) => tp.roster_id === myRosterId && tp.owner_id !== myRosterId)
    .map((tp) => ({ season: tp.season, round: tp.round, toOwnerName: ownerNameFor(tp.owner_id) }));

  const summary = { picksAcquired, picksTradedAway };
  debugLog('computeDraftCapital', { myRosterId, summary });
  return summary;
}
