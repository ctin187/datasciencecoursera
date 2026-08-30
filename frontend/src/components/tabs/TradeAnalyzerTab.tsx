import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { RosterHealthState } from '../../hooks/useRosterHealth';
import type { SeasonSimulationState } from '../../hooks/useSeasonSimulation';
import { evaluateTrade, type TradeImpact, type TradePlayerInfo } from '../../lib/tradeSimulator';
import { explainTrade } from '../../lib/explain';
import { Card, CardTitle, StatTile } from '../ui/Card';

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function TradeAnalyzerTab({
  data,
  health,
  seasonSim,
}: {
  data: LeagueData;
  health: RosterHealthState;
  seasonSim: SeasonSimulationState;
}) {
  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const teamOptions = data.rosters.map((r) => ({
    rosterId: r.roster_id,
    label: (r.owner_id && (userById.get(r.owner_id)?.metadata?.team_name || userById.get(r.owner_id)?.display_name)) || `Roster ${r.roster_id}`,
  }));

  const [rosterAId, setRosterAId] = useState<number | null>(teamOptions[0]?.rosterId ?? null);
  const [rosterBId, setRosterBId] = useState<number | null>(teamOptions[1]?.rosterId ?? null);
  const [outA, setOutA] = useState<Set<string>>(new Set());
  const [outB, setOutB] = useState<Set<string>>(new Set());
  const [impact, setImpact] = useState<TradeImpact | null>(null);
  const [computing, setComputing] = useState(false);

  const playerInfo = useMemo(() => {
    const map = new Map<string, TradePlayerInfo>();
    if (!health.result) return map;
    for (const team of health.result.teams) {
      for (const s of team.starters) {
        if (s.player) map.set(s.player.sleeper_id, { name: s.player.name, position: s.player.position, vorPerGame: s.player.vor_per_game });
      }
      for (const b of team.bench) {
        map.set(b.sleeper_id, { name: b.name, position: b.position, vorPerGame: b.vor_per_game });
      }
    }
    return map;
  }, [health.result]);

  const rosterA = data.rosters.find((r) => r.roster_id === rosterAId);
  const rosterB = data.rosters.find((r) => r.roster_id === rosterBId);

  const playerLabel = (id: string) => {
    const info = playerInfo.get(id);
    if (info) return `${info.name ?? id} (${info.position ?? '?'}) · VOR ${info.vorPerGame != null ? info.vorPerGame.toFixed(2) : '—'}`;
    const p = data.players[id];
    return p ? `${p.full_name || `${p.first_name} ${p.last_name}`} (${p.position})` : id;
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const canEvaluate = rosterAId != null && rosterBId != null && rosterAId !== rosterBId && (outA.size > 0 || outB.size > 0) && health.result;

  const runEvaluation = () => {
    if (!canEvaluate || rosterAId == null || rosterBId == null) return;
    setComputing(true);
    // Defer one tick so the "computing" state paints before the Monte Carlo run blocks the thread.
    setTimeout(() => {
      const result = evaluateTrade({
        league: data.league,
        rosters: data.rosters,
        users: data.users,
        rosterAId,
        rosterBId,
        playersAOut: [...outA],
        playersBOut: [...outB],
        playerInfo,
        seasonRawInputs: seasonSim.rawInputs,
        seasonStatusReady: seasonSim.result?.status === 'ready',
      });
      setImpact(result);
      setComputing(false);
    }, 20);
  };

  if (!health.backendConfigured) {
    return (
      <Card>
        <CardTitle>Trade Analyzer</CardTitle>
        <p className="text-slate-400">The analytics backend isn't configured, so player values (VOR) aren't available — trades can't be evaluated.</p>
      </Card>
    );
  }

  if (health.loading) {
    return (
      <Card>
        <p className="text-center text-slate-400">Loading league-wide player values…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Pick both teams, check the players moving each direction, then evaluate. Picks aren't valued yet — players only.">
          Build a Trade
        </CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            { label: 'Team A sends', rosterId: rosterAId, setRosterId: setRosterAId, roster: rosterA, out: outA, setOut: setOutA, other: rosterBId },
            { label: 'Team B sends', rosterId: rosterBId, setRosterId: setRosterBId, roster: rosterB, out: outB, setOut: setOutB, other: rosterAId },
          ] as const).map((side, i) => (
            <div key={i} className="space-y-2">
              <select
                value={side.rosterId ?? ''}
                onChange={(e) => side.setRosterId(Number(e.target.value))}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-violet-500/50 focus:ring-2"
              >
                {teamOptions.map((t) => (
                  <option key={t.rosterId} value={t.rosterId} disabled={t.rosterId === side.other}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{side.label}:</p>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-800 p-2">
                {(side.roster?.players ?? []).map((id) => (
                  <label key={id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-800/50">
                    <input type="checkbox" checked={side.out.has(id)} onChange={() => toggle(side.out, side.setOut, id)} />
                    <span className="text-slate-200">{playerLabel(id)}</span>
                  </label>
                ))}
                {(side.roster?.players ?? []).length === 0 && <p className="p-2 text-xs text-slate-600">No players on this roster.</p>}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={runEvaluation}
          disabled={!canEvaluate || computing}
          className="mt-4 min-h-[44px] rounded-md bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {computing ? 'Simulating…' : 'Evaluate Trade'}
        </button>
      </Card>

      {impact && (
        <>
          <Card>
            <CardTitle>Roster Value Impact</CardTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label={`${impact.sideA.teamName} before`} value={impact.sideA.beforeStarterVor.toFixed(2)} hint="starter VOR/gm" />
              <StatTile label={`${impact.sideA.teamName} after`} value={impact.sideA.afterStarterVor.toFixed(2)} hint={`${impact.sideA.vorDelta >= 0 ? '+' : ''}${impact.sideA.vorDelta.toFixed(2)} change`} />
              <StatTile label={`${impact.sideB.teamName} before`} value={impact.sideB.beforeStarterVor.toFixed(2)} hint="starter VOR/gm" />
              <StatTile label={`${impact.sideB.teamName} after`} value={impact.sideB.afterStarterVor.toFixed(2)} hint={`${impact.sideB.vorDelta >= 0 ? '+' : ''}${impact.sideB.vorDelta.toFixed(2)} change`} />
            </div>
          </Card>

          {(impact.probabilityImpactA || impact.probabilityImpactB) && (
            <Card>
              <CardTitle subtitle="Re-runs the same Monte Carlo season simulator used in Season Outlook, with each team's modeled weekly score shifted by the VOR delta above.">
                Championship Probability Impact
              </CardTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {impact.probabilityImpactA && (
                  <>
                    <StatTile label={`${impact.sideA.teamName} Playoff Odds`} value={`${pct(impact.probabilityImpactA.before.playoff)} → ${pct(impact.probabilityImpactA.after.playoff)}`} />
                    <StatTile label={`${impact.sideA.teamName} Championship Odds`} value={`${pct(impact.probabilityImpactA.before.championship)} → ${pct(impact.probabilityImpactA.after.championship)}`} />
                  </>
                )}
                {impact.probabilityImpactB && (
                  <>
                    <StatTile label={`${impact.sideB.teamName} Playoff Odds`} value={`${pct(impact.probabilityImpactB.before.playoff)} → ${pct(impact.probabilityImpactB.after.playoff)}`} />
                    <StatTile label={`${impact.sideB.teamName} Championship Odds`} value={`${pct(impact.probabilityImpactB.before.championship)} → ${pct(impact.probabilityImpactB.after.championship)}`} />
                  </>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardTitle>Why</CardTitle>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {explainTrade(impact).map((line, i) => (
                <li key={i}>• {line}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
