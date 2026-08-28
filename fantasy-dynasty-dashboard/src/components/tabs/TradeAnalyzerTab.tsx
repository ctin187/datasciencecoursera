import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import {
  analyzeTrade,
  PICK_VALUES,
  tradeContextAssessment,
  type TradeAsset,
} from '../../lib/tradeAnalyzer';
import { peakAgeRange } from '../../lib/agingCurves';
import { detectLifecyclePhase } from '../../lib/rosterAnalyzer';
import { resolvePlayerValue } from '../../lib/playerValue';
import type { LifecyclePhase, PlayersMap, SleeperRoster } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

const UNRANKED_TIER = 'Unranked / deep roster';

function playerLabel(id: string, players: PlayersMap, derived: Derived) {
  const resolved = resolvePlayerValue(id, players, derived.tradeValueMap);
  return {
    name: resolved.name,
    position: resolved.position,
    age: resolved.age,
    value: resolved.consensusValue,
    tier: resolved.tier,
    team: resolved.team,
    status: resolved.status,
  };
}

function TradeSideEditor({
  label,
  assets,
  setAssets,
  derived,
  players,
  roster,
  phase,
}: {
  label: string;
  assets: TradeAsset[];
  setAssets: (a: TradeAsset[]) => void;
  derived: Derived;
  players: PlayersMap;
  roster?: SleeperRoster;
  phase: LifecyclePhase | null;
}) {
  const [query, setQuery] = useState('');

  // Searches the full live Sleeper player pool (name, ID, position, team, status) - not
  // just the curated ~130-player trade-value seed dataset, which was the previous bug:
  // rostered bench/depth players outside that seed list simply never matched a search.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: { playerId: string; name: string; position: string; team: string | null; age: number | null; tier: string }[] = [];
    for (const p of Object.values(players)) {
      if (results.length >= 25) break;
      if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(p.position)) continue;
      const full = p.full_name || `${p.first_name} ${p.last_name}`;
      const haystack = `${full} ${p.player_id} ${p.position} ${p.team ?? ''} ${p.status}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      const info = playerLabel(p.player_id, players, derived);
      results.push({ playerId: p.player_id, name: info.name, position: info.position, team: info.team, age: info.age, tier: info.tier });
    }
    return results.slice(0, 8);
  }, [query, players, derived]);

  const addPlayer = (playerId: string) => {
    if (assets.some((a) => a.playerId === playerId)) return;
    setAssets([...assets, { type: 'player', playerId }]);
    setQuery('');
  };

  const addPick = (label: string) => {
    setAssets([...assets, { type: 'pick', pickLabel: label, pickValue: PICK_VALUES[label] }]);
  };

  const remove = (idx: number) => setAssets(assets.filter((_, i) => i !== idx));

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-200">{label}</h4>
        {phase && <Badge color={phase === 'win-now' ? 'purple' : phase === 'rebuild' ? 'blue' : 'gray'}>{phase}</Badge>}
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any player: name, position, team, status..."
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none ring-violet-500/50 focus:ring-2"
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 shadow-lg">
            {matches.map((m) => (
              <button
                key={m.playerId}
                onClick={() => addPlayer(m.playerId)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-800"
              >
                {m.name} <span className="text-slate-500">· {m.position}{m.team ? ` · ${m.team}` : ''}{m.age ? ` · ${m.age}y` : ''} · {m.tier}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PICK_VALUES).map((label) => (
          <button
            key={label}
            onClick={() => addPick(label)}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            + {label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {assets.map((a, idx) => {
          if (a.type === 'pick') {
            return (
              <div key={idx} className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-1.5 text-sm">
                <span>{a.pickLabel} pick</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{a.pickValue}</span>
                  <button onClick={() => remove(idx)} className="text-rose-400 hover:text-rose-300">✕</button>
                </div>
              </div>
            );
          }
          const info = playerLabel(a.playerId!, players, derived);
          return (
            <div key={idx} className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-1.5 text-sm">
              <span>
                {info.name} <span className="text-slate-500">· {info.position} · {info.age ?? '?'}y</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">{info.value}</span>
                <button onClick={() => remove(idx)} className="text-rose-400 hover:text-rose-300">✕</button>
              </div>
            </div>
          );
        })}
        {assets.length === 0 && <p className="text-xs text-slate-500">No assets added yet.</p>}
      </div>

      {roster && <RosterQuickAdd roster={roster} derived={derived} players={players} onAdd={addPlayer} added={assets} />}
    </div>
  );
}

function RosterQuickAdd({
  roster,
  derived,
  players,
  onAdd,
  added,
}: {
  roster: SleeperRoster;
  derived: Derived;
  players: PlayersMap;
  onAdd: (id: string) => void;
  added: TradeAsset[];
}) {
  const starterSet = new Set((roster.starters ?? []).filter((id) => id !== '0'));
  const emptyStarterSlots = (roster.starters ?? []).filter((id) => id === '0').length;

  // Show every rostered player - the old version filtered out anyone missing from the
  // curated trade-value seed dataset, which is exactly why only 3-4 of a 12+ man
  // roster ever showed up. Everyone appears now; unranked players just show a
  // fallback value/tier instead of being hidden.
  const allIds = roster.players ?? [];
  const sorted = useMemo(() => {
    return [...allIds].sort((a, b) => {
      const ia = playerLabel(a, players, derived);
      const ib = playerLabel(b, players, derived);
      if (ia.position !== ib.position) return ia.position.localeCompare(ib.position);
      if ((ib.age ?? 0) !== (ia.age ?? 0)) return (ib.age ?? 0) - (ia.age ?? 0);
      return ia.name.localeCompare(ib.name);
    });
  }, [allIds, players, derived]);

  if (sorted.length === 0 && emptyStarterSlots === 0) return null;

  const rosterSize = roster.players?.length ?? 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">
          Quick-add from roster ({rosterSize} player{rosterSize === 1 ? '' : 's'})
        </p>
        {emptyStarterSlots > 0 && <span className="text-[11px] text-amber-400">{emptyStarterSlots} empty starter slot{emptyStarterSlots === 1 ? '' : 's'}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((id) => {
          const info = playerLabel(id, players, derived);
          const already = added.some((a) => a.playerId === id);
          const isStarter = starterSet.has(id);
          return (
            <button
              key={id}
              disabled={already}
              onClick={() => onAdd(id)}
              title={`${info.name} | ${info.position} | Age ${info.age ?? '?'} | ${info.status}${isStarter ? ' | Starter' : ' | Bench'}`}
              className={`rounded-md px-2 py-1 text-xs ${
                already
                  ? 'cursor-not-allowed bg-slate-900 text-slate-600'
                  : info.tier === UNRANKED_TIER
                    ? 'bg-slate-800/60 text-slate-400 hover:bg-slate-700'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {info.name}
              <span className="text-slate-500"> · {info.position}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TradeAnalyzerTab({
  data,
  derived,
  onRefreshRosters,
  refreshingRosters,
}: {
  data: LeagueData;
  derived: Derived;
  onRefreshRosters: () => Promise<void>;
  refreshingRosters: boolean;
}) {
  const [sideAAssets, setSideAAssets] = useState<TradeAsset[]>([]);
  const [sideBAssets, setSideBAssets] = useState<TradeAsset[]>([]);
  const [rosterAId, setRosterAId] = useState<number | ''>('');
  const [rosterBId, setRosterBId] = useState<number | ''>('');

  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const rosterOptions = data.rosters.map((r) => ({
    id: r.roster_id,
    name: (r.owner_id && userById.get(r.owner_id)?.metadata?.team_name) || userById.get(r.owner_id ?? '')?.display_name || `Roster ${r.roster_id}`,
    size: r.players?.length ?? 0,
  }));

  const phaseFor = (rosterId: number | ''): LifecyclePhase | null => {
    if (rosterId === '') return null;
    const roster = data.rosters.find((r) => r.roster_id === rosterId);
    if (!roster) return null;
    let eliteAging = 0;
    let young = 0;
    let ageSum = 0;
    let ageCount = 0;
    for (const id of roster.players ?? []) {
      const p = data.players[id];
      if (!p?.age) continue;
      const resolved = resolvePlayerValue(id, data.players, derived.tradeValueMap);
      ageSum += p.age;
      ageCount++;
      if (resolved.consensusValue >= 6000 && p.age >= 28) eliteAging++;
      if (resolved.consensusValue >= 1500 && p.age <= 24) young++;
    }
    const avgAge = ageCount ? ageSum / ageCount : 0;
    return detectLifecyclePhase(eliteAging, young, avgAge, roster.settings.wins ?? 0);
  };

  const phaseA = phaseFor(rosterAId);
  const phaseB = phaseFor(rosterBId);

  const result = useMemo(
    () => analyzeTrade(sideAAssets, sideBAssets, data.players, derived.tradeValueMap),
    [sideAAssets, sideBAssets, data.players, derived.tradeValueMap],
  );

  const assessment = tradeContextAssessment(result.sideA, result.sideB, phaseA, phaseB);

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle subtitle="Search or quick-add from a roster to build both sides of a trade.">Trade Value Analyzer</CardTitle>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Rosters as of {new Date(data.rostersFetchedAt).toLocaleTimeString()}</span>
            <button
              onClick={() => onRefreshRosters()}
              disabled={refreshingRosters}
              className="rounded-md bg-slate-800 px-2 py-1 font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {refreshingRosters ? 'Refreshing…' : 'Refresh rosters'}
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Team A roster (optional, for quick-add + context)
            <select
              value={rosterAId}
              onChange={(e) => setRosterAId(e.target.value ? Number(e.target.value) : '')}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {rosterOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.size} players)</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Team B roster (optional)
            <select
              value={rosterBId}
              onChange={(e) => setRosterBId(e.target.value ? Number(e.target.value) : '')}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {rosterOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.size} players)</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row">
          <TradeSideEditor
            label="Team A gives"
            assets={sideAAssets}
            setAssets={setSideAAssets}
            derived={derived}
            players={data.players}
            roster={rosterAId ? data.rosters.find((r) => r.roster_id === rosterAId) : undefined}
            phase={phaseA}
          />
          <div className="hidden w-px bg-slate-800 sm:block" />
          <TradeSideEditor
            label="Team B gives"
            assets={sideBAssets}
            setAssets={setSideBAssets}
            derived={derived}
            players={data.players}
            roster={rosterBId ? data.rosters.find((r) => r.roster_id === rosterBId) : undefined}
            phase={phaseB}
          />
        </div>
      </Card>

      {(sideAAssets.length > 0 || sideBAssets.length > 0) && (
        <Card>
          <CardTitle>Result</CardTitle>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Team A Value" value={result.sideA.totalValue} hint={result.sideA.avgAge ? `avg age ${result.sideA.avgAge.toFixed(1)}` : undefined} />
            <StatTile label="Team B Value" value={result.sideB.totalValue} hint={result.sideB.avgAge ? `avg age ${result.sideB.avgAge.toFixed(1)}` : undefined} />
            <StatTile
              label="Value Delta"
              value={`${result.deltaPct > 0 ? '+' : ''}${result.deltaPct}%`}
              hint={result.winner === 'even' ? 'Roughly even' : `Favors Team ${result.winner}`}
            />
            <StatTile
              label="Winner"
              value={
                <Badge color={result.winner === 'A' ? 'green' : result.winner === 'B' ? 'blue' : 'gray'}>
                  {result.winner === 'even' ? 'Even trade' : `Team ${result.winner}`}
                </Badge>
              }
            />
          </div>
          {assessment && <p className="text-sm text-slate-300">{assessment}</p>}

          <div className="mt-4 space-y-1.5">
            {[...sideAAssets, ...sideBAssets]
              .filter((a) => a.type === 'player' && a.playerId)
              .map((a) => {
                const info = playerLabel(a.playerId!, data.players, derived);
                const v = derived.threeDValues.get(a.playerId!);
                const { start, end } = peakAgeRange(info.position);
                return (
                  <div key={a.playerId} className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-200">{info.name}</span> ({info.position}, age {info.age ?? '?'}) — peak {start}-{end}.
                    {v && ` Current ${Math.round(v.currentProjection)} pts | 3-yr avg ${Math.round(v.threeYearOutlook)} | 5-yr avg ${Math.round(v.fiveYearOutlook)}.`}
                    {!v && ` No 3D-value projection (outside the curated ADP dataset).`}
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
