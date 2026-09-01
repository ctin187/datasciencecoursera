import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { RosterHealthState } from '../../hooks/useRosterHealth';
import type { WaiverTargetsState } from '../../hooks/useWaiverTargets';
import type { SeasonSimulationState } from '../../hooks/useSeasonSimulation';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import type { ProjectionPoolState } from '../../hooks/useProjectionPool';
import { computeEdgeSignals, type EdgeSignal } from '../../lib/edgeEngine';
import { buildActionCenter } from '../../lib/actionCenter';
import { Card, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ChampionshipMeter } from '../ui/ChampionshipMeter';
import { SeasonNotice } from '../ui/SeasonNotice';

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

  const myTeam = myRosterId != null && rosterHealth.result ? rosterHealth.result.teams.find((t) => t.roster_id === myRosterId) ?? null : null;
  const bestWaiverTarget = waiverTargets.result?.targets[0] ?? null;
  const actionItems = useMemo(
    () => buildActionCenter({ edgeSignals: signals, myTeam, bestWaiverTarget }),
    [signals, myTeam, bestWaiverTarget],
  );

  if (!userId) {
    return (
      <Card>
        <CardTitle>Edge Engine</CardTitle>
        <p className="text-slate-400">Select your team from the dropdown above to see where you have an edge.</p>
      </Card>
    );
  }

  const myTeamSim = myRosterId != null && seasonSim.result?.status === 'ready'
    ? seasonSim.result.teams.find((t) => t.rosterId === myRosterId)
    : undefined;

  return (
    <div className="space-y-3">
      {/* Several signals here compare VOR, so they inherit whatever season the
          projection backend is serving. Say which one that is. */}
      <SeasonNotice status={rosterHealth.result?.season_status} />
      {myTeamSim && (
        <ChampionshipMeter probabilityPct={myTeamSim.championshipProbability * 100} simulations={seasonSim.result!.simulations} />
      )}

      {actionItems.length > 0 && (
        <Card>
          <CardTitle subtitle="Rules-based synthesis of the numbers this app already computed elsewhere - not a language model call, so it cannot invent a figure that isn't already backed by real data.">
            Action Center
          </CardTitle>
          <div className="panel-body">
            <ol className="space-y-1.5">
              {actionItems.map((item, i) => (
                <li key={i} className="signal-enter flex items-start gap-2 text-sm text-slate-200">
                  <Badge color={item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'orange' : 'gray'}>{item.category}</Badge>
                  <span>{item.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle subtitle="Every number here is a comparison between two values already computed elsewhere in this app (Season Outlook, Roster Value, Draft Assistant, Waiver Wire) - nothing new is invented. A signal that can't be backed by real data says so instead of showing a number.">
          Where You Have an Edge
        </CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {signals.map((s) => (
            <div key={s.key} className={`border p-3 ${STATUS_STYLE[s.status]}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold tracking-wide text-slate-300 uppercase">{s.label}</span>
                <span className={`num text-lg leading-none ${STATUS_TEXT[s.status]}`}>{s.valueText}</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{s.detail}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
