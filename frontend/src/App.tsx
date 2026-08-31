import { useState } from 'react';
import { useLeagueData } from './hooks/useLeagueData';
import { useSeasonSimulation } from './hooks/useSeasonSimulation';
import { useRosterHealth } from './hooks/useRosterHealth';
import { useWaiverTargets } from './hooks/useWaiverTargets';
import { useProjectionPool } from './hooks/useProjectionPool';
import { useSeasonTransactions } from './hooks/useSeasonTransactions';
import { useDraftPicks } from './hooks/useDraftPicks';
import { LeagueOverviewTab } from './components/tabs/LeagueOverviewTab';
import { RosterValueTab } from './components/tabs/RosterValueTab';
import { WaiverWireTab } from './components/tabs/WaiverWireTab';
import { SeasonOutlookTab } from './components/tabs/SeasonOutlookTab';
import { TradeAnalyzerTab } from './components/tabs/TradeAnalyzerTab';
import { DraftAssistantTab } from './components/tabs/DraftAssistantTab';
import { LeagueDnaTab } from './components/tabs/LeagueDnaTab';
import { EdgeEngineTab } from './components/tabs/EdgeEngineTab';
import { FranchiseHistoryTab } from './components/tabs/FranchiseHistoryTab';
import { useLeagueHistory } from './hooks/useLeagueHistory';

// Four tabs. This app targets both redraft and dynasty/keeper Sleeper
// leagues - League Overview auto-detects which one you're in (and every
// other setting: scoring, superflex, waivers, playoffs) directly from
// Sleeper rather than assuming a format. Roster Value and Waiver Wire run on
// real nflverse-derived projections and VOR from the Python backend - if
// that backend isn't configured, those tabs say so instead of guessing.
// Season Outlook is a Monte Carlo playoff/championship probability engine
// built from real Sleeper matchup history. Draft Assistant, Trade Analyzer,
// FAAB optimization, League DNA, and the Edge/backtesting layers described
// in the product spec are not built yet - see the README roadmap.
const TABS = [
  { id: 'league', label: 'League Overview' },
  { id: 'edge', label: 'Edge Engine' },
  { id: 'roster', label: 'Roster Value' },
  { id: 'draft', label: 'Draft Assistant' },
  { id: 'trade', label: 'Trade Analyzer' },
  { id: 'waivers', label: 'Waiver Wire' },
  { id: 'season', label: 'Season Outlook' },
  { id: 'dna', label: 'League DNA' },
  { id: 'history', label: 'Franchise History' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [leagueIdInput, setLeagueIdInput] = useState('');
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string>('');
  const [tab, setTab] = useState<TabId>('league');

  const { data, loading, error, progress } = useLeagueData(activeLeagueId);
  const seasonSim = useSeasonSimulation(activeLeagueId, data?.league, data?.rosters, data?.users);
  const rosterHealth = useRosterHealth(data, activeUserId);
  const waiverTargets = useWaiverTargets(data, activeUserId);
  const projectionPool = useProjectionPool(data?.league, data?.players);
  const seasonTransactions = useSeasonTransactions(activeLeagueId, data?.league);
  const activeDraft = data ? (data.drafts.find((d) => d.league_id === data.league.league_id) ?? data.drafts[0]) : undefined;
  const draftPicks = useDraftPicks(activeDraft?.draft_id ?? null);
  const leagueHistory = useLeagueHistory(activeLeagueId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = leagueIdInput.trim();
    if (!trimmed) return;
    setActiveLeagueId(trimmed);
    setActiveUserId('');
  };

  const teamOptions = data
    ? [...data.users]
        .map((u) => {
          const roster = data.rosters.find((r) => r.owner_id === u.user_id);
          const record = roster ? ` (${roster.settings.wins}-${roster.settings.losses}${roster.settings.ties ? `-${roster.settings.ties}` : ''})` : '';
          return { userId: u.user_id, label: `${u.metadata?.team_name || u.display_name}${record}` };
        })
        .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  return (
    <div className="min-h-screen">
      <header className="app-header">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[15px] leading-none font-bold tracking-[0.04em] text-white uppercase sm:text-base">
              Front Office
            </h1>
            <span className="hidden text-[10px] tracking-[0.09em] text-[#a9bed6] uppercase sm:inline">
              Fantasy Analytics
            </span>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[9px] font-semibold tracking-[0.08em] text-[#a9bed6] uppercase">
              League ID
              <input
                value={leagueIdInput}
                onChange={(e) => setLeagueIdInput(e.target.value)}
                placeholder="918876425783136256"
                className="w-48 rounded-[2px] border border-[#1d4f80] bg-white px-2 py-1 font-mono text-[12px] text-[#0b1b2b] normal-case outline-none focus:border-[#c60c30] sm:w-56"
              />
            </label>
            <button type="submit" disabled={loading} className="btn btn-primary border-white/25 py-[5px]">
              {loading ? 'Loading…' : 'Load'}
            </button>
            {data && (
              <label className="flex flex-col gap-0.5 text-[9px] font-semibold tracking-[0.08em] text-[#a9bed6] uppercase">
                Your Team
                <select
                  value={activeUserId}
                  onChange={(e) => setActiveUserId(e.target.value)}
                  className="w-full max-w-full rounded-[2px] border border-[#1d4f80] bg-white px-2 py-1 text-[12px] text-[#0b1b2b] normal-case outline-none focus:border-[#c60c30] sm:w-56"
                >
                  <option value="">— select —</option>
                  {teamOptions.map((t) => (
                    <option key={t.userId} value={t.userId}>{t.label}</option>
                  ))}
                </select>
              </label>
            )}
          </form>
        </div>

        <nav className="app-nav mx-auto max-w-[1400px] px-3 sm:px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`nav-tab${tab === t.id ? ' is-active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1400px] px-3 py-3 sm:px-4">
        {!activeLeagueId && !error && (
          <div className="panel p-6 text-center">
            <p className="text-[15px] font-semibold text-[color:var(--pats-navy)]">
              Enter your Sleeper League ID to get started
            </p>
            <p className="mt-2 text-muted">
              Find it in your league URL on sleeper.com, e.g.{' '}
              <code className="break-all rounded-[2px] bg-[color:var(--pats-gray-100)] px-1 py-0.5 font-mono text-[12px]">
                sleeper.com/leagues/<b>918876425783136256</b>/team
              </code>
            </p>
            <p className="mt-1.5 text-muted">
              Works for both redraft and dynasty/keeper leagues — the app detects which one you're in.
            </p>
          </div>
        )}

        {loading && (
          <div className="panel p-6 text-center text-muted">{progress ?? 'Loading…'}</div>
        )}

        {error && (
          <div className="notice-error">
            <p className="font-semibold">Couldn't load that league.</p>
            <p className="mt-1">{error}</p>
            <p className="mt-1.5 text-[11px]">
              Double-check the League ID (it's the long number in your Sleeper league URL, not your username).
            </p>
          </div>
        )}

        {data && (
          <>
            {data.stale && (
              <div className="notice mb-3">
                <span className="font-semibold">Showing cached data</span> — the last live refresh failed, so some
                information may be stale.
              </div>
            )}
            {tab === 'league' && <LeagueOverviewTab data={data} userId={activeUserId} />}
            {tab === 'edge' && (
              <EdgeEngineTab
                data={data}
                userId={activeUserId}
                rosterHealth={rosterHealth}
                waiverTargets={waiverTargets}
                seasonSim={seasonSim}
                draftPicks={draftPicks}
                pool={projectionPool}
              />
            )}
            {tab === 'roster' && <RosterValueTab data={data} userId={activeUserId} health={rosterHealth} />}
            {tab === 'draft' && <DraftAssistantTab data={data} userId={activeUserId} pool={projectionPool} draftPicks={draftPicks} />}
            {tab === 'trade' && <TradeAnalyzerTab data={data} health={rosterHealth} seasonSim={seasonSim} />}
            {tab === 'waivers' && (
              <WaiverWireTab data={data} userId={activeUserId} waivers={waiverTargets} pool={projectionPool} faab={seasonTransactions} />
            )}
            {tab === 'season' && <SeasonOutlookTab data={data} userId={activeUserId} sim={seasonSim} />}
            {tab === 'dna' && (
              <LeagueDnaTab data={data} draftPicks={draftPicks} transactions={seasonTransactions} history={leagueHistory} />
            )}
            {tab === 'history' && <FranchiseHistoryTab history={leagueHistory} userId={activeUserId} />}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-[1400px] border-t border-[color:var(--rule)] px-3 py-4 text-center text-[11px] text-muted sm:px-4">
        {data && (
          <p className="mb-1 font-mono">Rosters loaded {new Date(data.rostersFetchedAt).toLocaleTimeString()}</p>
        )}
        League, roster, and matchup data from the public Sleeper API. Projections and VOR from nflverse play-by-play
        data via the project's own backend. No fabricated statistics — see each tab for source and methodology.
      </footer>
    </div>
  );
}
