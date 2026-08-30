import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { ProjectionPoolState } from '../../hooks/useProjectionPool';
import { useDraftPicks } from '../../hooks/useDraftPicks';
import { computeDraftBoard, buildAvailableBoard, type AvailablePlayerRow } from '../../lib/draftAssistant';
import { explainDraftPick } from '../../lib/explain';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

function fmt(n: number | null): string {
  return n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

export function DraftAssistantTab({ data, userId, pool }: { data: LeagueData; userId: string; pool: ProjectionPoolState }) {
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const draft = data.drafts.find((d) => d.league_id === data.league.league_id) ?? data.drafts[0];
  const { picks, loading, error, refresh, refreshing } = useDraftPicks(draft?.draft_id ?? null);

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
  const positions = [...new Set(available.map((p) => p.position ?? '?'))].sort();

  const columns: Column<AvailablePlayerRow>[] = [
    { key: 'name', header: 'Player', accessor: (p) => p.name ?? p.sleeperId, render: (p) => (
      <span>{p.name ?? p.sleeperId} <span className="text-slate-500">({p.position ?? '?'}{p.team ? ` · ${p.team}` : ''})</span></span>
    ) },
    { key: 'vor', header: 'VOR/gm', accessor: (p) => p.vorPerGame ?? -999, align: 'right', render: (p) => (
      <span className={(p.vorPerGame ?? -1) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmt(p.vorPerGame)}</span>
    ) },
    { key: 'drop', header: 'Drop to Next at Pos', accessor: (p) => p.dropToNextAtPosition ?? -999, align: 'right', render: (p) => (
      <span className={p.dropToNextAtPosition != null && p.dropToNextAtPosition > 1.5 ? 'font-semibold text-amber-400' : 'text-slate-400'}>
        {p.dropToNextAtPosition != null ? p.dropToNextAtPosition.toFixed(2) : '—'}
      </span>
    ) },
    { key: 'marginal', header: 'Marginal Value For You', accessor: (p) => p.marginalValueForMyTeam ?? -999, align: 'right', render: (p) => (
      <span className={(p.marginalValueForMyTeam ?? -1) > 0 ? 'font-semibold text-violet-300' : 'text-slate-500'}>
        {p.marginalValueForMyTeam != null ? fmt(p.marginalValueForMyTeam) : 'not computed'}
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
    <div className="space-y-6">
      <Card>
        <CardTitle subtitle={`Draft type: ${draft.type}${board?.isNomination ? ' (nomination order shown, not a strict turn clock)' : ''}`}>
          Draft Status
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
          className="mt-3 min-h-[36px] rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh Picks'}
        </button>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        {loading && <p className="mt-2 text-xs text-slate-500">Loading draft picks…</p>}
      </Card>

      {!pool.backendConfigured && (
        <Card>
          <p className="text-slate-400">The analytics backend isn't configured, so player values (VOR) aren't available — the board can't be ranked.</p>
        </Card>
      )}

      {pool.loading && (
        <Card>
          <p className="text-center text-slate-400">Loading the full player projection pool…</p>
        </Card>
      )}

      {pool.error && (
        <Card className="border-rose-800">
          <p className="text-rose-300">{pool.error}</p>
        </Card>
      )}

      {myRosterId != null && byMarginal.length > 0 && (
        <Card>
          <CardTitle>Recommendation</CardTitle>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {explainDraftPick(byMarginal, available).map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        </Card>
      )}

      {available.length > 0 && (
        <Card>
          <CardTitle subtitle={`${available.length} undrafted players with a projection. "Marginal value for you" is computed for the top 40 by VOR only, to keep this fast.`}>
            Available Players
          </CardTitle>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setPosFilter('ALL')}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${posFilter === 'ALL' ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-slate-700 text-slate-400'}`}
            >
              ALL
            </button>
            {positions.map((pos) => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${posFilter === pos ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-slate-700 text-slate-400'}`}
              >
                {pos}
              </button>
            ))}
          </div>
          <DataTable rows={filtered} columns={columns} rowKey={(p) => p.sleeperId} defaultSortKey="vor" maxHeight={640} />
        </Card>
      )}
    </div>
  );
}
