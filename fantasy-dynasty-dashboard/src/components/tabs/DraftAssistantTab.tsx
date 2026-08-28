import { useMemo, useState } from 'react';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { adpValueRank, classifySleeperReach } from '../../lib/valueCalculator';
import { buildTiers, positionalScarcity, tierBreakpointInfo } from '../../lib/draftAssistant';
import { peakAgeRange } from '../../lib/agingCurves';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

interface DraftRow {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  consensusAdp: number;
  fantasyProsEcr: number;
  sleeperAdp: number;
  valueRank: number;
  status: 'SLEEPER' | 'REACH' | 'FAIR';
  blendedValue: number;
  tier: string;
  isTierBreakpoint: boolean;
}

const POSITIONS: (Position | 'ALL')[] = ['ALL', 'QB', 'RB', 'WR', 'TE'];

export function DraftAssistantTab({ derived }: { derived: Derived }) {
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');
  const { consensusAdp, threeDValues } = derived;

  const { valueRank, adpRank } = useMemo(() => adpValueRank(consensusAdp, threeDValues), [consensusAdp, threeDValues]);
  const tiersAll = useMemo(() => buildTiers(consensusAdp, threeDValues, 'ALL'), [consensusAdp, threeDValues]);
  const scarcity = useMemo(
    () => positionalScarcity(consensusAdp, threeDValues, new Set()),
    [consensusAdp, threeDValues],
  );

  const rows: DraftRow[] = useMemo(
    () =>
      consensusAdp.map((p) => {
        const v = threeDValues.get(p.playerId);
        const aRank = adpRank.get(p.playerId) ?? 0;
        const vRank = valueRank.get(p.playerId) ?? 0;
        const breakpoint = tierBreakpointInfo(tiersAll, p.playerId);
        const tierEntry = derived.tradeValueMap.get(p.playerId);
        return {
          playerId: p.playerId,
          name: p.name,
          position: p.position,
          team: p.team,
          age: p.age,
          consensusAdp: p.consensusAdp,
          fantasyProsEcr: p.fantasyProsEcr,
          sleeperAdp: p.sleeperAdp,
          valueRank: vRank,
          status: classifySleeperReach(aRank, vRank),
          blendedValue: v?.blendedValue ?? 0,
          tier: tierEntry?.tier ?? breakpoint?.tier.tier ?? '—',
          isTierBreakpoint: breakpoint?.isLastInTier ?? false,
        };
      }),
    [consensusAdp, threeDValues, adpRank, valueRank, tiersAll, derived.tradeValueMap],
  );

  const filteredRows = posFilter === 'ALL' ? rows : rows.filter((r) => r.position === posFilter);

  const columns: Column<DraftRow>[] = [
    {
      key: 'name',
      header: 'Player',
      accessor: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{r.name}</span>
          {r.isTierBreakpoint && <Badge color="yellow">last in tier</Badge>}
        </div>
      ),
    },
    { key: 'position', header: 'Pos', accessor: (r) => r.position, align: 'center' },
    { key: 'team', header: 'Team', accessor: (r) => r.team ?? 'FA', align: 'center' },
    { key: 'age', header: 'Age', accessor: (r) => r.age ?? 0, align: 'center' },
    { key: 'consensusAdp', header: 'Consensus ADP', accessor: (r) => r.consensusAdp, align: 'right', render: (r) => r.consensusAdp.toFixed(1) },
    { key: 'fantasyProsEcr', header: 'FP ECR', accessor: (r) => r.fantasyProsEcr, align: 'right' },
    { key: 'sleeperAdp', header: 'Sleeper ADP', accessor: (r) => r.sleeperAdp, align: 'right' },
    { key: 'valueRank', header: '3D Value Rank', accessor: (r) => r.valueRank, align: 'right' },
    { key: 'tier', header: 'Tier', accessor: (r) => r.tier, align: 'left' },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.status,
      align: 'center',
      render: (r) => (
        <Badge color={r.status === 'SLEEPER' ? 'green' : r.status === 'REACH' ? 'red' : 'gray'}>{r.status}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Positive 3D-value ranks better than ADP => sleeper. Worse => reach.">
          Startup Draft Board — ADP vs. 3D Value
        </CardTitle>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => (
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
        <DataTable
          rows={filteredRows}
          columns={columns}
          rowKey={(r) => r.playerId}
          defaultSortKey="consensusAdp"
          defaultSortDir="asc"
        />
      </Card>

      <Card>
        <CardTitle subtitle="Startable-tier (top 3 tiers) player counts remaining by position, based on 3D value tiers.">
          Positional Scarcity
        </CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {scarcity.map((s) => (
            <StatTile
              key={s.position}
              label={s.position}
              value={`${s.totalStartQualityRemaining} left`}
              hint={s.recommendation}
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle subtitle="Peak age window per position, used to weight the 3D-value multi-year outlook.">
          Age-Based Recommendations
        </CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['QB', 'RB', 'WR', 'TE'] as Position[]).map((pos) => {
            const { start, end } = peakAgeRange(pos);
            return <StatTile key={pos} label={pos} value={`Peak ${start}-${end}`} />;
          })}
        </div>
      </Card>
    </div>
  );
}
