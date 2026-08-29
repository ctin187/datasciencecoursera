import { useMemo } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { gradeLeague } from '../../lib/rosterAnalyzer';
import { computeStrengthsWeaknesses, computeImprovementPaths, computeDraftCapital, type Severity } from '../../lib/rosterHealthHub';
import { rosteredPlayerIds, faabSpentByRoster } from '../../lib/waiverOptimizer';
import { detectLeagueFormat } from '../../lib/leagueFormat';
import type { LetterGrade } from '../../types';

type Derived = NonNullable<ReturnType<typeof useDerivedData>>;
type TabId = 'home' | 'draft' | 'trade' | 'waivers' | 'lineup' | 'roster' | 'aging' | 'league';

const GRADE_COLOR: Record<LetterGrade, 'greenDark' | 'green' | 'yellow' | 'orange' | 'red'> = {
  A: 'greenDark',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  F: 'red',
};

const SEVERITY_COLOR: Record<Severity, 'green' | 'yellow' | 'orange' | 'red'> = {
  STRENGTH: 'green',
  LOW: 'yellow',
  MEDIUM: 'orange',
  CRITICAL: 'red',
};

function qualitativeLabel(score: number): string {
  if (score >= 75) return 'Strong';
  if (score >= 50) return 'Average';
  if (score >= 30) return 'Below Average';
  return 'Weak';
}

const SCORABLE_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

export function HomeTab({
  data,
  derived,
  userId,
  setTab,
}: {
  data: LeagueData;
  derived: Derived;
  userId: string;
  setTab: (t: TabId) => void;
}) {
  const format = useMemo(() => detectLeagueFormat(data.league.roster_positions), [data.league.roster_positions]);

  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const ownerNameFor = (rosterId: number) => {
    const roster = data.rosters.find((r) => r.roster_id === rosterId);
    const owner = roster?.owner_id ? userById.get(roster.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${rosterId}`;
  };

  const grades = useMemo(
    () =>
      gradeLeague(
        data.rosters,
        ownerNameFor,
        data.players,
        derived.tradeValueMap,
        derived.threeDValues,
        format.activePositions,
      ),
    [data.rosters, data.players, derived.tradeValueMap, derived.threeDValues, format.activePositions],
  );

  const myRoster = userId ? data.rosters.find((r) => r.owner_id === userId) : undefined;
  const myGrade = myRoster ? grades.find((g) => g.rosterId === myRoster.roster_id) : undefined;

  const rank = myGrade ? grades.findIndex((g) => g.rosterId === myGrade.rosterId) + 1 : null;
  // percentile = "better than X% of the league" (100 = best team in the league, 0 = last place).
  const percentile = rank !== null && grades.length > 1 ? Math.round(((grades.length - rank) / (grades.length - 1)) * 100) : rank !== null ? 100 : null;

  const rostered = useMemo(() => rosteredPlayerIds(data.rosters), [data.rosters]);
  const scorablePositions = SCORABLE_POSITIONS.filter((p) => format.activePositions.includes(p));

  const healthRows = useMemo(() => {
    if (!myRoster) return [];
    return computeStrengthsWeaknesses(myRoster, data.players, derived.tradeValueMap, derived.threeDValues, rostered, scorablePositions);
  }, [myRoster, data.players, derived.tradeValueMap, derived.threeDValues, rostered, scorablePositions]);

  const strengths = healthRows.filter((r) => r.severity === 'STRENGTH').sort((a, b) => b.gap - a.gap);
  const weaknesses = healthRows.filter((r) => r.severity !== 'STRENGTH').sort((a, b) => a.gap - b.gap);

  const improvementPaths = useMemo(() => {
    if (!myRoster) return [];
    return computeImprovementPaths(weaknesses, myRoster.roster_id, data.rosters, data.players, derived.tradeValueMap, ownerNameFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weaknesses, myRoster, data.rosters, data.players, derived.tradeValueMap]);

  const draftCapital = useMemo(() => {
    if (!myRoster) return null;
    return computeDraftCapital(myRoster.roster_id, data.tradedPicks, ownerNameFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRoster, data.tradedPicks]);

  const spentByRoster = useMemo(() => faabSpentByRoster(data.rosters), [data.rosters]);
  const startingBudget = data.league.settings.waiver_budget ?? 100;
  const myFaabRemaining = myRoster ? startingBudget - (spentByRoster.get(myRoster.roster_id) ?? 0) : null;

  console.debug('[HomeTab] render', {
    hasMyRoster: !!myRoster,
    myGrade: myGrade?.overall,
    rank,
    percentile,
    weaknessCount: weaknesses.length,
    improvementPathCount: improvementPaths.length,
  });

  if (!userId || !myRoster) {
    return (
      <div className="space-y-6">
        <Card>
          <CardTitle subtitle="Pick your team from the dropdown in the header above to unlock your personalized Roster Health Hub — grade, strengths/weaknesses, and next actions.">
            Select Your Team to Get Started
          </CardTitle>
        </Card>
        <Card>
          <CardTitle subtitle="A quick look at every team while you decide.">League Grades</CardTitle>
          <div className="space-y-1.5">
            {grades.map((g, i) => (
              <div key={g.rosterId} className="flex items-center gap-3 rounded-md border border-slate-800 px-3 py-2 text-sm">
                <span className="w-5 text-slate-500">{i + 1}</span>
                <Badge color={GRADE_COLOR[g.letter]}>{g.letter}</Badge>
                <span className="flex-1 truncate font-medium text-slate-200">{g.ownerName}</span>
                <span className="text-slate-500">{g.overall.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const injuryRisk = 100 - myGrade!.injuryRiskScore;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Overall Roster Grade</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-5xl font-bold text-slate-100">{myGrade!.letter}</span>
              <span className="text-2xl font-semibold text-slate-400">{myGrade!.overall.toFixed(1)}</span>
              <Badge color={GRADE_COLOR[myGrade!.letter]}>{myGrade!.overall >= 90 ? 'Elite' : myGrade!.overall >= 70 ? 'Competitive' : myGrade!.overall >= 50 ? 'Needs Work' : 'Rebuild Priority'}</Badge>
            </div>
          </div>
          <button
            onClick={() => setTab('roster')}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700"
          >
            Full Team Deep Dive →
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="League Percentile" value={percentile !== null ? `${percentile}th percentile` : '—'} hint={rank !== null ? `#${rank} of ${grades.length} — better than ${percentile}% of the league` : undefined} />
          <StatTile label="Immediate Strength" value={qualitativeLabel(myGrade!.projectedPointsScore)} hint={`Proj. points score ${myGrade!.projectedPointsScore.toFixed(0)}/100`} />
          <StatTile label="Long-Term Outlook" value={qualitativeLabel(myGrade!.longevityScore)} hint={`Longevity score ${myGrade!.longevityScore.toFixed(0)}/100`} />
          <StatTile label="Injury Risk" value={injuryRisk >= 40 ? 'High' : injuryRisk >= 20 ? 'Moderate' : 'Low'} hint={`${injuryRisk.toFixed(0)}/100 risk points`} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle subtitle="Positions where your best starter clearly outprojects the best player available on waivers.">Strengths</CardTitle>
          {strengths.length === 0 && <p className="text-sm text-slate-500">No standout positional strengths detected yet.</p>}
          <div className="space-y-1.5">
            {strengths.map((s) => (
              <div key={s.position} className="flex items-center justify-between rounded-md border border-emerald-800/40 bg-emerald-950/20 px-3 py-2 text-sm">
                <span className="text-slate-200">
                  <Badge color="green">{s.position}</Badge> <span className="ml-2">{s.yourPlayerName}</span>
                </span>
                <span className="text-emerald-400">+{s.gap} pts vs. best available</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle subtitle="Positions where your best starter is behind the best player available on waivers — CRITICAL ≥50pt gap, MEDIUM 20-50, LOW <20.">Weaknesses</CardTitle>
          {weaknesses.length === 0 && <p className="text-sm text-slate-500">No weaknesses detected relative to available replacements.</p>}
          <div className="space-y-1.5">
            {weaknesses.map((w) => (
              <div key={w.position} className="flex items-center justify-between rounded-md border border-slate-800 px-3 py-2 text-sm">
                <span className="text-slate-200">
                  <Badge color={SEVERITY_COLOR[w.severity]}>{w.severity}</Badge>{' '}
                  <span className="ml-2 font-medium">{w.position}</span>{' '}
                  <span className="text-slate-500">{w.yourPlayerName ?? 'no starter rostered'}</span>
                </span>
                <span className="text-rose-400">{w.gap} pts vs. {w.replacementPlayerName ?? 'best available'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle subtitle="Ranked by impact (biggest projected-points gap first). Each path names a real player from actual league data — no placeholders.">
          Improvement Paths
        </CardTitle>
        {improvementPaths.length === 0 && <p className="text-sm text-slate-500">No high-impact gaps to address right now — nice roster.</p>}
        <div className="space-y-3">
          {improvementPaths.map((path) => (
            <div key={path.position} className="rounded-lg border border-slate-800 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge color={SEVERITY_COLOR[path.severity]}>{path.severity}</Badge>
                <span className="font-semibold text-slate-200">{path.position}</span>
                <span className="text-xs text-slate-500">({path.impact} pt gap)</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-slate-950/40 p-2 text-sm">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Waiver Route</p>
                  {path.waiverRoute ? (
                    <p className="mt-1 text-slate-300">
                      Add <span className="font-medium text-slate-100">{path.waiverRoute.targetName}</span>
                      {path.waiverRoute.targetValue > 0 && <span className="text-slate-500"> (value {path.waiverRoute.targetValue})</span>}
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-500">No free agent upgrade found.</p>
                  )}
                </div>
                <div className="rounded-md bg-slate-950/40 p-2 text-sm">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Trade Route</p>
                  {path.tradeRoute ? (
                    <p className="mt-1 text-slate-300">
                      Target <span className="font-medium text-slate-100">{path.tradeRoute.targetName}</span>{' '}
                      <span className="text-slate-500">
                        ({path.tradeRoute.targetOwnerName}, value {path.tradeRoute.targetValue})
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-500">No clear trade target found.</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setTab('waivers')}
                  className="rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-500"
                >
                  Check Waivers for {path.position} →
                </button>
                <button
                  onClick={() => setTab('trade')}
                  className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  Explore Trades for {path.position} →
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <details className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-300">
          Health Metrics (expand)
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Grade Sub-Scores</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatTile label="Contention" value={myGrade!.contentionScore.toFixed(0)} />
              <StatTile label="Age Curve" value={myGrade!.ageCurveScore.toFixed(0)} />
              <StatTile label="Depth" value={myGrade!.depthScore.toFixed(0)} />
              <StatTile label="Injury Safety" value={myGrade!.injuryRiskScore.toFixed(0)} />
              <StatTile label="Proj. Points" value={myGrade!.projectedPointsScore.toFixed(0)} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">FAAB & Draft Capital</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="FAAB Remaining" value={myFaabRemaining !== null ? `$${myFaabRemaining}` : '—'} hint={`of $${startingBudget}`} />
              <StatTile label="Picks Acquired" value={draftCapital?.picksAcquired.length ?? 0} hint="via trade" />
              <StatTile label="Picks Traded Away" value={draftCapital?.picksTradedAway.length ?? 0} hint="via trade" />
              <StatTile label="Bye Week Distribution" value="Unavailable" hint="No reliable free 2026 schedule source yet" />
            </div>
            {draftCapital && (draftCapital.picksAcquired.length > 0 || draftCapital.picksTradedAway.length > 0) && (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                {draftCapital.picksAcquired.map((p, i) => (
                  <div key={`acq-${i}`} className="text-emerald-400">
                    + {p.season} Round {p.round} (from {p.fromOwnerName})
                  </div>
                ))}
                {draftCapital.picksTradedAway.map((p, i) => (
                  <div key={`away-${i}`} className="text-rose-400">
                    − {p.season} Round {p.round} (to {p.toOwnerName})
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-600">
              Only shows picks that have actually been traded, per Sleeper's traded-picks data. Every team also still owns all of its
              original picks that were never traded — those aren't tracked by this endpoint.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
