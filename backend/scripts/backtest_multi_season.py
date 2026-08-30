"""Multi-season backtest: does the projection/VOR model hold up across years,
not just the single season (2025) documented in README.md?

    python scripts/backtest_multi_season.py --seasons 2022,2023,2024,2025

What this validates, per season, independently:
  1. Projection accuracy (startable-pool MAE by position, same methodology
     and benchmark band as scripts/validate.py's check_backtest).
  2. Replacement-level believability (replacement points as a fraction of
     the position's own top-12 average, same methodology as
     scripts/validate.py's check_replacement) - checking whether the
     ratios are stable year to year, or whether 2025's numbers were a
     fluke worth distrusting.

What this does NOT validate, and cannot, without a real ADP data source
this project doesn't have:
  - Draft strategy backtesting (VORP drafting vs. zero-RB vs. wait-on-QB,
    hero-RB, etc.). Those strategies are only meaningfully comparable
    against what was actually available at each historical pick, which
    needs real historical ADP - not something a free, legitimate source
    provides (see frontend/README.md's Roadmap section). This script
    backtests the MODEL, not a DRAFTING APPROACH. A clean MAE here is not
    evidence that any particular draft strategy works.

Not part of the deployed API and never run by it: loading several seasons
of player_stats in memory at once is exactly the cost config.py's SEASONS
comment says the production Render free tier (512MB) cannot absorb. This
is a local/CI-only tool, same as validate.py and validate_vs_sleeper.py.

Could not be executed in the environment this was written in: no network
access to nflverse's GitHub release assets, and pandas/nflreadpy are not
installed there. Every function it calls (projections.build_projections,
scoring.score_stat_line, vor.compute_replacement_levels) is the same code
scripts/validate.py already exercises for the 2025-only case documented in
README.md - this script is that same methodology, looped over more
seasons, not a new one. Run it somewhere with normal internet access
before trusting its output, and read its results as a check on the
model, not as a guarantee.
"""
from __future__ import annotations

import argparse
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
warnings.filterwarnings("ignore")

import pandas as pd

from app import projections, scoring, vor

BACKTEST_WEEKS = [10, 12, 14, 16]
# Published weekly MAE for RB/WR in PPR sits roughly here, measured against
# the startable pool - same benchmark scripts/validate.py uses.
BENCHMARK = (5.0, 7.0)
STARTABLE_CUTOFF = {"QB": 24, "RB": 36, "WR": 48, "TE": 24}
STANDARD_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX"]
STANDARD_TEAMS = 10


def load_stats(seasons: list[int]) -> pd.DataFrame:
    import nflreadpy as nr
    return nr.load_player_stats(seasons=seasons).to_pandas()


def backtest_one_season(stats: pd.DataFrame, season: int) -> dict:
    """Same methodology as scripts/validate.py's check_backtest, isolated to
    one season and returning a result dict instead of printing directly, so
    main() can line seasons up side by side."""
    d = stats[stats["season"] == season]
    if d.empty:
        return {"season": season, "error": "no data cached for this season"}

    weeks_present = set(int(w) for w in d["week"].unique())
    rows = []
    for wk in BACKTEST_WEEKS:
        if wk not in weeks_present or (wk - 1) not in weeks_present:
            continue  # season too short to have this week - skip rather than fabricate a comparison

        plist = projections.build_projections(d, season, wk - 1, scoring.DEFAULT_PPR)
        rank: dict[str, int] = {}
        by_pos: dict[str, list] = {}
        for p in plist:
            by_pos.setdefault(p.position, []).append(p)
        for pos, lst in by_pos.items():
            for i, p in enumerate(sorted(lst, key=lambda x: -x.projected_points_per_game)):
                rank[p.player_id] = i + 1
        pmap = {p.player_id: p for p in plist}

        act = stats[
            (stats["season"] == season) & (stats["season_type"] == "REG")
            & (stats["week"] == wk) & (stats["position"].isin(["QB", "RB", "WR", "TE"]))
        ]
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

    if not rows:
        return {"season": season, "error": "no comparable weeks found (season too short, or not cached)"}

    df = pd.DataFrame(rows)
    s = df[df.startable]
    by_pos_mae = {pos: round(g.err.mean(), 2) for pos, g in s.groupby("pos")}
    rbwr_pool = s[s.pos.isin(["RB", "WR"])]
    rbwr = round(rbwr_pool.err.mean(), 2) if not rbwr_pool.empty else None
    return {
        "season": season,
        "n": len(df),
        "startable_mae_by_pos": by_pos_mae,
        "rbwr_startable_mae": rbwr,
        "in_benchmark_band": (BENCHMARK[0] - 1.5 <= rbwr <= BENCHMARK[1] + 1.5) if rbwr is not None else None,
    }


def replacement_stability_one_season(stats: pd.DataFrame, season: int) -> dict:
    """Same methodology as scripts/validate.py's check_replacement Check B, isolated to one season."""
    d = stats[stats["season"] == season]
    if d.empty:
        return {"season": season, "error": "no data cached for this season"}
    max_week = int(d["week"].max())
    projs = projections.build_projections(d, season, max_week, scoring.DEFAULT_PPR)
    if not projs:
        return {"season": season, "error": "no projections could be built"}
    levels = vor.compute_replacement_levels(projs, STANDARD_SLOTS, STANDARD_TEAMS)

    by_pos: dict[str, list] = {}
    for p in projs:
        by_pos.setdefault(p.position, []).append(p)

    ratios: dict[str, float] = {}
    for pos in ("QB", "RB", "WR", "TE"):
        pool = by_pos.get(pos, [])
        if not pool:
            continue
        top12 = sum(p.projected_points_per_game for p in pool[:12]) / min(12, len(pool))
        if top12:
            ratios[pos] = round(levels[pos].replacement_points / top12, 3)
    return {"season": season, "as_of_week": max_week, "replacement_to_top12_ratio": ratios}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", default="2022,2023,2024,2025", help="Comma-separated seasons to backtest")
    args = parser.parse_args()
    seasons = [int(s.strip()) for s in args.seasons.split(",") if s.strip()]

    print(f"Loading nflverse player stats for seasons {seasons} (several seasons can take a while)...")
    stats = load_stats(seasons)

    print("\n=== 1. PROJECTION ACCURACY BY SEASON ===")
    print(f"    (startable-pool MAE, RB/WR benchmark {BENCHMARK[0]}-{BENCHMARK[1]}, same method as validate.py)")
    any_outside_band = False
    for season in seasons:
        r = backtest_one_season(stats, season)
        if "error" in r:
            print(f"  {season}: {r['error']}")
            continue
        if r["rbwr_startable_mae"] is None:
            print(f"  {season}: no RB/WR startable player-weeks found")
            continue
        band = "ok" if r["in_benchmark_band"] else "OUTSIDE BAND - investigate"
        any_outside_band = any_outside_band or not r["in_benchmark_band"]
        print(f"  {season}: RB/WR startable MAE = {r['rbwr_startable_mae']}  (n={r['n']})  {band}")
        for pos, mae in sorted(r["startable_mae_by_pos"].items()):
            print(f"      {pos:<3} MAE {mae}")

    print("\n=== 2. REPLACEMENT-LEVEL STABILITY BY SEASON ===")
    print("    (replacement points / position's own top-12 average, 10-team 1QB/2RB/3WR/1TE/2FLEX)")
    for season in seasons:
        r = replacement_stability_one_season(stats, season)
        if "error" in r:
            print(f"  {season}: {r['error']}")
            continue
        ratios_str = ", ".join(f"{pos}={ratio}" for pos, ratio in sorted(r["replacement_to_top12_ratio"].items()))
        print(f"  {season} (as of week {r['as_of_week']}): {ratios_str}")

    print("\n" + "=" * 72)
    print(f"RESULT: {'one or more seasons fell outside the MAE benchmark band - investigate before trusting projections for that season' if any_outside_band else 'projection accuracy held inside the benchmark band across all seasons with comparable data'}")
    print("\nReminder: this validates the PROJECTION/VOR MODEL across seasons, not")
    print("any draft strategy. Strategy backtesting (VORP vs. zero-RB, wait-on-QB,")
    print("etc.) needs real historical ADP data this project has no legitimate free")
    print("source for, and is not implemented here or anywhere in this app.")
    return 1 if any_outside_band else 0


if __name__ == "__main__":
    raise SystemExit(main())
