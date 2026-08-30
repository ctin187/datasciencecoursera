import type { LeagueData } from '../../hooks/useLeagueData';
import type { SeasonSimulationState } from '../../hooks/useSeasonSimulation';
import type { TeamSimResult } from '../../lib/seasonSimulator';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { Mascot } from '../ui/Mascot';
import { ChampionshipMeter } from '../ui/ChampionshipMeter';

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function SeasonOutlookTab({ data, userId, sim }: { data: LeagueData; userId: string; sim: SeasonSimulationState }) {
  const myRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id : undefined;

  if (sim.loading) {
    return (
      <Card>
        <p className="terminal-cursor text-center font-scoreboard text-lg text-violet-400">SIMULATING SEASONS</p>
        <p className="mt-2 text-center text-xs text-slate-500">Fetching this season's matchup history and running the Monte Carlo simulation…</p>
      </Card>
    );
  }

  if (sim.error) {
    return (
      <Card className="border-rose-800">
        <p className="text-rose-300">{sim.error}</p>
      </Card>
    );
  }

  if (!sim.result) return null;

  const { result } = sim;

  if (result.status === 'insufficient-data') {
    return (
      <Card>
        <CardTitle>Season Outlook</CardTitle>
        <div className="flex items-start gap-3">
          <Mascot state="benched" size={48} className="shrink-0" />
          <p className="text-slate-400">
            No completed weeks with real scores yet, so there's no scoring history to simulate from. Check back once Week 1
            has been played — the model refuses to invent a projection-based simulation in the meantime.
          </p>
        </div>
      </Card>
    );
  }

  const myTeam = myRosterId ? result.teams.find((t) => t.rosterId === myRosterId) : undefined;
  const myRank = myTeam ? result.teams.findIndex((t) => t.rosterId === myRosterId) + 1 : undefined;

  const columns: Column<TeamSimResult>[] = [
    {
      key: 'teamName',
      header: 'Team',
      accessor: (t) => t.teamName,
      render: (t) => (
        <span className={t.rosterId === myRosterId ? 'font-semibold text-violet-300' : ''}>{t.teamName}</span>
      ),
    },
    {
      key: 'record',
      header: 'Record',
      accessor: (t) => t.actualWins,
      align: 'center',
      render: (t) => `${t.actualWins}-${t.actualLosses}${t.actualTies ? `-${t.actualTies}` : ''}`,
    },
    { key: 'pf', header: 'Points For', accessor: (t) => t.actualPointsFor, align: 'right', render: (t) => t.actualPointsFor.toFixed(1) },
    {
      key: 'games',
      header: 'Sample',
      accessor: (t) => t.gamesPlayed,
      align: 'right',
      render: (t) => <span className="text-slate-500">{t.gamesPlayed}gm</span>,
    },
    {
      key: 'meanScore',
      header: 'Modeled Wkly Score',
      accessor: (t) => t.meanWeeklyScore,
      align: 'right',
      render: (t) => `${t.meanWeeklyScore.toFixed(1)} ± ${t.stdevWeeklyScore.toFixed(1)}`,
    },
    ...(result.status === 'ready'
      ? [
          {
            key: 'avgWins',
            header: 'Proj. Final Wins',
            accessor: (t: TeamSimResult) => t.avgProjectedFinalWins,
            align: 'right' as const,
            render: (t: TeamSimResult) => t.avgProjectedFinalWins.toFixed(1),
          },
        ]
      : []),
    {
      key: 'playoff',
      header: 'Playoff Odds',
      accessor: (t) => t.playoffProbability,
      align: 'right',
      render: (t) => (
        <span className={t.playoffProbability >= 0.5 ? 'text-emerald-400' : 'text-slate-400'}>{pct(t.playoffProbability)}</span>
      ),
    },
    {
      key: 'championship',
      header: 'Championship Odds',
      accessor: (t) => t.championshipProbability,
      align: 'right',
      render: (t) => (
        <span className={t.championshipProbability >= 0.15 ? 'font-semibold text-amber-400' : 'text-slate-400'}>
          {pct(t.championshipProbability)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {result.status === 'season-complete' && (
        <div className="rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
          Season and playoffs are complete — these are the actual final results, not a simulation.
        </div>
      )}

      {myTeam && result.status === 'ready' && (
        <ChampionshipMeter probabilityPct={myTeam.championshipProbability * 100} simulations={result.simulations} caption={`YOUR CHAMPIONSHIP EQUITY — RANK #${myRank} OF ${result.teams.length}`} />
      )}

      {myTeam && (
        <Card>
          <CardTitle subtitle={result.status === 'ready' ? `Rank #${myRank} of ${result.teams.length} by championship odds` : undefined}>
            Your Season Outlook
          </CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Record" value={`${myTeam.actualWins}-${myTeam.actualLosses}${myTeam.actualTies ? `-${myTeam.actualTies}` : ''}`} />
            <StatTile label="Playoff Probability" value={pct(myTeam.playoffProbability)} />
            <StatTile label="Championship Probability" value={pct(myTeam.championshipProbability)} />
            <StatTile label="Reached Finals" value={pct(myTeam.finalsProbability)} />
          </div>
        </Card>
      )}

      <Card>
        <CardTitle
          subtitle={`Weeks played: ${result.weeksPlayed.join(', ') || '—'}. Playoffs start week ${result.playoffWeekStart}, top ${result.playoffTeams} teams qualify.`}
        >
          League Standings & {result.status === 'season-complete' ? 'Final Results' : 'Playoff / Championship Odds'}
        </CardTitle>
        <DataTable rows={result.teams} columns={columns} rowKey={(t) => String(t.rosterId)} defaultSortKey="championship" />
      </Card>

      <Card>
        <CardTitle>Methodology</CardTitle>
        <ul className="space-y-1.5 text-xs text-slate-400">
          {result.status === 'ready' && (
            <li>
              <Badge color="purple">{result.simulations.toLocaleString()} simulations</Badge>
            </li>
          )}
          {result.methodologyNotes.map((note, i) => (
            <li key={i}>• {note}</li>
          ))}
          <li>
            • Source: Sleeper API real matchup results for played weeks, published schedule for remaining weeks. These are
            model estimates, not guarantees — treat probabilities as relative signal, not precise forecasts.
          </li>
        </ul>
      </Card>
    </div>
  );
}
