import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { analyzeRoster, futureRosterProjection, phaseDescription } from '../../lib/rosterAnalyzer';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;

const PHASE_COLOR = {
  'win-now': 'purple',
  contend: 'blue',
  rebuild: 'green',
  middle: 'yellow',
} as const;

export function RosterHealthTab({ data, derived, userId }: { data: LeagueData; derived: Derived; userId: string }) {
  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const rosterOptions = data.rosters.map((r) => ({
    id: r.roster_id,
    ownerId: r.owner_id,
    name: (r.owner_id && userById.get(r.owner_id)?.metadata?.team_name) || userById.get(r.owner_id ?? '')?.display_name || `Roster ${r.roster_id}`,
  }));

  const defaultRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id : undefined;
  const [selectedId, setSelectedId] = useState<number | null>(defaultRosterId ?? rosterOptions[0]?.id ?? null);

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

  return (
    <div className="space-y-6">
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

      {analysis && (
        <>
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
