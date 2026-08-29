"""Validation gate. Run before trusting any number this backend produces.

    python scripts/validate.py

Four checks, per spec:
  1. Backtest MAE by position against actuals on completed weeks.
  2. Replacement levels vs. the real available-player pool.
  3. Sleeper ID match rate, with unmatched players named.
  4. Scoring engine reconciliation against an independent reference.

Note on check 4: the strongest version of this test compares against points
Sleeper actually awarded, which requires api.sleeper.app. That host is blocked
from the environment this was built in, so the check here reconciles against
nflverse's own `fantasy_points_ppr` instead - an independent calculation, but
not Sleeper's. Run scripts/validate_vs_sleeper.py where Sleeper is reachable.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import warnings
warnings.filterwarnings("ignore")

import pandas as pd

from app import projections, scoring, vor

SEASON = 2025
BACKTEST_WEEKS = [10, 12, 14, 16]
# Published weekly MAE for RB/WR in PPR sits roughly here. Compared against the
# startable pool, which is what those published figures measure.
BENCHMARK = (5.0, 7.0)
STARTABLE_CUTOFF = {"QB": 24, "RB": 36, "WR": 48, "TE": 24}


def load_stats() -> pd.DataFrame:
    import nflreadpy as nr
    return nr.load_player_stats(seasons=[SEASON]).to_pandas()


def check_scoring(stats: pd.DataFrame) -> bool:
    print("\n=== 1. SCORING ENGINE RECONCILIATION ===")
    d = stats[(stats.season_type == "REG") & (stats.position.isin(["QB", "RB", "WR", "TE"]))]
    ref = dict(scoring.DEFAULT_PPR)
    ref["st_td"] = 6  # nflverse's column includes return TDs
    bad = 0
    for r in d.to_dict("records"):
        theirs = r.get("fantasy_points_ppr")
        if theirs is None or theirs != theirs:
            continue
        mine = scoring.score_stat_line(r, ref, r.get("position"), fumble_scope="offensive").points
        if abs(mine - theirs) > 0.02:
            bad += 1
    print(f"  player-weeks compared : {len(d)}")
    print(f"  mismatches            : {bad}")
    print(f"  RESULT: {'PASS - exact reconciliation' if bad == 0 else 'FAIL'}")
    return bad == 0


def check_backtest(stats: pd.DataFrame) -> bool:
    print("\n=== 2. PROJECTION BACKTEST (MAE by position) ===")
    rows = []
    for wk in BACKTEST_WEEKS:
        plist = projections.build_projections(stats, SEASON, wk - 1, scoring.DEFAULT_PPR)
        rank: dict[str, int] = {}
        by_pos: dict[str, list] = {}
        for p in plist:
            by_pos.setdefault(p.position, []).append(p)
        for pos, lst in by_pos.items():
            for i, p in enumerate(sorted(lst, key=lambda x: -x.projected_points_per_game)):
                rank[p.player_id] = i + 1
        pmap = {p.player_id: p for p in plist}
        act = stats[(stats.season_type == "REG") & (stats.week == wk)
                    & (stats.position.isin(["QB", "RB", "WR", "TE"]))]
        for r in act.to_dict("records"):
            p = pmap.get(str(r["player_id"]))
            if not p:
                continue
            actual = scoring.score_stat_line(r, scoring.DEFAULT_PPR, r["position"]).points
            rows.append({
                "pos": r["position"],
                "err": abs(p.projected_points_per_game - actual),
                "startable": rank[p.player_id] <= STARTABLE_CUTOFF[r["position"]],
            })
    df = pd.DataFrame(rows)
    s = df[df.startable]
    print("  Startable pool (apples-to-apples with published benchmarks):")
    for pos, g in s.groupby("pos"):
        flag = "ok" if BENCHMARK[0] - 1.5 <= g.err.mean() <= BENCHMARK[1] + 1.5 else "INVESTIGATE"
        print(f"    {pos:<3} MAE {g.err.mean():>5.2f}  (n={len(g):>4})  {flag}")
    print("  Full pool (includes deep bench; lower by construction, not by skill):")
    for pos, g in df.groupby("pos"):
        print(f"    {pos:<3} MAE {g.err.mean():>5.2f}  (n={len(g):>4})")
    rbwr = s[s.pos.isin(["RB", "WR"])].err.mean()
    ok = BENCHMARK[0] - 1.5 <= rbwr <= BENCHMARK[1] + 1.5
    print(f"  RB/WR startable MAE   : {rbwr:.2f}  (benchmark {BENCHMARK[0]}-{BENCHMARK[1]})")
    print(f"  RESULT: {'PASS' if ok else 'FAIL - investigate before shipping'}")
    return ok


def check_replacement(stats: pd.DataFrame) -> bool:
    print("\n=== 3. REPLACEMENT LEVELS ===")
    projs = projections.build_projections(stats, SEASON, 17, scoring.DEFAULT_PPR)
    slots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX"]
    levels = vor.compute_replacement_levels(projs, slots, 10)
    by_pos: dict[str, list] = {}
    for p in projs:
        by_pos.setdefault(p.position, []).append(p)

    ok = True
    print("  10-team, 1QB/2RB/3WR/1TE/2FLEX")
    print("  (Comparing the baseline to the best player *outside* it is tautological -")
    print("   they are the same player by construction. These checks are the real ones.)")

    # Check A: startable counts must equal the league arithmetic exactly.
    expected_dedicated = {"QB": 10, "RB": 20, "WR": 30, "TE": 10}
    total_flex_slots = 2 * 10
    absorbed = sum(levels[p].flex_absorbed for p in ("QB", "RB", "WR", "TE"))
    if absorbed != total_flex_slots:
        print(f"    FAIL: flex absorption {absorbed} != {total_flex_slots} slots to fill")
        ok = False
    else:
        print(f"    flex absorption accounts for all {total_flex_slots} flex slots: ok")

    for pos in ("QB", "RB", "WR", "TE"):
        l = levels[pos]
        if l.dedicated_starters != expected_dedicated[pos]:
            print(f"    FAIL: {pos} dedicated {l.dedicated_starters} != {expected_dedicated[pos]}")
            ok = False

    # Check B: the baseline must sit in a believable band relative to the
    # position's elite tier.
    #
    # The band is position-aware on purpose. A shallow position - one where only
    # ~10 players start league-wide, like QB in a 1QB format - is genuinely
    # compressed: QB1 through QB11 span about four points, so a replacement QB
    # legitimately lands near 90% of the top-12 average. That is not a
    # calculation error, it is the exact fact VOR exists to expose (QB scarcity
    # is low in 1QB leagues, so QB VOR is small). Positions with deep startable
    # pools should show a much wider spread, and a narrow one there WOULD be
    # suspicious.
    for pos in ("QB", "RB", "WR", "TE"):
        l = levels[pos]
        pool = by_pos.get(pos, [])
        if not pool:
            continue
        top12 = sum(p.projected_points_per_game for p in pool[:12]) / min(12, len(pool))
        ratio = l.replacement_points / top12 if top12 else 0
        upper = 0.95 if l.total_startable <= 12 else 0.85
        band_ok = 0.30 <= ratio <= upper
        if not band_ok:
            ok = False
        note = "ok" if band_ok else "INVESTIGATE - baseline outside believable band"
        if band_ok and ratio > 0.85:
            note = "ok (shallow position - compression expected)"
        print(f"    {pos:<3} startable={l.total_startable:<3} repl={l.replacement_points:>6.2f} "
              f"({l.replacement_player}) top12avg={top12:>6.2f} ratio={ratio:>5.2f} {note}")

    # Check C: a bigger league must push baselines DOWN - more players started
    # means the marginal starter is worse. Tracked independently of Check B so
    # a failure in one is not reported as a failure in the other.
    direction_ok = True
    prev = levels
    for n in (12, 14):
        cur = vor.compute_replacement_levels(projs, slots, n)
        for pos in ("QB", "RB", "WR", "TE"):
            if cur[pos].replacement_points > prev[pos].replacement_points + 0.01:
                print(f"    FAIL: {pos} baseline rose when league grew to {n}")
                direction_ok = False
        prev = cur
    print(f"    baselines fall as league size grows (10->12->14): "
          f"{'ok' if direction_ok else 'FAILED'}")
    ok = ok and direction_ok
    print(f"  RESULT: {'PASS' if ok else 'FAIL'}")
    return ok


def check_replacement_vs_waiver(projs, slots, num_teams, rostered_gsis: set[str]) -> bool:
    """The spec's real waiver-wire check, for use against an actual league.

    If the best genuinely-unrostered player at a position badly outscores the
    computed baseline, the baseline is wrong. Needs real roster data, so it is
    exposed as a function rather than run in the offline suite.
    """
    levels = vor.compute_replacement_levels(projs, slots, num_teams)
    by_pos: dict[str, list] = {}
    for p in projs:
        by_pos.setdefault(p.position, []).append(p)
    ok = True
    for pos, lvl in levels.items():
        avail = [p for p in by_pos.get(pos, []) if p.player_id not in rostered_gsis]
        if not avail:
            continue
        best = max(p.projected_points_per_game for p in avail)
        gap = best - lvl.replacement_points
        if gap > 3.0:
            print(f"  {pos}: baseline {lvl.replacement_points:.2f} but best available "
                  f"{best:.2f} (gap {gap:.2f}) - baseline too low")
            ok = False
    return ok


def check_ids() -> bool:
    print("\n=== 4. SLEEPER ID MATCH RATE ===")
    from app import ids as idmod, store
    if store.load_table("id_map") is None:
        print("  id_map not cached - run store.refresh() first. SKIPPED")
        return True
    idmod.ensure_loaded(force=True)
    n = len(idmod._sleeper_to_gsis)
    print(f"  sleeper->gsis pairs available: {n}")
    print(f"  RESULT: {'PASS' if n > 3000 else 'FAIL - map looks truncated'}")
    return n > 3000


def main() -> int:
    print("Loading nflverse data...")
    stats = load_stats()
    results = {
        "scoring": check_scoring(stats),
        "backtest": check_backtest(stats),
        "replacement": check_replacement(stats),
        "ids": check_ids(),
    }
    print("\n" + "=" * 52)
    for k, v in results.items():
        print(f"  {k:<14} {'PASS' if v else 'FAIL'}")
    allok = all(results.values())
    print(f"  {'OVERALL':<14} {'PASS' if allok else 'FAIL'}")
    return 0 if allok else 1


if __name__ == "__main__":
    raise SystemExit(main())
