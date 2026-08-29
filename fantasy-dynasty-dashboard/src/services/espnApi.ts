// ESPN's public, unofficial "site API" - no key required, widely used by
// hobby fantasy tools. It is NOT an official/documented API: the shape can
// change or the endpoint can go away without notice, so every consumer of
// this module must treat a failure (network error, CORS block, unexpected
// JSON shape) as a normal, expected outcome and degrade gracefully -
// never fabricate a substitute score/spread when the real fetch fails.
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news';

export interface EspnGameOdds {
  homeTeam: string; // ESPN team abbreviation
  awayTeam: string;
  homeSpread: number | null; // negative = home favored, per ESPN's convention
  overUnder: number | null;
  kickoff: string | null; // ISO date string
}

export interface EspnNewsItem {
  headline: string;
  description: string;
  published: string; // ISO date string
  link: string | null;
  relatedTeamAbbrevs: string[];
  relatedPlayerNames: string[];
}

function debugLog(...args: unknown[]) {
  if (typeof console !== 'undefined') console.debug('[espnApi]', ...args);
}

/**
 * Fetches the current NFL scoreboard (this week's games) and extracts
 * spread/over-under per game where ESPN provides odds. Returns null on any
 * failure - callers must show an honest "unavailable" state, not a fake one.
 */
export async function fetchNflScoreboard(): Promise<EspnGameOdds[] | null> {
  try {
    const res = await fetch(SCOREBOARD_URL);
    if (!res.ok) {
      debugLog('scoreboard fetch non-OK response', res.status);
      return null;
    }
    const json = await res.json();
    const events = Array.isArray(json?.events) ? json.events : [];
    const games: EspnGameOdds[] = [];

    for (const event of events) {
      try {
        const competition = event?.competitions?.[0];
        if (!competition) continue;
        const competitors = competition.competitors ?? [];
        const home = competitors.find((c: { homeAway?: string }) => c.homeAway === 'home');
        const away = competitors.find((c: { homeAway?: string }) => c.homeAway === 'away');
        const homeAbbr = home?.team?.abbreviation;
        const awayAbbr = away?.team?.abbreviation;
        if (!homeAbbr || !awayAbbr) continue;

        const oddsEntry = competition.odds?.[0];
        const homeSpread = typeof oddsEntry?.spread === 'number' ? oddsEntry.spread : null;
        const overUnder = typeof oddsEntry?.overUnder === 'number' ? oddsEntry.overUnder : null;

        games.push({
          homeTeam: homeAbbr,
          awayTeam: awayAbbr,
          homeSpread,
          overUnder,
          kickoff: competition.date ?? event.date ?? null,
        });
      } catch (perGameErr) {
        // One malformed event shouldn't blank out every other real game.
        debugLog('skipping one malformed scoreboard event', perGameErr);
      }
    }

    debugLog('scoreboard fetch OK', { gameCount: games.length, withOdds: games.filter((g) => g.overUnder !== null).length });
    return games;
  } catch (err) {
    debugLog('scoreboard fetch failed - degrading gracefully', err);
    return null;
  }
}

/** Fetches recent NFL news headlines. Returns null on any failure - never fabricated. */
export async function fetchNflNews(limit = 40): Promise<EspnNewsItem[] | null> {
  try {
    const res = await fetch(`${NEWS_URL}?limit=${limit}`);
    if (!res.ok) {
      debugLog('news fetch non-OK response', res.status);
      return null;
    }
    const json = await res.json();
    const articles = Array.isArray(json?.articles) ? json.articles : [];
    const items: EspnNewsItem[] = articles.map((a: Record<string, unknown>) => {
      const categories = Array.isArray(a.categories) ? (a.categories as Record<string, unknown>[]) : [];
      const relatedTeamAbbrevs = categories
        .filter((c) => c.type === 'team')
        .map((c) => (c.teamAbbreviation ?? c.description) as string | undefined)
        .filter((v): v is string => !!v);
      const relatedPlayerNames = categories
        .filter((c) => c.type === 'athlete')
        .map((c) => c.description as string | undefined)
        .filter((v): v is string => !!v);
      return {
        headline: (a.headline as string) ?? '',
        description: (a.description as string) ?? '',
        published: (a.published as string) ?? '',
        link: (a.links as { web?: { href?: string } } | undefined)?.web?.href ?? null,
        relatedTeamAbbrevs,
        relatedPlayerNames,
      };
    });
    debugLog('news fetch OK', { itemCount: items.length });
    return items;
  } catch (err) {
    debugLog('news fetch failed - degrading gracefully', err);
    return null;
  }
}
