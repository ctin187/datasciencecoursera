import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import {
  benchPlayerIds,
  estimateSnapTrend,
  faabSpentByRoster,
  priorityScore,
  rosteredPlayerIds,
  suggestDropCandidates,
  suggestFaabBid,
} from '../../lib/waiverOptimizer';
import { computeStrengthsWeaknesses, type Severity } from '../../lib/rosterHealthHub';
import { resolvePlayerValue } from '../../lib/playerValue';
import { detectLeagueFormat } from '../../lib/leagueFormat';
import type { DropCandidate } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

const SCORABLE_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

const SEVERITY_COLOR: Record<Severity, 'green' | 'yellow' | 'orange' | 'red'> = {
  STRENGTH: 'green',
  LOW: 'yellow',
  MEDIUM: 'orange',
  CRITICAL: 'red',
};

const FAAB_TIPS = [
  "Keep 20-25% of your budget in reserve past midseason for injury-driven pickups — that's when the best real difference-makers hit waivers.",
  'A RISING usage trend is worth paying up for before it shows up in box scores everyone sees; a FALLING trend on a rostered player is a sell/drop signal even if the name is still recognizable.',
  "Don't spend big FAAB on a bye-week or injury-replacement rental — reserve premium bids for players who solve a CRITICAL need long-term.",
  'In a shallow league, prioritize the best player available over need; in a deep league, need should usually win close calls since replacement-level talent is scarcer.',
];

interface WaiverRow {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  consensusValue: number;
  currentProjection: number;
  tier: string;
  snapTrendLabel: string;
  targetTrendLabel: string;
  trend: string;
  opportunityScore: number;
  rankScore: number;
  suggestedBid: number;
  priority: string;
  reason: string;
  dropCandidates: DropCandidate[];
}

export function WaiversTab({ data, derived, userId }: { data: LeagueData; derived: Derived; userId: string }) {
  const format = useMemo(() => detectLeagueFormat(data.league.roster_positions), [data.league.roster_positions]);
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');
  const [showFullBoard, setShowFullBoard] = useState(false);
  const startingBudget = data.league.settings.waiver_budget ?? 100;

  const rostered = useMemo(() => rosteredPlayerIds(data.rosters), [data.rosters]);
  const spentByRoster = useMemo(() => faabSpentByRoster(data.rosters), [data.rosters]);

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;
  const myBench = useMemo(() => (myRoster ? benchPlayerIds(myRoster) : []), [myRoster]);

  const benchCountByPosition = useMemo(() => {
    const counts: Partial<Record<Position, number>> = {};
    for (const id of myBench) {
      const pos = data.players[id]?.position as Position | undefined;
      if (!pos) continue;
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
    return counts;
  }, [myBench, data.players]);

  const freeAgents = useMemo(() => {
    return Object.values(data.players).filter((p) => {
      if (rostered.has(p.player_id)) return false;
      if (!format.activePositions.includes(p.position as Position)) return false;
      if (p.status !== 'Active') return false;
      return !!p.team;
    });
  }, [data.players, rostered, format.activePositions]);

  const rows: WaiverRow[] = useMemo(() => {
    return freeAgents
      .map((p) => {
        const trend = estimateSnapTrend(p);
        const resolved = resolvePlayerValue(p.player_id, data.players, derived.tradeValueMap);
        const suggestion = suggestFaabBid(p, trend, resolved, { startingBudget, spentByRoster });
        const dropCandidates = myRoster
          ? suggestDropCandidates(
              myBench,
              data.players,
              derived.tradeValueMap,
              p.position as Position,
              data.league.roster_positions,
              resolved.consensusValue,
              1,
            )
          : [];
        return {
          playerId: p.player_id,
          name: p.full_name || `${p.first_name} ${p.last_name}`,
          position: p.position as Position,
          team: p.team,
          age: p.age,
          consensusValue: resolved.consensusValue,
          currentProjection: Math.round(derived.threeDValues.get(p.player_id)?.currentProjection ?? 0),
          tier: resolved.tier,
          snapTrendLabel: `${(trend.earlySnapShare * 100).toFixed(0)}% → ${(trend.recentSnapShare * 100).toFixed(0)}%`,
          targetTrendLabel: `${(trend.earlyTargetShare * 100).toFixed(0)}% → ${(trend.recentTargetShare * 100).toFixed(0)}%`,
          trend: trend.trend,
          opportunityScore: trend.opportunityScore,
          rankScore: priorityScore(trend, resolved.consensusValue),
          suggestedBid: suggestion.suggestedBid,
          priority: suggestion.priority,
          reason: suggestion.reason,
          dropCandidates,
        };
      })
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 150);
  }, [freeAgents, derived.tradeValueMap, derived.threeDValues, startingBudget, spentByRoster, myRoster, myBench, data.players, data.league.roster_positions]);

  const scorablePositions = SCORABLE_POSITIONS.filter((p) => format.activePositions.includes(p));
  const needs = useMemo(() => {
    if (!myRoster) return [];
    return computeStrengthsWeaknesses(myRoster, data.players, derived.tradeValueMap, derived.threeDValues, rostered, scorablePositions)
      .filter((n) => n.severity !== 'STRENGTH')
      .sort((a, b) => a.gap - b.gap);
  }, [myRoster, data.players, derived.tradeValueMap, derived.threeDValues, rostered, scorablePositions]);

  const rowsByPosition = useMemo(() => {
    const map = new Map<Position, WaiverRow[]>();
    for (const r of rows) {
      const list = map.get(r.position) ?? [];
      list.push(r);
      map.set(r.position, list);
    }
    return map;
  }, [rows]);

  const filteredRows = posFilter === 'ALL' ? rows : rows.filter((r) => r.position === posFilter);

  const columns: Column<WaiverRow>[] = [
    { key: 'name', header: 'Player', accessor: (r) => r.name },
    { key: 'position', header: 'Pos', accessor: (r) => r.position, align: 'center' },
    { key: 'team', header: 'Team', accessor: (r) => r.team ?? '—', align: 'center' },
    {
      key: 'consensusValue',
      header: 'Value',
      accessor: (r) => r.consensusValue,
      align: 'right',
      render: (r) => (
        <span title={r.tier}>{r.consensusValue > 0 ? r.consensusValue : <span className="text-slate-600">none</span>}</span>
      ),
    },
    { key: 'snapTrendLabel', header: 'Sim. Snap Trend', accessor: (r) => r.snapTrendLabel, sortable: false },
    { key: 'targetTrendLabel', header: 'Sim. Target Trend', accessor: (r) => r.targetTrendLabel, sortable: false },
    {
      key: 'trend',
      header: 'Trend',
      accessor: (r) => r.trend,
      align: 'center',
      render: (r) => <Badge color={r.trend === 'RISING' ? 'green' : r.trend === 'FALLING' ? 'red' : 'gray'}>{r.trend}</Badge>,
    },
    { key: 'rankScore', header: 'Rank Score', accessor: (r) => Math.round(r.rankScore), align: 'right' },
    { key: 'suggestedBid', header: 'Suggested FAAB', accessor: (r) => r.suggestedBid, align: 'right', render: (r) => `$${r.suggestedBid}` },
    {
      key: 'priority',
      header: 'Priority',
      accessor: (r) => r.priority,
      align: 'center',
      render: (r) => (
        <Badge color={r.priority === 'HIGH PRIORITY' ? 'green' : r.priority === 'MEDIUM' ? 'yellow' : r.priority === 'LOW' ? 'blue' : 'gray'}>
          {r.priority}
        </Badge>
      ),
    },
    {
      key: 'dropCandidate',
      header: 'Suggested Drop',
      accessor: (r) => r.dropCandidates[0]?.name ?? '',
      sortable: false,
      render: (r) => {
        if (!userId) return <span className="text-slate-600">select your team</span>;
        const top = r.dropCandidates[0];
        if (!top) return <span className="text-slate-600">no matching bench spot</span>;
        return (
          <span title={top.reason} className="cursor-help text-amber-300">
            {top.name} <span className="text-slate-500">({top.position})</span>
          </span>
        );
      },
    },
  ];

  const totalBudgetRemaining = Array.from(spentByRoster.values()).reduce((s, spent) => s + (startingBudget - spent), 0);
  const avgRemaining = data.rosters.length ? Math.round(totalBudgetRemaining / data.rosters.length) : 0;

  console.debug('[WaiversTab] render', { needCount: needs.length, freeAgentCount: rows.length, hasMyRoster: !!myRoster });

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
        <span className="font-semibold">Snap/target share trends here are simulated, not real.</span> Sleeper's free
        API doesn't expose live usage stats, so the "Sim. Snap/Target Trend" and "Trend" columns are a stand-in
        signal, not actual game data — don't treat a "RISING" badge as real preseason or in-season performance.
        The <b>Value</b> and <b>Rank Score</b> columns (dynasty consensus + estimate) carry the majority weight in
        ranking and priority specifically so a fabricated trend number can never rank a total unknown above a
        real, valuable player — but always sanity-check any pickup against actual news before adding.
      </div>

      <Card>
        <CardTitle subtitle="FAAB budget across the league.">FAAB Budget Snapshot</CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Starting Budget" value={`$${startingBudget}`} />
          <StatTile label="Avg Remaining" value={`$${avgRemaining}`} />
          <StatTile label="Teams" value={data.rosters.length} />
          <StatTile label="Free Agents Ranked" value={rows.length} />
        </div>
      </Card>

      {!myRoster && (
        <Card>
          <CardTitle subtitle="Pick your team from the dropdown in the header above to see the board organized around your actual roster needs, with personalized drop suggestions.">
            Select Your Team for Personalized Needs
          </CardTitle>
        </Card>
      )}

      {myRoster && (
        <Card>
          <CardTitle subtitle="Ranked by severity — CRITICAL ≥50pt gap vs. best available, MEDIUM 20-50, LOW <20. Each need shows your top ranked targets at that position.">
            Your Roster Needs
          </CardTitle>
          {needs.length === 0 && <p className="text-sm text-slate-500">No positional weaknesses detected — nothing urgent on waivers right now.</p>}
          <div className="space-y-4">
            {needs.map((need) => {
              const targets = (rowsByPosition.get(need.position) ?? []).slice(0, 5);
              return (
                <div key={need.position} className="rounded-lg border border-slate-800 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge color={SEVERITY_COLOR[need.severity]}>{need.severity}</Badge>
                    <span className="font-semibold text-slate-200">{need.position}</span>
                    <span className="text-xs text-slate-500">
                      {need.yourPlayerName ?? 'no starter rostered'} projects {need.yourProjection} pts vs. best available {need.replacementProjection} pts
                      ({need.gap} pt gap)
                    </span>
                  </div>
                  {targets.length === 0 && <p className="text-sm text-slate-500">No free agents found at this position.</p>}
                  <div className="space-y-1.5">
                    {targets.map((t) => {
                      const drop = t.dropCandidates[0];
                      const dropBenchCount = drop ? benchCountByPosition[drop.position] ?? 0 : 0;
                      const confidence = Math.max(
                        0,
                        Math.min(100, 55 + (t.consensusValue > 0 ? 25 : 0) + (t.trend === 'RISING' ? 10 : t.trend === 'FALLING' ? -15 : 0)),
                      );
                      return (
                        <div key={t.playerId} className="rounded-md bg-slate-950/40 p-2.5 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-100">
                              {t.name} <span className="text-slate-500">({t.team ?? 'FA'})</span>
                            </span>
                            <span className="flex items-center gap-2">
                              <Badge color={t.priority === 'HIGH PRIORITY' ? 'green' : t.priority === 'MEDIUM' ? 'yellow' : 'gray'}>{t.priority}</Badge>
                              <Badge color={confidence >= 70 ? 'green' : confidence >= 50 ? 'yellow' : 'red'}>{confidence}% conf.</Badge>
                            </span>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
                            <span>Proj: {t.currentProjection} pts vs. {need.yourProjection} pts now</span>
                            <span>Cost: ${t.suggestedBid} FAAB</span>
                            <span>
                              Why available: {t.trend === 'RISING' ? 'usage trending up, not yet widely rostered' : t.trend === 'FALLING' ? 'usage trending down' : 'stable role, off the radar'}
                            </span>
                            <span>
                              Drop: {drop ? `${drop.name} (${drop.position})` : 'no clear cut'}
                            </span>
                          </div>
                          {drop && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Cascade: after this move you'd have {Math.max(0, dropBenchCount - 1)} bench player(s) left at {drop.position}
                              {dropBenchCount - 1 <= 0 ? ' — you would be thin there.' : '.'}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle subtitle="General waiver-budget strategy — principles, not player-specific data.">FAAB Strategy Tips</CardTitle>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-300">
          {FAAB_TIPS.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle
            subtitle={
              userId
                ? "Full board, all free agents. \"Suggested Drop\" is the weakest matching bench player on your roster whose value doesn't clearly exceed this pickup's."
                : 'Select your team above for personalized "who to drop" suggestions alongside each pickup.'
            }
          >
            Browse All Free Agents
          </CardTitle>
          <button
            onClick={() => setShowFullBoard((s) => !s)}
            className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700"
          >
            {showFullBoard ? 'Hide' : 'Show'}
          </button>
        </div>
        {showFullBoard && (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(['ALL', ...format.activePositions] as (Position | 'ALL')[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPosFilter(p)}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    posFilter === p ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <DataTable rows={filteredRows} columns={columns} rowKey={(r) => r.playerId} defaultSortKey="rankScore" />
          </>
        )}
      </Card>
    </div>
  );
}
