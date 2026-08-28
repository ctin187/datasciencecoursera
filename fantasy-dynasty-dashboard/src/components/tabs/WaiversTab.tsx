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
import { resolvePlayerValue } from '../../lib/playerValue';
import type { DropCandidate } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

interface WaiverRow {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  consensusValue: number;
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
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');
  const startingBudget = data.league.settings.waiver_budget ?? 100;

  const rostered = useMemo(() => rosteredPlayerIds(data.rosters), [data.rosters]);
  const spentByRoster = useMemo(() => faabSpentByRoster(data.rosters), [data.rosters]);

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;
  const myBench = useMemo(() => (myRoster ? benchPlayerIds(myRoster) : []), [myRoster]);

  const freeAgents = useMemo(() => {
    return Object.values(data.players).filter((p) => {
      if (rostered.has(p.player_id)) return false;
      if (!['QB', 'RB', 'WR', 'TE'].includes(p.position)) return false;
      if (p.status !== 'Active') return false;
      // Cap the pool: only players with a known team and reasonable depth chart slot are worth surfacing.
      return !!p.team;
    });
  }, [data.players, rostered]);

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
  }, [freeAgents, derived.tradeValueMap, startingBudget, spentByRoster, myRoster, myBench, data.players, data.league.roster_positions]);

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
        if (!userId) return <span className="text-slate-600">enter User ID</span>;
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
        <CardTitle subtitle="FAAB budget across the league.">
          FAAB Budget Snapshot
        </CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Starting Budget" value={`$${startingBudget}`} />
          <StatTile label="Avg Remaining" value={`$${avgRemaining}`} />
          <StatTile label="Teams" value={data.rosters.length} />
          <StatTile label="Free Agents Ranked" value={rows.length} />
        </div>
      </Card>

      <Card>
        <CardTitle
          subtitle={
            userId
              ? "\"Suggested Drop\" is the weakest matching bench player on your roster whose value doesn't clearly exceed this pickup's — same position, or FLEX-eligible positions if your league has a FLEX spot. Hover a suggestion for why."
              : 'Enter your Sleeper User ID above and reload to get personalized "who to drop" suggestions alongside each pickup.'
          }
        >
          Waiver Wire Optimizer
        </CardTitle>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(['ALL', 'QB', 'RB', 'WR', 'TE'] as const).map((p) => (
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
      </Card>
    </div>
  );
}
