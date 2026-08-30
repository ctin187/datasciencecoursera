import type { WaiverTargetsState } from '../../hooks/useWaiverTargets';
import type { BenchPlayer, WaiverTarget } from '../../services/backendApi';
import { Card, CardTitle } from '../ui/Card';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge } from '../ui/Badge';

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

function directionBadge(direction: 'rising' | 'falling' | 'stable' | null) {
  if (direction === 'rising') return <Badge color="green">↑ rising usage</Badge>;
  if (direction === 'falling') return <Badge color="red">↓ falling usage</Badge>;
  if (direction === 'stable') return <Badge color="gray">stable usage</Badge>;
  return <Badge color="gray">usage trend n/a</Badge>;
}

export function WaiverWireTab({ waivers }: { waivers: WaiverTargetsState }) {
  if (!waivers.backendConfigured) {
    return (
      <Card>
        <CardTitle>Waiver Wire</CardTitle>
        <p className="text-slate-400">
          The analytics backend isn't configured, so waiver targets can't be ranked. Nothing is fabricated in its place.
        </p>
      </Card>
    );
  }

  if (waivers.loading) {
    return (
      <Card>
        <p className="text-center text-slate-400">Ranking free agents by value over replacement…</p>
      </Card>
    );
  }

  if (waivers.error) {
    return (
      <Card className="border-rose-800">
        <p className="text-rose-300">{waivers.error}</p>
      </Card>
    );
  }

  if (!waivers.result) return null;

  const { result } = waivers;

  const columns: Column<WaiverTarget>[] = [
    { key: 'name', header: 'Player', accessor: (t) => t.name ?? t.sleeper_id, render: (t) => (
      <span>{t.name ?? t.sleeper_id} <span className="text-slate-500">({t.position ?? '?'}{t.team ? ` · ${t.team}` : ''})</span></span>
    ) },
    { key: 'proj', header: 'Proj pts/gm', accessor: (t) => t.projected_points_per_game ?? -999, align: 'right', render: (t) => fmt(t.projected_points_per_game) },
    {
      key: 'vor',
      header: 'VOR/gm',
      accessor: (t) => t.vor_per_game ?? -999,
      align: 'right',
      render: (t) => (
        <span className={(t.vor_per_game ?? -1) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          {t.vor_per_game != null ? `${t.vor_per_game >= 0 ? '+' : ''}${fmt(t.vor_per_game)}` : t.reason ?? '—'}
        </span>
      ),
    },
    {
      key: 'upgrade',
      header: 'Upgrade Over Your Weakest Starter',
      accessor: (t) => t.upgrade_over_weakest_starter ?? -999,
      align: 'right',
      render: (t) => (
        <span className={(t.upgrade_over_weakest_starter ?? -1) > 0 ? 'font-semibold text-violet-300' : 'text-slate-500'}>
          {t.upgrade_over_weakest_starter != null ? `${t.upgrade_over_weakest_starter >= 0 ? '+' : ''}${fmt(t.upgrade_over_weakest_starter)}` : '—'}
        </span>
      ),
    },
    { key: 'trend', header: 'Usage Trend', accessor: (t) => t.usage?.direction ?? '', align: 'center', render: (t) => directionBadge(t.usage?.direction ?? null) },
  ];

  const benchColumns: Column<BenchPlayer>[] = [
    { key: 'name', header: 'Bench Player', accessor: (b) => b.name ?? b.sleeper_id, render: (b) => (
      <span>{b.name ?? b.sleeper_id} <span className="text-slate-500">({b.position ?? '?'})</span></span>
    ) },
    { key: 'vor', header: 'VOR/gm', accessor: (b) => b.vor_per_game ?? -999, align: 'right', render: (b) => (
      <span className={b.below_replacement ? 'text-rose-400' : 'text-emerald-400'}>{b.vor_per_game != null ? fmt(b.vor_per_game) : '—'}</span>
    ) },
    { key: 'status', header: 'Status', accessor: (b) => (b.below_replacement ? 1 : 0), align: 'center', render: (b) => (b.below_replacement ? <Badge color="red">Below replacement — drop candidate</Badge> : <Badge color="green">Roster-worthy</Badge>) },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          subtitle={`Season ${result.season}, as of week ${result.as_of_week}, ${result.games_remaining} games remaining. Ranked by value over this league's actual replacement level — not a generic "best player available" list.`}
        >
          Waiver Targets ({result.count})
        </CardTitle>
        <p className="mb-3 text-xs text-slate-500">{result.methodology}</p>
        <DataTable rows={result.targets} columns={columns} rowKey={(t) => t.sleeper_id} defaultSortKey="vor" maxHeight={640} />
        <p className="mt-3 text-xs text-slate-600">
          FAAB bid suggestions and acquisition-probability estimates (competition modeling) aren't implemented yet — this ranks
          value only. Do not treat "upgrade over your weakest starter" as a bid amount.
        </p>
      </Card>

      {result.bench_ranked.length > 0 && (
        <Card>
          <CardTitle subtitle="Your own bench, ranked the same way — a below-replacement bench player next to a strong waiver target is a real drop/add candidate.">
            Your Bench
          </CardTitle>
          <DataTable rows={result.bench_ranked} columns={benchColumns} rowKey={(b) => b.sleeper_id} defaultSortKey="vor" />
        </Card>
      )}
    </div>
  );
}
