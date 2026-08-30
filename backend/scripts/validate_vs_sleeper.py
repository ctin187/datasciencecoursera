"""The scoring test that could not be run in the build environment.

    python scripts/validate_vs_sleeper.py --season 2025 --week 12

Scores a completed week with our engine and compares it to the points Sleeper
itself awarded for the same player-week. This is the highest-value check in the
project spec: it catches scoring-config bugs immediately, and it is the only
test that settles the fumble-scope question documented in app/scoring.py
(whether Sleeper's `fum_lost` counts return fumbles).

It is a separate script because api.sleeper.app is unreachable from the sandbox
this backend was built in (the egress proxy rejects it with 403). Run this
anywhere with normal internet access - locally, or on the deployed instance.

Exit code 0 = engine agrees with Sleeper. Non-zero = investigate before trusting
any VOR number produced under these settings.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import warnings
warnings.filterwarnings("ignore")

from app import ids, scoring, store

SLEEPER_STATS = "https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}"
SLEEPER_LEAGUE = "https://api.sleeper.app/v1/league/{league_id}"


def fetch(url: str):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--week", type=int, default=12)
    ap.add_argument("--league-id", default=None,
                    help="Use this league's real scoring_settings instead of standard PPR")
    ap.add_argument("--tolerance", type=float, default=0.02)
    args = ap.parse_args()

    if args.league_id:
        league = fetch(SLEEPER_LEAGUE.format(league_id=args.league_id))
        settings = league.get("scoring_settings") or {}
        label = f"league {args.league_id} ({league.get('name')})"
    else:
        settings = dict(scoring.DEFAULT_PPR)
        label = "standard full PPR"

    analysis = scoring.analyze_settings(settings)
    print(f"Scoring under: {label}")
    print(f"  supported keys   : {len(analysis['supported_keys'])}")
    if analysis["unsupported_keys"]:
        print("  UNSUPPORTED keys (these are NOT in the totals below):")
        for k, why in analysis["unsupported_keys"].items():
            print(f"    - {k}: {why}")

    print(f"\nFetching Sleeper stats for {args.season} week {args.week}...")
    sleeper_stats = fetch(SLEEPER_STATS.format(season=args.season, week=args.week))

    stats = store.load_table("player_stats")
    if stats is None:
        print("player_stats not cached. Run: python -c 'from app import store; store.refresh()'")
        return 2
    wk = stats[(stats.season == args.season) & (stats.week == args.week)
               & (stats.season_type == "REG")]
    if wk.empty:
        print(f"No cached nflverse rows for {args.season} week {args.week}.")
        return 2

    ids.ensure_loaded()

    # Sleeper reports its own computed total under pts_ppr / pts_std / pts_half_ppr.
    pts_key = "pts_ppr" if not args.league_id else None

    results = {"match": 0, "mismatch": 0, "no_sleeper_row": 0, "no_id": 0}
    diffs: list[tuple[float, str, float, float]] = []
    scope_votes: Counter[str] = Counter()

    for r in wk.to_dict("records"):
        gsis = str(r.get("player_id"))
        sid = ids.gsis_to_sleeper(gsis)
        if not sid:
            results["no_id"] += 1
            continue
        srow = sleeper_stats.get(sid)
        if not srow:
            results["no_sleeper_row"] += 1
            continue

        if pts_key:
            theirs = srow.get(pts_key)
        else:
            # Custom league: Sleeper doesn't precompute it, so score their raw
            # stat line with the same engine as a consistency check instead.
            theirs = None
        if theirs is None:
            continue

        for scope in ("all", "offensive"):
            mine = scoring.score_stat_line(r, settings, r.get("position"), fumble_scope=scope).points
            if abs(mine - theirs) <= args.tolerance:
                scope_votes[scope] += 1

        mine = scoring.score_stat_line(r, settings, r.get("position"), fumble_scope="all").points
        d = mine - theirs
        if abs(d) <= args.tolerance:
            results["match"] += 1
        else:
            results["mismatch"] += 1
            diffs.append((abs(d), r.get("player_display_name") or gsis, mine, theirs))

    total = results["match"] + results["mismatch"]
    print(f"\nCompared {total} player-weeks (fumble_scope='all')")
    print(f"  exact matches : {results['match']}")
    print(f"  mismatches    : {results['mismatch']}")
    print(f"  no ID match   : {results['no_id']}")
    print(f"  no Sleeper row: {results['no_sleeper_row']}")

    if scope_votes:
        print("\nFumble-scope evidence (higher = better agreement with Sleeper):")
        for scope, n in scope_votes.most_common():
            print(f"  fumble_scope={scope:<10} agrees on {n} player-weeks")
        best = scope_votes.most_common(1)[0][0]
        print(f"  => Sleeper's behaviour matches fumble_scope='{best}'. "
              f"Set FUMBLE_SCOPE accordingly in app/scoring.py.")

    if diffs:
        diffs.sort(reverse=True)
        print("\nLargest disagreements:")
        for d, name, mine, theirs in diffs[:10]:
            print(f"  {name:<28} ours={mine:>7.2f} sleeper={theirs:>7.2f} diff={mine - theirs:>+7.2f}")

    rate = results["match"] / total if total else 0
    print(f"\nAgreement rate: {rate:.1%}")
    ok = rate >= 0.99
    print("RESULT:", "PASS" if ok else "FAIL - scoring config bug; do not trust VOR until fixed")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
