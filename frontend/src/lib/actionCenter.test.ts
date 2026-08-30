import { describe, it, expect } from 'vitest';
import { buildActionCenter } from './actionCenter';
import type { EdgeSignal } from './edgeEngine';

describe('buildActionCenter', () => {
  it('prioritizes an empty starting slot above a merely weak one', () => {
    const myTeam = {
      starters: [
        { slot: 'QB', empty: false, player: { name: 'QB Guy', vor_per_game: 2 } },
        { slot: 'RB', empty: false, player: { name: 'Bad RB', vor_per_game: -1.5 } },
        { slot: 'WR', empty: true, player: null },
      ],
    } as never;

    const items = buildActionCenter({ edgeSignals: [], myTeam, bestWaiverTarget: null });
    expect(items[0].category).toBe('LINEUP');
    expect(items[0].severity).toBe('high');
    expect(items.some((i) => i.category === 'ROSTER')).toBe(false); // empty-slot branch takes priority over the weak-starter branch
  });

  it('surfaces a strong waiver upgrade as high severity and a large championship edge as high severity', () => {
    const edgeSignals: EdgeSignal[] = [
      { key: 'championship', label: 'Championship Edge', valuePp: 8.2, valueText: '+8.2 pp', detail: 'detail', status: 'edge' },
    ];
    const bestWaiverTarget = { sleeper_id: 'x', name: 'Good WR', position: 'WR', vor_per_game: 3, upgrade_over_weakest_starter: 4.5 } as never;

    const items = buildActionCenter({ edgeSignals, myTeam: null, bestWaiverTarget });
    const waiverItem = items.find((i) => i.category === 'WAIVER')!;
    const playoffItem = items.find((i) => i.category === 'PLAYOFFS')!;
    expect(waiverItem.severity).toBe('high');
    expect(playoffItem.severity).toBe('high');
  });

  it('produces nothing when there is no data at all', () => {
    expect(buildActionCenter({ edgeSignals: [], myTeam: null, bestWaiverTarget: null })).toEqual([]);
  });
});
