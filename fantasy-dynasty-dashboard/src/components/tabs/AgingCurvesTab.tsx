import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { ageMultiplier, AGING_CURVES } from '../../lib/agingCurves';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

const POSITION_COLORS: Record<Position, string> = {
  QB: '#38bdf8',
  RB: '#f97316',
  WR: '#a78bfa',
  TE: '#34d399',
  K: '#64748b',
  DEF: '#64748b',
};

function buildCurveData() {
  const ages = Array.from({ length: 40 - 20 + 1 }, (_, i) => 20 + i);
  return ages.map((age) => {
    const row: Record<string, number> = { age };
    (['QB', 'RB', 'WR', 'TE'] as Position[]).forEach((pos) => {
      row[pos] = Math.round(ageMultiplier(pos, age) * 100);
    });
    return row;
  });
}

interface SellHighRow {
  playerId: string;
  name: string;
  position: Position;
  age: number;
  consensusValue: number;
  runwayYears: number;
}

export function AgingCurvesTab({ derived }: { derived: Derived }) {
  const curveData = useMemo(buildCurveData, []);
  const [lookupQuery, setLookupQuery] = useState('');

  const matches = useMemo(() => {
    if (!lookupQuery.trim()) return [];
    const q = lookupQuery.toLowerCase();
    return derived.tradeValues.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [lookupQuery, derived.tradeValues]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? derived.tradeValueMap.get(selectedId) : null;
  const selectedValue = selectedId ? derived.threeDValues.get(selectedId) : null;

  const sellHighCandidates: SellHighRow[] = useMemo(() => {
    return derived.tradeValues
      .filter((p) => {
        const curve = AGING_CURVES[p.position];
        return p.age !== null && p.age >= curve.peakEnd - 1 && p.consensusValue >= 3000;
      })
      .map((p) => {
        const curve = AGING_CURVES[p.position];
        const runwayYears = Math.max(0, curve.cliffAge - (p.age ?? curve.cliffAge));
        return {
          playerId: p.playerId,
          name: p.name,
          position: p.position,
          age: p.age ?? 0,
          consensusValue: p.consensusValue,
          runwayYears,
        };
      })
      .sort((a, b) => b.consensusValue - a.consensusValue)
      .slice(0, 30);
  }, [derived.tradeValues]);

  const sellHighColumns: Column<SellHighRow>[] = [
    { key: 'name', header: 'Player', accessor: (r) => r.name },
    { key: 'position', header: 'Pos', accessor: (r) => r.position, align: 'center' },
    { key: 'age', header: 'Age', accessor: (r) => r.age, align: 'center' },
    { key: 'consensusValue', header: 'Trade Value', accessor: (r) => r.consensusValue, align: 'right' },
    {
      key: 'runwayYears',
      header: 'Runway to Cliff',
      accessor: (r) => r.runwayYears,
      align: 'right',
      render: (r) => (
        <Badge color={r.runwayYears <= 1 ? 'red' : r.runwayYears <= 2 ? 'yellow' : 'gray'}>
          {r.runwayYears} yr{r.runwayYears === 1 ? '' : 's'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Multiplier relative to peak performance (100 = peak) by position and age.">
          Position-Specific Aging Curves
        </CardTitle>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curveData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="age" stroke="#64748b" fontSize={12} label={{ value: 'Age', position: 'insideBottom', offset: -2, fill: '#64748b', fontSize: 12 }} />
              <YAxis stroke="#64748b" fontSize={12} domain={[0, 105]} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {(['QB', 'RB', 'WR', 'TE'] as Position[]).map((pos) => (
                <Line key={pos} type="monotone" dataKey={pos} stroke={POSITION_COLORS[pos]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <CardTitle>Player Lookup — Multi-Year Outlook</CardTitle>
        <div className="relative mb-4 max-w-sm">
          <input
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value)}
            placeholder="Search a player..."
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none ring-violet-500/50 focus:ring-2"
          />
          {matches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 shadow-lg">
              {matches.map((m) => (
                <button
                  key={m.playerId}
                  onClick={() => {
                    setSelectedId(m.playerId);
                    setLookupQuery('');
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-800"
                >
                  {m.name} <span className="text-slate-500">· {m.position} · age {m.age}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && selectedValue && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-lg font-semibold">{selected.name}</span>
              <Badge color="purple">{selected.position}</Badge>
              <Badge color="gray">Age {selected.age}</Badge>
              <Badge color="blue">{selected.tier}</Badge>
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedValue.multiYear} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
                  <Line type="monotone" dataKey="projectedPoints" name="Projected Pts" stroke="#c084fc" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {!selected && <p className="text-sm text-slate-500">Search for a player to see their projected output through 2035.</p>}
      </Card>

      <Card>
        <CardTitle subtitle="Players at or near peak-end with real trade value — a good window to sell before the decline cliff.">
          Sell-High Candidates
        </CardTitle>
        <DataTable rows={sellHighCandidates} columns={sellHighColumns} rowKey={(r) => r.playerId} defaultSortKey="consensusValue" />
      </Card>
    </div>
  );
}
