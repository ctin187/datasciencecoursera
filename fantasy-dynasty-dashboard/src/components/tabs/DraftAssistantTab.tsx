import { useEffect, useMemo, useRef, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { useDerivedData } from '../../hooks/useDerivedData';
import { useLiveDraft } from '../../hooks/useLiveDraft';
import type { Position } from '../../types';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { adpValueRank, classifySleeperReach, computeThreeDValuesForPool } from '../../lib/valueCalculator';
import { buildTiers, positionalScarcity, tierBreakpointInfo } from '../../lib/draftAssistant';
import { buildEstimatedAdpRows } from '../../lib/consensusData';
import { peakAgeRange } from '../../lib/agingCurves';
import { detectLeagueFormat } from '../../lib/leagueFormat';
import {
  computeDraftProgress,
  estimateSecondsPerPick,
  findRelevantDraft,
  findUserRosterId,
  isDraftLive,
  picksUntilRosterTurn,
  rosterIdForSlot,
} from '../../lib/liveDraft';

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
  isEstimated: boolean;
  isTierBreakpoint: boolean;
}

export function DraftAssistantTab({ data, derived, userId }: { data: LeagueData; derived: Derived; userId: string }) {
  const format = useMemo(() => detectLeagueFormat(data.league.roster_positions), [data.league.roster_positions]);
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');
  const POSITIONS = useMemo(() => ['ALL', ...format.activePositions] as (Position | 'ALL')[], [format.activePositions]);

  // The curated seed dataset is offense-skill-position-only by design (see
  // data/consensusPlayers.ts) - no maintained public consensus exists for
  // K/DEF/IDP the way it does for QB/RB/WR/TE. For a league that starts
  // those positions, synthesize estimated rows (search_rank-based, same
  // system as everywhere else in the app) rather than silently leaving them
  // off the board entirely.
  const extraPositions = useMemo(
    () => format.activePositions.filter((p) => !['QB', 'RB', 'WR', 'TE'].includes(p)),
    [format.activePositions],
  );
  const estimatedRows = useMemo(
    () => buildEstimatedAdpRows(data.players, extraPositions, derived.consensusAdp.length + 1),
    [data.players, extraPositions, derived.consensusAdp.length],
  );
  const estimatedIds = useMemo(() => new Set(estimatedRows.map((r) => r.playerId)), [estimatedRows]);
  const consensusAdp = useMemo(() => [...derived.consensusAdp, ...estimatedRows], [derived.consensusAdp, estimatedRows]);
  const threeDValues = useMemo(() => computeThreeDValuesForPool(consensusAdp), [consensusAdp]);

  const activeDraft = useMemo(() => findRelevantDraft(data.drafts), [data.drafts]);
  const live = useLiveDraft(activeDraft, true);
  const draftIsLive = isDraftLive(activeDraft);

  const { valueRank, adpRank } = useMemo(() => adpValueRank(consensusAdp, threeDValues), [consensusAdp, threeDValues]);
  const tiersAll = useMemo(() => buildTiers(consensusAdp, threeDValues, 'ALL'), [consensusAdp, threeDValues]);
  const scarcity = useMemo(
    () => positionalScarcity(consensusAdp, threeDValues, draftIsLive ? live.draftedIds : new Set(), format.activePositions),
    [consensusAdp, threeDValues, draftIsLive, live.draftedIds, format.activePositions],
  );

  const userById = useMemo(() => new Map(data.users.map((u) => [u.user_id, u])), [data.users]);
  const rosterById = useMemo(() => new Map(data.rosters.map((r) => [r.roster_id, r])), [data.rosters]);
  const teamNameForRoster = (rosterId: number | null) => {
    if (rosterId === null) return null;
    const roster = rosterById.get(rosterId);
    const owner = roster?.owner_id ? userById.get(roster.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${rosterId}`;
  };

  const progress = useMemo(
    () => (activeDraft ? computeDraftProgress(activeDraft, live.picks) : null),
    [activeDraft, live.picks],
  );
  const myRosterId = useMemo(() => (userId ? findUserRosterId(data.rosters, userId) : null), [data.rosters, userId]);
  const picksUntilMe = useMemo(
    () => (activeDraft && myRosterId !== null ? picksUntilRosterTurn(activeDraft, live.picks, myRosterId) : null),
    [activeDraft, live.picks, myRosterId],
  );
  const secPerPick = useMemo(() => estimateSecondsPerPick(live.observedPickTimestamps), [live.observedPickTimestamps]);

  // Vibrate + auto-scroll once when the user's turn drops to 2-picks-away (mobile "your turn is close" cue).
  const vibratedRef = useRef(false);
  const trackerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picksUntilMe === null) {
      vibratedRef.current = false;
      return;
    }
    if (picksUntilMe <= 2 && !vibratedRef.current) {
      vibratedRef.current = true;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([200, 100, 200]);
        } catch {
          // vibration unsupported/blocked - non-fatal
        }
      }
      trackerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (picksUntilMe > 2) vibratedRef.current = false;
  }, [picksUntilMe]);

  const lastPickLabel = useMemo(() => {
    if (!live.lastPick) return null;
    const pick = live.lastPick;
    const posRank = live.picks.filter((p) => p.metadata?.position === pick.metadata?.position).length;
    const player = data.players[pick.player_id];
    const name = pick.metadata
      ? `${pick.metadata.first_name ?? ''} ${pick.metadata.last_name ?? ''}`.trim()
      : player?.full_name || pick.player_id;
    const team = pick.metadata?.team ?? player?.team ?? 'FA';
    const age = player?.age;
    const pos = pick.metadata?.position ?? player?.position ?? '';
    return `${pos}${posRank} just drafted: ${name} (${team}${age ? `, age ${age}` : ''})`;
  }, [live.lastPick, live.picks, data.players]);

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
          isEstimated: estimatedIds.has(p.playerId),
          isTierBreakpoint: breakpoint?.isLastInTier ?? false,
        };
      }),
    [consensusAdp, threeDValues, adpRank, valueRank, tiersAll, derived.tradeValueMap, estimatedIds],
  );

  // While live: drop drafted players from the board, except the most recent
  // pick, which stays visible-but-grayed for a few seconds as a "just went" cue.
  const boardRows = draftIsLive ? rows.filter((r) => !live.draftedIds.has(r.playerId) || r.playerId === live.lastPick?.player_id) : rows;
  const filteredRows = posFilter === 'ALL' ? boardRows : boardRows.filter((r) => r.position === posFilter);

  const columns: Column<DraftRow>[] = [
    {
      key: 'name',
      header: 'Player',
      accessor: (r) => r.name,
      render: (r) => {
        const justDrafted = draftIsLive && r.playerId === live.lastPick?.player_id;
        return (
          <div className={`flex items-center gap-1.5 ${justDrafted ? 'opacity-50' : ''}`}>
            <span className="font-medium">{r.name}</span>
            {justDrafted && <Badge color="red">DRAFTED</Badge>}
            {r.isEstimated && !justDrafted && (
              <Badge color="gray" title="No curated ADP consensus for this position - estimated from Sleeper's own relevance ranking.">
                Est.
              </Badge>
            )}
            {r.isTierBreakpoint && !justDrafted && <Badge color="yellow">last in tier</Badge>}
          </div>
        );
      },
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
      {activeDraft && (draftIsLive || live.picks.length > 0) && (
        <div ref={trackerRef}>
        <Card className={draftIsLive ? 'border-emerald-700/60' : ''}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {draftIsLive ? (
              <Badge color="green">● LIVE DRAFT</Badge>
            ) : (
              <Badge color="gray">DRAFT {activeDraft.status.toUpperCase()}</Badge>
            )}
            {live.pollError && <Badge color="yellow">{live.pollError}</Badge>}
            <button
              onClick={live.refreshNow}
              className="ml-auto rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              Refresh now
            </button>
          </div>

          {lastPickLabel && (
            <div className="mb-3 rounded-md border border-violet-700/50 bg-violet-950/30 px-3 py-2 text-sm text-violet-200">
              {lastPickLabel}
            </div>
          )}

          {progress && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Round" value={`${progress.currentRound} / ${activeDraft.settings.rounds}`} />
              <StatTile
                label="Pick"
                value={`${progress.currentPickNo} / ${progress.totalPicks}`}
                hint={`${progress.picksMade} made`}
              />
              <StatTile label="On the Clock" value={teamNameForRoster(progress.onClockRosterId ?? rosterIdForSlot(activeDraft, progress.onClockSlot)) ?? '—'} />
              {myRosterId !== null && picksUntilMe !== null && (
                <StatTile
                  label={picksUntilMe === 0 ? "YOUR TURN" : 'Picks Until You'}
                  value={picksUntilMe === 0 ? 'NOW' : picksUntilMe}
                  hint={
                    picksUntilMe > 0
                      ? secPerPick
                        ? `~${Math.round((picksUntilMe * secPerPick) / 60)} min (session pace)`
                        : 'gathering pace data...'
                      : undefined
                  }
                />
              )}
            </div>
          )}
          {myRosterId !== null && picksUntilMe !== null && picksUntilMe <= 5 && picksUntilMe > 0 && (
            <div className="mt-3 rounded-md bg-amber-900/30 border border-amber-700/50 px-3 py-2 text-center text-sm font-semibold text-amber-300">
              {picksUntilMe} pick{picksUntilMe === 1 ? '' : 's'} until YOUR TURN
            </div>
          )}
        </Card>
        </div>
      )}

      <Card>
        <CardTitle
          subtitle={
            'Positive 3D-value ranks better than ADP => sleeper. Worse => reach.' +
            (extraPositions.length > 0
              ? ` "Est." players (${extraPositions.join('/')}) have no curated dynasty ADP consensus anywhere - ranked by Sleeper's own relevance signal instead.`
              : '')
          }
        >
          Startup Draft Board — ADP vs. 3D Value
          {draftIsLive && <span className="ml-2 font-normal text-emerald-400">(drafted players auto-removed)</span>}
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
          {format.activePositions
            .filter((pos) => pos !== 'DEF')
            .map((pos) => {
              const { start, end } = peakAgeRange(pos);
              return <StatTile key={pos} label={pos} value={`Peak ${start}-${end}`} />;
            })}
        </div>
      </Card>
    </div>
  );
}
