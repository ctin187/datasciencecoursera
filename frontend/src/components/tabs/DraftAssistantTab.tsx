import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { ProjectionPoolState } from '../../hooks/useProjectionPool';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import { computeDraftBoard, buildAvailableBoard, type AvailablePlayerRow } from '../../lib/draftAssistant';
import { explainDraftPick } from '../../lib/explain';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';
import { Meter } from '../ui/Meter';

/** Presentation-only: scales a marginal-VOR pick recommendation onto the Meter's 0-100 fill. Not a real bounded metric. */
function marginalToMeterFill(v: number | null): number {
  return Math.max(0, Math.min(100, (v ?? 0) * 7));
}

function fmt(n: number | null): string {
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

export function DraftAssistantTab({
  data,
  userId,
  pool,
  draftPicks,
}: {
  data: LeagueData;
  userId: string;
  pool: ProjectionPoolState;
  draftPicks: DraftPicksState;
}) {
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const draft = data.drafts.find((d) => d.league_id === data.league.league_id) ?? data.drafts[0];
  const { picks, loading, error, refresh, refreshing } = draftPicks;

  const userById = new Map(data.users.map((u) => [u.user_id, u]));
  const teamName = (rosterId: number | null) => {
    if (rosterId == null) return '—';
    const r = data.rosters.find((x) => x.roster_id === rosterId);
    const owner = r?.owner_id ? userById.get(r.owner_id) : undefined;
    return owner?.metadata?.team_name || owner?.display_name || `Roster ${rosterId}`;
  };

  const myRosterId = userId ? data.rosters.find((r) => r.owner_id === userId)?.roster_id ?? null : null;
  const board = draft ? computeDraftBoard(draft, picks) : null;
  const draftedIds = new Set(picks.map((p) => p.player_id));
  const myPickedIds = picks.filter((p) => p.roster_id === myRosterId).map((p) => p.player_id);

  const available = useMemo(() => {
    if (!pool.bySleeperId.size) return [];
    return buildAvailableBoard({
      pool: pool.bySleeperId,
      draftedSleeperIds: draftedIds,
      rosterPositions: data.league.roster_positions,
      myCurrentPlayerIds: myPickedIds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.bySleeperId, picks, myRosterId]);

  const byMarginal = useMemo(
    () => [...available].filter((p) => p.marginalValueForMyTeam !== null).sort((a, b) => (b.marginalValueForMyTeam ?? 0) - (a.marginalValueForMyTeam ?? 0)),
    [available],
  );

  const filtered = posFilter === 'ALL' ? available : available.filter((p) => p.position === posFilter);
  // Order filters the way a lineup card reads, so K/DEF/IDP sit where a manager
  // expects rather than alphabetically ahead of the skill positions.
  const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  const positions = [...new Set(available.map((p) => p.position ?? '?'))].sort(
    (a, b) => {
      const ai = POSITION_ORDER.indexOf(a);
      const bi = POSITION_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
    },
  );
  const countAt = (pos: string) => available.filter((p) => p.position === pos).length;

  const columns: Column<AvailablePlayerRow>[] = [
    { key: 'name', header: 'Player', accessor: (p) => p.name ?? p.sleeperId, render: (p) => (
      <span>{p.name ?? p.sleeperId} <span className="text-muted">({p.position ?? '?'}{p.team ? ` · ${p.team}` : ''})</span></span>
    ) },
    { key: 'vor', header: 'VOR/gm', accessor: (p) => p.vorPerGame ?? -999, align: 'right', render: (p) => (
      p.vorPerGame === null
        ? <span className="text-muted" title="No projection exists for this position - ranked by Sleeper relevance instead">—</span>
        : <span className={p.vorPerGame >= 0 ? 'num-pos' : 'num-neg'}>{fmt(p.vorPerGame)}</span>
    ) },
    { key: 'rank', header: 'Sleeper Rk', accessor: (p) => p.sleeperRank ?? 999999, align: 'right', render: (p) => (
      p.sleeperRank != null
        ? <span className="text-muted" title="Sleeper's own relevance ordinal - not a fantasy projection">#{p.sleeperRank}</span>
        : <span className="text-muted">—</span>
    ) },
    { key: 'drop', header: 'Drop to Next at Pos', accessor: (p) => p.dropToNextAtPosition ?? -999, align: 'right', render: (p) => (
      <span className={p.dropToNextAtPosition != null && p.dropToNextAtPosition > 1.5 ? 'font-semibold num-warn' : 'text-muted'}>
        {p.dropToNextAtPosition != null ? p.dropToNextAtPosition.toFixed(2) : '—'}
      </span>
    ) },
    { key: 'marginal', header: 'Marginal Value For You', accessor: (p) => p.marginalValueForMyTeam ?? -999, align: 'right', render: (p) => (
      <span className={(p.marginalValueForMyTeam ?? -1) > 0 ? 'font-semibold num-accent' : 'text-muted'}>
        {p.marginalValueForMyTeam != null ? fmt(p.marginalValueForMyTeam) : '—'}
      </span>
    ) },
  ];

  if (!draft) {
    return (
      <Card>
        <CardTitle>Draft Assistant</CardTitle>
        <p className="text-slate-400">No draft found for this league.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardTitle subtitle={`Draft type: ${draft.type}${board?.isNomination ? ' (nomination order shown, not a strict turn clock)' : ''}`}>
          Draft Command
        </CardTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Status" value={<Badge color="purple">{draft.status.replace('_', ' ')}</Badge>} />
          <StatTile label="Picks Made" value={board?.picksMade ?? 0} />
          <StatTile label={board?.isNomination ? 'Nominates Next' : 'On the Clock'} value={teamName(board?.onClockRosterId ?? null)} />
          <StatTile label="Round / Pick" value={board ? `R${board.onClockRound} · #${board.onClockPickNo}` : '—'} />
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="btn mt-2"
        >
          {refreshing ? 'Refreshing…' : 'Refresh Picks'}
        </button>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        {loading && <p className="mt-2 text-xs text-slate-500">Loading draft picks…</p>}
      </Card>

      {pool.fullFallback && (
        <Card className="notice">
          <p className="text-sm">
            <strong>Projections unavailable</strong> — {pool.backendConfigured
              ? "the analytics backend didn't respond"
              : "the analytics backend isn't configured"}, so there is no VOR for anyone right now.
            The board below is ordered by <strong>Sleeper's own relevance rank</strong> across every position your
            league rosters. That's real Sleeper data, not a projection — treat it as a sane draft order, not a
            valuation.
          </p>
        </Card>
      )}

      {!pool.fullFallback && pool.unprojectedPositions.length > 0 && (
        <Card className="notice">
          <p className="text-sm">
            <strong>{pool.unprojectedPositions.join(', ')}</strong>{' '}
            {pool.unprojectedPositions.length === 1 ? 'has' : 'have'} no projection source — nflverse doesn't publish
            the inputs the model needs for {pool.unprojectedPositions.length === 1 ? 'it' : 'them'}. Those players are
            still on the board, ordered by <strong>Sleeper relevance rank</strong> and shown with "—" under VOR so
            they're never mistaken for a projected value. Filter by position to draft them.
          </p>
        </Card>
      )}

      {pool.loading && (
        <Card>
          <p className="text-center text-muted">Loading the full player projection pool…</p>
        </Card>
      )}

      {pool.error && !pool.fullFallback && (
        <Card className="notice-error">
          <p>{pool.error}</p>
        </Card>
      )}

      {myRosterId != null && byMarginal.length > 0 && (
        <Card>
          <CardTitle>Recommendation</CardTitle>
          <div className="mb-4">
            <Meter
              label={`Take ${byMarginal[0].name ?? byMarginal[0].sleeperId}`}
              value={marginalToMeterFill(byMarginal[0].marginalValueForMyTeam)}
              displayValue={`${fmt(byMarginal[0].marginalValueForMyTeam)} marginal VOR`}
              tone="positive"
              sublabel={byMarginal[0].position ?? undefined}
            />
          </div>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {explainDraftPick(byMarginal, available).map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        </Card>
      )}

      {available.length > 0 && (
        <Card>
          <CardTitle
            subtitle={`${available.length} undrafted players across every position your league rosters. VOR-projected players rank first; K/DEF/IDP follow, ordered by Sleeper rank. "Marginal value for you" is computed for the top 40 by VOR only, to keep this fast.`}
          >
            Best Available
          </CardTitle>
          <div className="filter-bar">
            <button
              onClick={() => setPosFilter('ALL')}
              className={`filter-chip${posFilter === 'ALL' ? ' is-active' : ''}`}
            >
              ALL <span className="filter-count">{available.length}</span>
            </button>
            {positions.map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`filter-chip${posFilter === pos ? ' is-active' : ''}`}
              >
                {pos} <span className="filter-count">{countAt(pos)}</span>
              </button>
            ))}
          </div>
          <DataTable rows={filtered} columns={columns} rowKey={(p) => p.sleeperId} defaultSortKey="vor" maxHeight={640} />
        </Card>
      )}
    </div>
  );
}
