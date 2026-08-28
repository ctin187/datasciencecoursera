import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { analyzeRoster, futureRosterProjection, gradeLeague, phaseDescription } from '../../lib/rosterAnalyzer';
import { retirementRisk } from '../../lib/agingCurves';
import { resolvePlayerValue } from '../../lib/playerValue';
import type { LetterGrade } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

const PHASE_COLOR = {
  'win-now': 'purple',
  contend: 'blue',
  rebuild: 'green',
  middle: 'yellow',
} as const;

const GRADE_COLOR: Record<LetterGrade, 'greenDark' | 'green' | 'yellow' | 'orange' | 'red'> = {
  A: 'greenDark',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  F: 'red',
};

interface RosterPlayerRow {
  playerId: string;
  name: string;
  position: Position;
  age: number | null;
  isStarter: boolean;
  consensusValue: number;
  tier: string;
  source: 'curated' | 'estimated' | 'none';
  currentProjection: number;
  threeYearOutlook: number;
  risk: 'low' | 'medium' | 'high';
}

export function RosterHealthTab({ data, derived, userId }: { data: LeagueData; derived: Derived; userId: string }) {
  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const rosterOptions = data.rosters.map((r) => ({
    id: r.roster_id,
    ownerId: r.owner_id,
    name: (r.owner_id && userById.get(r.owner_id)?.metadata?.team_name) || userById.get(r.owner_id ?? '')?.display_name || `Roster ${r.roster_id}`,
  }));
  const nameById = new Map(rosterOptions.map((r) => [r.id, r.name]));

  const defaultRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id : undefined;
  const [selectedId, setSelectedId] = useState<number | null>(defaultRosterId ?? rosterOptions[0]?.id ?? null);
  const [showCalc, setShowCalc] = useState(false);

  const grades = useMemo(
    () => gradeLeague(data.rosters, (id) => nameById.get(id) ?? `Roster ${id}`, data.players, derived.tradeValueMap, derived.threeDValues),
    [data.rosters, data.players, derived.tradeValueMap, derived.threeDValues, nameById],
  );
  const gradeByRoster = useMemo(() => new Map(grades.map((g) => [g.rosterId, g])), [grades]);
  const selectedGrade = selectedId !== null ? gradeByRoster.get(selectedId) : undefined;

  const roster = data.rosters.find((r) => r.roster_id === selectedId);
  const ownerName = rosterOptions.find((r) => r.id === selectedId)?.name ?? 'Unknown';

  const analysis = useMemo(() => {
    if (!roster) return null;
    return analyzeRoster(roster, ownerName, data.players, derived.tradeValueMap);
  }, [roster, ownerName, data.players, derived.tradeValueMap]);

  const futureProjections = useMemo(() => {
    if (!analysis) return [];
    return [1, 2, 3].map((yearsOut) => ({
      yearsOut,
      season: Number(data.league.season) + yearsOut,
      positions: futureRosterProjection(analysis.positionalAges, yearsOut),
    }));
  }, [analysis, data.league.season]);

  const rosterRows: RosterPlayerRow[] = useMemo(() => {
    if (!roster) return [];
    const starterSet = new Set(roster.starters ?? []);
    return (roster.players ?? [])
      .map((id) => {
        const p = data.players[id];
        if (!p) return null;
        const resolved = resolvePlayerValue(id, data.players, derived.tradeValueMap);
        const v = derived.threeDValues.get(id);
        const risk = p.age ? retirementRisk(p.position, p.age).risk : 'low';
        const row: RosterPlayerRow = {
          playerId: id,
          name: resolved.name,
          position: resolved.position,
          age: p.age,
          isStarter: starterSet.has(id),
          consensusValue: resolved.consensusValue,
          tier: resolved.tier,
          source: resolved.source,
          currentProjection: v ? Math.round(v.currentProjection) : 0,
          threeYearOutlook: v ? Math.round(v.threeYearOutlook) : 0,
          risk,
        };
        return row;
      })
      .filter((r): r is RosterPlayerRow => r !== null);
  }, [roster, data.players, derived.tradeValueMap, derived.threeDValues]);

  const rosterColumns: Column<RosterPlayerRow>[] = [
    { key: 'name', header: 'Player', accessor: (r) => r.name },
    { key: 'position', header: 'Pos', accessor: (r) => r.position, align: 'center' },
    { key: 'age', header: 'Age', accessor: (r) => r.age ?? 0, align: 'center', render: (r) => r.age ?? '—' },
    {
      key: 'isStarter',
      header: 'Role',
      accessor: (r) => (r.isStarter ? 1 : 0),
      align: 'center',
      render: (r) => <Badge color={r.isStarter ? 'green' : 'gray'}>{r.isStarter ? 'Starter' : 'Bench'}</Badge>,
    },
    { key: 'consensusValue', header: 'Trade Value', accessor: (r) => r.consensusValue, align: 'right' },
    {
      key: 'tier',
      header: 'Tier',
      accessor: (r) => r.tier,
      render: (r) => (
        <span title={r.source === 'estimated' ? "Estimated from Sleeper's own relevance ranking - not a curated consensus value." : undefined}>
          {r.tier}
        </span>
      ),
    },
    { key: 'currentProjection', header: 'Current Pts', accessor: (r) => r.currentProjection, align: 'right' },
    { key: 'threeYearOutlook', header: '3-yr Avg', accessor: (r) => r.threeYearOutlook, align: 'right' },
    {
      key: 'risk',
      header: 'Decline Risk',
      accessor: (r) => r.risk,
      align: 'center',
      render: (r) => (
        <Badge color={r.risk === 'high' ? 'red' : r.risk === 'medium' ? 'yellow' : 'gray'}>{r.risk.toUpperCase()}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Weighted 0-100 grade: contention phase 25%, age-curve alignment 20%, positional depth 25%, injury risk 15%, projected points vs. league avg 15%. Click a team to jump to its full breakdown below.">
          League Grades
        </CardTitle>
        <div className="space-y-1.5">
          {grades.map((g, i) => (
            <button
              key={g.rosterId}
              onClick={() => setSelectedId(g.rosterId)}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selectedId === g.rosterId ? 'border-violet-600 bg-violet-950/30' : 'border-slate-800 hover:bg-slate-800/40'
              }`}
            >
              <span className="w-5 text-slate-500">{i + 1}</span>
              <Badge color={GRADE_COLOR[g.letter]}>{g.letter}</Badge>
              <span className="flex-1 truncate font-medium text-slate-200">
                {g.ownerName}
                {data.rosters.find((r) => r.roster_id === g.rosterId)?.owner_id === userId && ' (you)'}
              </span>
              <span className="text-slate-500">{g.overall.toFixed(1)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Select a Team</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {rosterOptions.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                selectedId === r.id ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {r.name}
              {r.ownerId === userId && ' (you)'}
            </button>
          ))}
        </div>
      </Card>

      {analysis && selectedGrade && (
        <>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <CardTitle>Grade Breakdown</CardTitle>
              <div className="flex items-center gap-2">
                <Badge color={GRADE_COLOR[selectedGrade.letter]}>{selectedGrade.letter} ({selectedGrade.overall.toFixed(1)})</Badge>
                <button
                  onClick={() => setShowCalc((s) => !s)}
                  className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  {showCalc ? 'Hide calculation' : 'Show calculation'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatTile label="Contention (25%)" value={selectedGrade.contentionScore.toFixed(0)} />
              <StatTile label="Age Curve (20%)" value={selectedGrade.ageCurveScore.toFixed(0)} />
              <StatTile label="Depth (25%)" value={selectedGrade.depthScore.toFixed(0)} />
              <StatTile label="Injury Safety (15%)" value={selectedGrade.injuryRiskScore.toFixed(0)} />
              <StatTile label="Proj. Points (15%)" value={selectedGrade.projectedPointsScore.toFixed(0)} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile label="Win-Now Grade" value={selectedGrade.winNowGrade.toFixed(0)} hint="How likely to win THIS year" />
              <StatTile label="Rebuild Grade" value={selectedGrade.rebuildGrade.toFixed(0)} hint="How well-positioned for 2027-2029" />
              <StatTile label="Longevity Score" value={selectedGrade.longevityScore.toFixed(0)} hint="How long this roster can compete" />
            </div>
            {showCalc && (
              <div className="mt-4 space-y-1 rounded-md border border-slate-800 bg-slate-950/50 p-3 font-mono text-xs text-slate-400">
                {selectedGrade.breakdown.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Lifecycle Phase</CardTitle>
            <div className="mb-3 flex items-center gap-2">
              <Badge color={PHASE_COLOR[analysis.phase]}>{analysis.phase.toUpperCase()}</Badge>
              {analysis.phase === 'middle' && <Badge color="red">RISK: neither contender nor rebuilder</Badge>}
            </div>
            <p className="text-sm text-slate-300">{phaseDescription(analysis.phase)}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Avg Roster Age" value={analysis.avgAge || '—'} />
              <StatTile label="Elite Aging (28+)" value={analysis.eliteAgingCount} />
              <StatTile label="Young Assets (≤24)" value={analysis.youngAssetCount} />
              <StatTile label="Total Dynasty Value" value={analysis.totalValue} />
            </div>
          </Card>

          <Card>
            <CardTitle subtitle="Every rostered player, ranked by dynasty trade value.">Full Roster — Team Deep Dive</CardTitle>
            <DataTable rows={rosterRows} columns={rosterColumns} rowKey={(r) => r.playerId} defaultSortKey="consensusValue" />
          </Card>

          <Card>
            <CardTitle subtitle="Where this team's value actually sits — a bench-heavy team has less depth to trade from than it looks like on paper.">
              Starters vs. Bench Value
            </CardTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Starter Value" value={analysis.starterValue} />
              <StatTile label="Bench Value" value={analysis.benchValue} />
              <StatTile
                label="Bench Share"
                value={
                  analysis.starterValue + analysis.benchValue > 0
                    ? `${Math.round((analysis.benchValue / (analysis.starterValue + analysis.benchValue)) * 100)}%`
                    : '—'
                }
              />
              <StatTile label="Total Value" value={analysis.totalValue} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['QB', 'RB', 'WR', 'TE'] as Position[]).map((pos) => (
                <StatTile key={pos} label={`${pos} Value`} value={analysis.positionalValues[pos]} />
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle subtitle="Average age of rostered players at each position.">Roster Age Curve</CardTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(['QB', 'RB', 'WR', 'TE'] as Position[]).map((pos) => {
                const ages = analysis.positionalAges[pos];
                const avg = ages.length ? (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : '—';
                return <StatTile key={pos} label={pos} value={avg} hint={`${ages.length} rostered`} />;
              })}
            </div>
          </Card>

          <Card>
            <CardTitle subtitle="Players flagged medium/high risk of steep decline based on position-specific aging curves.">
              Retirement / Decline Risk Heatmap
            </CardTitle>
            {analysis.retirementRisk.length === 0 && (
              <p className="text-sm text-slate-500">No elevated decline risk detected on this roster.</p>
            )}
            <div className="space-y-1.5">
              {analysis.retirementRisk.map((r) => {
                const p = data.players[r.playerId];
                if (!p) return null;
                return (
                  <div key={r.playerId} className="flex items-center justify-between rounded-md border border-slate-800 px-3 py-2 text-sm">
                    <span>
                      {p.full_name || `${p.first_name} ${p.last_name}`}{' '}
                      <span className="text-slate-500">· {p.position} · {p.age}y</span>
                    </span>
                    <Badge color={r.risk === 'high' ? 'red' : 'yellow'}>{r.risk.toUpperCase()}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardTitle subtitle="How many currently-rostered skill players project to still be startable (not high decline risk) in future rookie-draft seasons.">
              Future-Proof Analysis
            </CardTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {futureProjections.map((fp) => (
                <div key={fp.yearsOut} className="rounded-lg border border-slate-800 p-3">
                  <p className="mb-2 text-sm font-semibold text-slate-200">{fp.season} Draft Prep</p>
                  <div className="space-y-1 text-sm">
                    {fp.positions.map((p) => (
                      <div key={p.position} className="flex justify-between text-slate-400">
                        <span>{p.position}</span>
                        <span className="text-slate-200">{p.startableCount} startable</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
