import { useMemo, useState } from 'react';
import type { LeagueData } from '../../hooks/useLeagueData';
import type { DraftPicksState } from '../../hooks/useDraftPicks';
import { computeDraftBoard } from '../../lib/draftAssistant';
import { buildDraftBoard, sortByRosterNeed, type BoardPlayer } from '../../lib/draftBoard';
import { Card, CardTitle, StatTile } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

// Lineup-card order, so K/DEF/IDP sit where a manager expects rather than
// alphabetically ahead of the skill positions.
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

type SortMode = 'need' | 'overall';

export function DraftAssistantTab({
  data,
  userId,
  draftPicks,
}: {
  data: LeagueData;
  userId: string;
  draftPicks: DraftPicksState;
}) {
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('need');

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

  const { players: allAvailable, needs, neededPositions } = useMemo(() => {
    const draftedIds = new Set(picks.map((p) => p.player_id));
    // Players already on your roster count toward needs even if this draft
    // did not produce them (keeper leagues, or a draft resumed mid-stream).
    const rostered = myRosterId != null
      ? data.rosters.find((r) => r.roster_id === myRosterId)?.players ?? []
      : [];
    const fromThisDraft = picks.filter((p) => p.roster_id === myRosterId).map((p) => p.player_id);
    return buildDraftBoard({
      players: data.players,
      draftedSleeperIds: draftedIds,
      rosterPositions: data.league.roster_positions,
      numTeams: data.league.total_rosters,
      myPlayerIds: [...new Set([...rostered, ...fromThisDraft])],
    });
  }, [data.players, data.league, data.rosters, picks, myRosterId]);

  const ordered = useMemo(
    () => (sortMode === 'need' && myRosterId != null ? sortByRosterNeed(allAvailable) : allAvailable),
    [allAvailable, sortMode, myRosterId],
  );

  const filtered = posFilter === 'ALL' ? ordered : ordered.filter((p) => p.position === posFilter);

  const positions = [...new Set(allAvailable.map((p) => p.position))].sort((a, b) => {
    const ai = POSITION_ORDER.indexOf(a);
    const bi = POSITION_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  const countAt = (pos: string) => allAvailable.filter((p) => p.position === pos).length;

  const top = filtered[0];

  const columns: Column<BoardPlayer>[] = [
    {
      key: 'name',
      header: 'Player',
      accessor: (p) => p.name,
      render: (p) => (
        <span>
          {p.name} <span className="text-muted">({p.position}{p.team ? ` · ${p.team}` : ''})</span>
          {p.fillsStartingNeed && <span className="ml-1.5"><Badge color="greenDark">Need</Badge></span>}
        </span>
      ),
    },
    { key: 'overall', header: 'Sleeper Rk', accessor: (p) => p.overallRank, align: 'right',
      render: (p) => <span className="num-accent">#{p.overallRank}</span> },
    { key: 'posrank', header: 'Pos Rk', accessor: (p) => p.posRankAvailable, align: 'right',
      render: (p) => <span className="text-muted">{p.position}{p.posRankAvailable}</span> },
    {
      key: 'left',
      header: 'Starters Left at Pos',
      accessor: (p) => p.startersLeftAtPosition,
      align: 'right',
      render: (p) => (
        <span
          className={p.startersLeftAtPosition <= 3 ? 'font-semibold num-neg' : p.startersLeftAtPosition <= 8 ? 'num-warn' : 'text-muted'}
          title="Undrafted players at this position still above the league's replacement line. Low means waiting costs you."
        >
          {p.startersLeftAtPosition}
        </span>
      ),
    },
  ];

  if (!draft) {
    return (
      <Card>
        <CardTitle>Draft Assistant</CardTitle>
        <p className="text-muted">No draft found for this league.</p>
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
        <button onClick={refresh} disabled={refreshing} className="btn mt-2">
          {refreshing ? 'Refreshing…' : 'Refresh Picks'}
        </button>
        {loading && <p className="mt-2 text-xs text-muted">Loading draft picks…</p>}
        {error && <p className="mt-2 text-xs num-neg">{error}</p>}
      </Card>

      {myRosterId == null && (
        <Card className="notice">
          <p className="text-sm">
            Pick your team from the dropdown above to sort this board by what your roster still needs.
          </p>
        </Card>
      )}

      {myRosterId != null && (
        <Card>
          <CardTitle subtitle="Dedicated starting slots you have not filled yet. Bench spots are not counted — depth is a luxury until your lineup is legal.">
            Still to Fill
          </CardTitle>
          <div className="filter-bar">
            {needs.filter((n) => n.required > 0).map((n) => (
              <span
                key={n.position}
                className={`filter-chip ${n.remaining > 0 ? 'is-active' : ''}`}
                title={`${n.filled} of ${n.required} ${n.position} starting slots filled`}
              >
                {n.position}
                <span className="filter-count">{n.filled}/{n.required}</span>
              </span>
            ))}
            {neededPositions.length === 0 && (
              <span className="text-muted">Every starting slot is filled — draft for value and depth now.</span>
            )}
          </div>
        </Card>
      )}

      {top && (
        <Card>
          <CardTitle>Best Pick Right Now</CardTitle>
          <div className="px-2.5">
            <div className="num text-lg font-semibold text-[color:var(--pats-navy)]">
              {top.name} <span className="text-muted">({top.position}{top.team ? ` · ${top.team}` : ''})</span>
            </div>
            <ul className="mt-1.5 space-y-1 text-sm">
              <li>
                Sleeper's consensus has him at <strong>#{top.overallRank}</strong> overall, {top.position}
                {top.posRankAvailable} among everyone still on the board.
              </li>
              {top.fillsStartingNeed ? (
                <li>
                  He fills a <strong>starting {top.position} slot you still have open</strong>, and only{' '}
                  <strong>{top.startersLeftAtPosition}</strong> startable {top.position}s remain league-wide.
                </li>
              ) : (
                <li className="text-muted">
                  Your starting lineup is already full at {top.position} — this is a value pick, not a need pick.
                </li>
              )}
            </ul>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle
          subtitle={`${allAvailable.length} undrafted players, ranked by Sleeper's own consensus for this season — the same ordering Sleeper shows in its draft room, covering every position your league starts, rookies included. "Starters left" is computed from this league's actual roster_positions.`}
        >
          Best Available
        </CardTitle>

        <div className="filter-bar">
          <button
            className={`filter-chip ${sortMode === 'need' ? 'is-active' : ''}`}
            onClick={() => setSortMode('need')}
            disabled={myRosterId == null}
            title={myRosterId == null ? 'Select your team above to use this' : 'Positions you still have to start come first'}
          >
            Sort: My Needs
          </button>
          <button
            className={`filter-chip ${sortMode === 'overall' ? 'is-active' : ''}`}
            onClick={() => setSortMode('overall')}
          >
            Sort: Best Available
          </button>
        </div>

        <div className="filter-bar">
          <button className={`filter-chip ${posFilter === 'ALL' ? 'is-active' : ''}`} onClick={() => setPosFilter('ALL')}>
            All<span className="filter-count">{allAvailable.length}</span>
          </button>
          {positions.map((pos) => (
            <button
              key={pos}
              className={`filter-chip ${posFilter === pos ? 'is-active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos}<span className="filter-count">{countAt(pos)}</span>
            </button>
          ))}
        </div>

        <DataTable
          rows={filtered.slice(0, 300)}
          columns={columns}
          rowKey={(p) => p.sleeperId}
          defaultSortKey="overall"
          defaultSortDir="asc"
        />
      </Card>
    </div>
  );
}
