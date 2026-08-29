import type { EspnNewsItem } from '../services/espnApi';
import type { PlayersMap, SleeperRoster } from '../types';

export type NewsRelevance = 'CRITICAL' | 'WATCH' | 'LEAGUE';

export interface ClassifiedNewsItem extends EspnNewsItem {
  relevance: NewsRelevance;
  matchedPlayerName: string | null;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[.'']/g, '').trim();
}

/**
 * Classifies each news item against a specific roster:
 * CRITICAL = the story names a player actually on this roster.
 * WATCH = the story is about an NFL team this roster has a rostered player
 *         on, but doesn't name one of your specific players.
 * LEAGUE = general NFL news with no direct connection to this roster.
 * Matching is done against ESPN's own categorized player/team fields when
 * present, plus a plain-text fallback search over the headline/description
 * for player names (ESPN doesn't always categorize every mentioned player).
 */
export function classifyNewsForRoster(
  items: EspnNewsItem[],
  roster: SleeperRoster,
  players: PlayersMap,
): ClassifiedNewsItem[] {
  const myPlayerNames = new Set<string>();
  const myTeams = new Set<string>();
  for (const id of roster.players ?? []) {
    const p = players[id];
    if (!p) continue;
    const full = p.full_name || `${p.first_name} ${p.last_name}`;
    myPlayerNames.add(normalizeName(full));
    if (p.team) myTeams.add(p.team.toUpperCase());
  }

  return items.map((item) => {
    const haystack = normalizeName(`${item.headline} ${item.description}`);

    let matchedPlayerName: string | null = null;
    for (const name of item.relatedPlayerNames) {
      if (myPlayerNames.has(normalizeName(name))) {
        matchedPlayerName = name;
        break;
      }
    }
    if (!matchedPlayerName) {
      for (const name of myPlayerNames) {
        // Guard against very short/ambiguous names causing false positives.
        if (name.length >= 6 && haystack.includes(name)) {
          matchedPlayerName = name;
          break;
        }
      }
    }

    if (matchedPlayerName) {
      return { ...item, relevance: 'CRITICAL', matchedPlayerName };
    }

    const teamMatch = item.relatedTeamAbbrevs.some((t) => myTeams.has(t.toUpperCase()));
    if (teamMatch) {
      return { ...item, relevance: 'WATCH', matchedPlayerName: null };
    }

    return { ...item, relevance: 'LEAGUE', matchedPlayerName: null };
  });
}

const RELEVANCE_RANK: Record<NewsRelevance, number> = { CRITICAL: 0, WATCH: 1, LEAGUE: 2 };

/** Sorts CRITICAL first, then WATCH, then LEAGUE; within each tier, newest first. */
export function sortNewsByRelevance(items: ClassifiedNewsItem[]): ClassifiedNewsItem[] {
  return [...items].sort((a, b) => {
    const rankDiff = RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.published).getTime() - new Date(a.published).getTime();
  });
}
