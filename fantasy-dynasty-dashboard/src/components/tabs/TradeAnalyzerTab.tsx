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
import type { LifecyclePhase, SleeperRoster } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

function TradeSideEditor({
  label,
  assets,
  setAssets,
  derived,
  roster,
  phase,
}: {
  label: string;
  assets: TradeAsset[];
  setAssets: (a: TradeAsset[]) => void;
  derived: Derived;
  roster?: SleeperRoster;
  phase: LifecyclePhase | null;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return derived.tradeValues
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, derived.tradeValues]);

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
          placeholder="Search player to add..."
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
                {m.name} <span className="text-slate-500">· {m.position} · {m.tier}</span>
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
          const tv = derived.tradeValueMap.get(a.playerId!);
          return (
            <div key={idx} className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-1.5 text-sm">
              <span>
                {tv?.name ?? a.playerId} {tv && <span className="text-slate-500">· {tv.position} · {tv.age}y</span>}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">{tv?.consensusValue ?? 0}</span>
                <button onClick={() => remove(idx)} className="text-rose-400 hover:text-rose-300">✕</button>
              </div>
            </div>
          );
        })}
        {assets.length === 0 && <p className="text-xs text-slate-500">No assets added yet.</p>}
      </div>

      {roster && <RosterQuickAdd roster={roster} derived={derived} onAdd={addPlayer} added={assets} />}
    </div>
  );
}

function RosterQuickAdd({
  roster,
  derived,
  onAdd,
  added,
}: {
  roster: SleeperRoster;
  derived: Derived;
  onAdd: (id: string) => void;
  added: TradeAsset[];
}) {
  const ids = (roster.players ?? []).filter((id) => derived.tradeValueMap.has(id));
  if (ids.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Quick-add from roster</p>
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const tv = derived.tradeValueMap.get(id)!;
          const already = added.some((a) => a.playerId === id);
          return (
            <button
              key={id}
              disabled={already}
              onClick={() => onAdd(id)}
              className={`rounded-md px-2 py-1 text-xs ${already ? 'cursor-not-allowed bg-slate-900 text-slate-600' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {tv.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TradeAnalyzerTab({ data, derived }: { data: LeagueData; derived: Derived }) {
  const [sideAAssets, setSideAAssets] = useState<TradeAsset[]>([]);
  const [sideBAssets, setSideBAssets] = useState<TradeAsset[]>([]);
  const [rosterAId, setRosterAId] = useState<number | ''>('');
  const [rosterBId, setRosterBId] = useState<number | ''>('');

  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const rosterOptions = data.rosters.map((r) => ({
    id: r.roster_id,
    name: (r.owner_id && userById.get(r.owner_id)?.metadata?.team_name) || userById.get(r.owner_id ?? '')?.display_name || `Roster ${r.roster_id}`,
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
      const tv = derived.tradeValueMap.get(id);
      if (!p?.age) continue;
      ageSum += p.age;
      ageCount++;
      if ((tv?.consensusValue ?? 0) >= 6000 && p.age >= 28) eliteAging++;
      if ((tv?.consensusValue ?? 0) >= 1500 && p.age <= 24) young++;
    }
    const avgAge = ageCount ? ageSum / ageCount : 0;
    return detectLifecyclePhase(eliteAging, young, avgAge, roster.settings.wins ?? 0);
  };

  const phaseA = phaseFor(rosterAId);
  const phaseB = phaseFor(rosterBId);

  const result = useMemo(
    () => analyzeTrade(sideAAssets, sideBAssets, derived.tradeValueMap),
    [sideAAssets, sideBAssets, derived.tradeValueMap],
  );

  const assessment = tradeContextAssessment(result.sideA, result.sideB, phaseA, phaseB);

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Search or quick-add from a roster to build both sides of a trade.">Trade Value Analyzer</CardTitle>

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
                <option key={r.id} value={r.id}>{r.name}</option>
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
                <option key={r.id} value={r.id}>{r.name}</option>
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
            roster={rosterAId ? data.rosters.find((r) => r.roster_id === rosterAId) : undefined}
            phase={phaseA}
          />
          <div className="hidden w-px bg-slate-800 sm:block" />
          <TradeSideEditor
            label="Team B gives"
            assets={sideBAssets}
            setAssets={setSideBAssets}
            derived={derived}
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
                const tv = derived.tradeValueMap.get(a.playerId!);
                const v = derived.threeDValues.get(a.playerId!);
                if (!tv) return null;
                const { start, end } = peakAgeRange(tv.position);
                return (
                  <div key={a.playerId} className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400">
                    <span className="font-medium text-slate-200">{tv.name}</span> ({tv.position}, age {tv.age}) — peak {start}-{end}.
                    {v && ` Current ${Math.round(v.currentProjection)} pts | 3-yr avg ${Math.round(v.threeYearOutlook)} | 5-yr avg ${Math.round(v.fiveYearOutlook)}.`}
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
