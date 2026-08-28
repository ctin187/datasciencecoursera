import { useState } from 'react';
import { useLeagueData } from './hooks/useLeagueData';
import { useDerivedData } from './hooks/useDerivedData';
import { LeagueSettingsTab } from './components/tabs/LeagueSettingsTab';
import { DraftAssistantTab } from './components/tabs/DraftAssistantTab';
import { TradeAnalyzerTab } from './components/tabs/TradeAnalyzerTab';
import { WaiversTab } from './components/tabs/WaiversTab';
import { AgingCurvesTab } from './components/tabs/AgingCurvesTab';
import { RosterHealthTab } from './components/tabs/RosterHealthTab';

const TABS = [
  { id: 'league', label: 'League Settings' },
  { id: 'draft', label: 'Draft Assistant' },
  { id: 'trade', label: 'Trade Analyzer' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'aging', label: 'Aging Curves' },
  { id: 'roster', label: 'Roster Health' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [leagueIdInput, setLeagueIdInput] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string>('');
  const [tab, setTab] = useState<TabId>('league');

  const { data, loading, error, progress } = useLeagueData(activeLeagueId);
  const derived = useDerivedData(data?.players);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = leagueIdInput.trim();
    if (!trimmed) return;
    setActiveLeagueId(trimmed);
    setActiveUserId(userIdInput.trim());
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Fantasy Dynasty Dashboard</h1>
              <p className="text-xs text-slate-500 sm:text-sm">
                Startup-draft intelligence for Sleeper dynasty leagues — ADP vs. long-term value, trade analysis,
                FAAB optimization, and aging curves.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Sleeper League ID
                <input
                  value={leagueIdInput}
                  onChange={(e) => setLeagueIdInput(e.target.value)}
                  placeholder="e.g. 918876425783136256"
                  className="w-56 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none ring-violet-500/50 focus:ring-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Your User ID (optional)
                <input
                  value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value)}
                  placeholder="for roster analysis"
                  className="w-48 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none ring-violet-500/50 focus:ring-2"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load League'}
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {!activeLeagueId && !error && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-400">
            <p className="text-lg font-medium text-slate-200">Enter your Sleeper League ID to get started</p>
            <p className="mt-2 text-sm">
              Find it in your league URL on sleeper.com, e.g. <code className="rounded bg-slate-800 px-1.5 py-0.5">
                sleeper.com/leagues/<b>918876425783136256</b>/team
              </code>
            </p>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
            {progress ?? 'Loading…'}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-6 text-rose-300">
            <p className="font-semibold">Couldn't load that league.</p>
            <p className="mt-1 text-sm">{error}</p>
            <p className="mt-3 text-xs text-rose-400/80">
              Double-check the League ID (it's the long number in your Sleeper league URL, not your username).
            </p>
          </div>
        )}

        {data && derived && (
          <>
            {data.stale && (
              <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                Showing cached data — the last live refresh failed, so some information may be stale.
              </div>
            )}
            {tab === 'league' && <LeagueSettingsTab data={data} userId={activeUserId} tradeValueMap={derived.tradeValueMap} />}
            {tab === 'draft' && <DraftAssistantTab derived={derived} />}
            {tab === 'trade' && <TradeAnalyzerTab data={data} derived={derived} />}
            {tab === 'waivers' && <WaiversTab data={data} derived={derived} userId={activeUserId} />}
            {tab === 'aging' && <AgingCurvesTab derived={derived} />}
            {tab === 'roster' && <RosterHealthTab data={data} derived={derived} userId={activeUserId} />}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-slate-600 sm:px-6">
        Data from the public Sleeper API. ADP, dynasty trade values, and snap/target share trends are a curated seed
        dataset for demonstration — refresh with a live consensus feed for production use.
      </footer>
    </div>
  );
}
