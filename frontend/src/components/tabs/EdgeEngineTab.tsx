import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { RosterHealthState } from '../../hooks/useRosterHealth';
import type { WaiverTargetsState } from '../../hooks/useWaiverTargets';
import type { SeasonSimulationState } from '../../hooks/useSeasonSimulation';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import type { ProjectionPoolState } from '../../hooks/useProjectionPool';
import { computeEdgeSignals, type EdgeSignal } from '../../lib/edgeEngine';
import { Card, CardTitle } from '../ui/Card';

const STATUS_STYLE: Record<EdgeSignal['status'], string> = {
  edge: 'border-emerald-700/60 bg-emerald-950/20',
  deficit: 'border-rose-700/60 bg-rose-950/20',
  neutral: 'border-slate-700 bg-slate-900/40',
  'insufficient-evidence': 'border-slate-800 bg-slate-950/30',
};

const STATUS_TEXT: Record<EdgeSignal['status'], string> = {
  edge: 'text-emerald-400',
  deficit: 'text-rose-400',
  neutral: 'text-slate-300',
  'insufficient-evidence': 'text-slate-600',
};

export function EdgeEngineTab({
  data,
  userId,
  rosterHealth,
  waiverTargets,
  seasonSim,
  draftPicks,
  pool,
}: {
  data: LeagueData;
  userId: string;
  rosterHealth: RosterHealthState;
  waiverTargets: WaiverTargetsState;
  seasonSim: SeasonSimulationState;
  draftPicks: DraftPicksState;
  pool: ProjectionPoolState;
}) {
  const myRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id ?? null : null;
  const draft = data.drafts.find((d) => d.league_id === data.league.league_id) ?? data.drafts[0];

  const signals = useMemo(
    () =>
      computeEdgeSignals({
        myRosterId,
        totalTeams: data.league.total_rosters,
        playoffTeams: data.league.settings.playoff_teams ?? null,
        seasonSim: seasonSim.result,
        rosterHealth: rosterHealth.result,
        waiverTargets: waiverTargets.result,
        draft,
        draftPicks: draftPicks.picks,
        pool: pool.bySleeperId,
      }),
    [myRosterId, data.league, seasonSim.result, rosterHealth.result, waiverTargets.result, draft, draftPicks.picks, pool.bySleeperId],
  );

  if (!userId) {
    return (
      <Card>
        <CardTitle>Edge Engine</CardTitle>
        <p className="text-slate-400">Select your team from the dropdown above to see where you have an edge.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle="Every number here is a comparison between two values already computed elsewhere in this app (Season Outlook, Roster Value, Draft Assistant, Waiver Wire) - nothing new is invented. A signal that can't be backed by real data says so instead of showing a number.">
          Where You Have an Edge
        </CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {signals.map((s) => (
            <div key={s.key} className={`rounded-lg border p-3 ${STATUS_STYLE[s.status]}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">{s.label}</span>
                <span className={`text-lg font-bold ${STATUS_TEXT[s.status]}`}>{s.valueText}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{s.detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
