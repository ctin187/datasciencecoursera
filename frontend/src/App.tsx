import { useState } from 'react';
import { useCrtEffects } from './hooks/useCrtEffects';
import { Mascot } from './components/ui/Mascot';
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
  const [crtOn, setCrtOn] = useCrtEffects();

  const { data, loading, error, progress } = useLeagueData(activeLeagueId);
  const seasonSim = useSeasonSimulation(activeLeagueId, data?.league, data?.rosters, data?.users);
  const rosterHealth = useRosterHealth(data, activeUserId);
  const waiverTargets = useWaiverTargets(data, activeUserId);
  const projectionPool = useProjectionPool(data?.league);
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
    <div className={`crt-root min-h-screen bg-slate-950 text-slate-100 ${crtOn ? 'crt-on' : ''}`}>
      <header className="border-b-2 border-violet-800/50 bg-slate-900/70">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Mascot state="idle" size={40} className="hidden shrink-0 sm:block" />
              <div>
                <h1 className="font-display text-lg leading-tight tracking-wide text-violet-400 sm:text-xl" style={{ textShadow: '0 0 12px rgba(255,164,31,0.35)' }}>
                  GRIDIRON TERMINAL
                </h1>
                <p className="mt-1 max-w-xl text-[11px] text-slate-500 sm:text-xs">
                  League-specific analysis for your actual Sleeper league — auto-detected settings, real VOR from nflverse
                  projections, and Monte Carlo playoff odds. Not a generic rankings site.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <button
                type="button"
                onClick={() => setCrtOn(!crtOn)}
                title="Toggle scanline/CRT overlay effects"
                className="self-end rounded border border-slate-700 px-2 py-1 font-mono text-[10px] tracking-wide text-slate-500 uppercase hover:border-violet-600 hover:text-violet-400"
              >
                CRT: {crtOn ? 'ON' : 'OFF'}
              </button>
              <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex flex-col gap-1 font-mono text-[11px] tracking-wide text-slate-400 uppercase">
                  Sleeper League ID
                  <input
                    value={leagueIdInput}
                    onChange={(e) => setLeagueIdInput(e.target.value)}
                    placeholder="e.g. 918876425783136256"
                    className="w-56 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-slate-100 normal-case outline-none ring-violet-500/50 focus:ring-2"
                  />
                </label>
                <button
                  type="submit"
                  className="min-h-[44px] rounded border-2 border-violet-400/60 bg-violet-600 px-4 py-2.5 font-display text-[10px] tracking-wide text-slate-950 uppercase transition-transform hover:bg-violet-500 active:translate-y-px disabled:opacity-50 sm:min-h-0 sm:py-2.5"
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load League'}
                </button>
              </form>
            </div>
          </div>
          {data && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex flex-wrap items-center gap-2 font-mono text-[11px] tracking-wide text-slate-400 uppercase">
                Your Team
                <select
                  value={activeUserId}
                  onChange={(e) => setActiveUserId(e.target.value)}
                  className="w-full max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-sans text-sm text-slate-100 normal-case outline-none ring-violet-500/50 focus:ring-2 sm:w-64"
                >
                  <option value="">— select your team —</option>
                  {teamOptions.map((t) => (
                    <option key={t.userId} value={t.userId}>{t.label}</option>
                  ))}
                </select>
              </label>
              <span className="hidden text-xs text-slate-600 sm:inline">Powers roster value, waiver drop suggestions, and your season outlook.</span>
            </div>
          )}
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 pb-3 sm:px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`min-h-[40px] shrink-0 rounded border-2 px-3 py-2 font-display text-[9px] tracking-wide whitespace-nowrap uppercase transition-colors sm:text-[10px] ${
                tab === t.id
                  ? 'border-violet-400 bg-violet-600 text-slate-950'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {!activeLeagueId && !error && (
          <div className="arcade-panel arcade-panel-accent rounded-md border-dashed bg-slate-900/40 p-10 text-center text-slate-400">
            <Mascot state="idle" size={64} className="mx-auto mb-4" />
            <p className="font-display text-sm leading-relaxed text-slate-200">Enter your Sleeper League ID to get started</p>
            <p className="mt-3 text-sm">
              Find it in your league URL on sleeper.com, e.g. <code className="break-all rounded bg-slate-800 px-1.5 py-0.5 font-mono">
                sleeper.com/leagues/<b>918876425783136256</b>/team
              </code>
            </p>
            <p className="mt-2 text-sm">Works for both redraft and dynasty/keeper leagues — the app detects which one you're in.</p>
          </div>
        )}

        {loading && (
          <div className="arcade-panel rounded-md bg-slate-900/60 p-8 text-center text-slate-400">
            <span className="terminal-cursor font-scoreboard text-lg">{progress ?? 'Loading…'}</span>
          </div>
        )}

        {error && (
          <div className="arcade-panel rounded-md border-rose-800 bg-rose-950/40 p-6 text-rose-300">
            <div className="flex items-start gap-3">
              <Mascot state="danger" size={40} className="shrink-0" />
              <div>
                <p className="font-display text-xs">Couldn't load that league.</p>
                <p className="mt-2 text-sm">{error}</p>
                <p className="mt-3 text-xs text-rose-400/80">
                  Double-check the League ID (it's the long number in your Sleeper league URL, not your username).
                </p>
              </div>
            </div>
          </div>
        )}

        {data && (
          <>
            {data.stale && (
              <div className="mb-4 rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2 font-mono text-xs text-amber-300">
                ⚠ Showing cached data — the last live refresh failed, so some information may be stale.
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

      <footer className="mx-auto max-w-7xl border-t border-slate-800 px-4 py-6 text-center text-xs text-slate-600 sm:px-6">
        {data && <p className="mb-1 font-mono text-slate-500">Rosters loaded {new Date(data.rostersFetchedAt).toLocaleTimeString()}</p>}
        League, roster, and matchup data from the public Sleeper API. Projections and VOR from nflverse play-by-play data via
        the project's own backend. No fabricated statistics — see each tab for source and methodology.
      </footer>
    </div>
  );
}
