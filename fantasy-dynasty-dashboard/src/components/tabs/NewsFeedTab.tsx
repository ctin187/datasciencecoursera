import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import { useEspnNews } from '../../hooks/useEspnNews';
import { Card, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { classifyNewsForRoster, sortNewsByRelevance, type NewsRelevance } from '../../lib/newsFeed';

const RELEVANCE_COLOR: Record<NewsRelevance, 'red' | 'yellow' | 'blue'> = {
  CRITICAL: 'red',
  WATCH: 'yellow',
  LEAGUE: 'blue',
};

function timeAgo(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

export function NewsFeedTab({ data, userId }: { data: LeagueData; userId: string }) {
  const { items, loading, fetchedAt, refresh } = useEspnNews();
  const [filter, setFilter] = useState<NewsRelevance | 'ALL'>('ALL');

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;

  const classified = useMemo(() => {
    if (!items) return null;
    if (!myRoster) {
      return sortNewsByRelevance(items.map((i) => ({ ...i, relevance: 'LEAGUE' as const, matchedPlayerName: null })));
    }
    return sortNewsByRelevance(classifyNewsForRoster(items, myRoster, data.players));
  }, [items, myRoster, data.players]);

  const filtered = classified?.filter((i) => filter === 'ALL' || i.relevance === filter) ?? [];

  console.debug('[NewsFeedTab] render', { itemCount: items?.length ?? null, hasMyRoster: !!myRoster, filter });

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
        <span className="font-semibold">Headlines come live from ESPN's public news feed</span> at page load and
        refresh automatically every 30 minutes. This is an unofficial, undocumented endpoint — if it's ever
        unreachable this session, this tab shows an honest "unavailable" state rather than fabricated headlines.
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle
            subtitle={
              myRoster
                ? 'CRITICAL = names one of your rostered players. WATCH = involves a team you have exposure to. LEAGUE = general NFL news.'
                : 'Select your team from the dropdown in the header above for personalized CRITICAL/WATCH relevance badges.'
            }
          >
            News Feed
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {fetchedAt && <span>Updated {new Date(fetchedAt).toLocaleTimeString()}</span>}
            <button
              onClick={refresh}
              disabled={loading}
              className="rounded-md bg-slate-800 px-2 py-1 font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {loading ? 'Refreshing…' : 'Refresh news'}
            </button>
          </div>
        </div>

        {items === null && !loading && (
          <p className="text-sm text-slate-500">
            Live news is unavailable right now (ESPN's feed didn't respond). Try refreshing, or check back later.
          </p>
        )}

        {classified && (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(['ALL', 'CRITICAL', 'WATCH', 'LEAGUE'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    filter === f ? 'bg-violet-600 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filtered.map((item, i) => (
                <div key={`${item.headline}-${i}`} className="rounded-lg border border-slate-800 p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge color={RELEVANCE_COLOR[item.relevance]}>{item.relevance}</Badge>
                    {item.matchedPlayerName && <span className="text-xs text-slate-500">re: {item.matchedPlayerName}</span>}
                    <span className="text-xs text-slate-600">{timeAgo(item.published)}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-100">{item.headline}</p>
                  {item.description && <p className="mt-1 text-xs text-slate-400">{item.description}</p>}
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-violet-400 hover:bg-slate-700"
                    >
                      Read full story ↗
                    </a>
                  )}
                </div>
              ))}
              {filtered.length === 0 && <p className="text-sm text-slate-500">No news matches this filter right now.</p>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
