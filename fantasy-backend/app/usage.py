"""Real opportunity trends from nflverse.

This module exists to replace a fabrication. The frontend previously generated
snap/target "trends" from a hash of the player's ID - deterministic noise with a
disclaimer attached. Everything here is measured from actual game logs instead:
targets, carries, target share and snap share, compared between a recent window
and everything before it.

"His role is growing" is a claim, and a claim needs evidence. This is the
evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import pandas as pd

# Metrics we track direction on. Opportunity only - efficiency is too noisy
# week to week to call a "trend" over a handful of games.
TREND_METRICS = ("targets", "carries", "target_share", "snap_share")

# A change smaller than this is called stable rather than dressed up as a trend.
# Expressed as a fraction of the prior average, so it scales with volume.
MEANINGFUL_CHANGE = 0.15


@dataclass
class UsageTrend:
    player_id: str
    games_in_window: int
    games_in_prior: int
    recent: dict[str, float]
    prior: dict[str, float]
    delta_pct: dict[str, float | None]
    direction: str | None          # rising | falling | stable | None (no basis)
    direction_basis: str           # what the call was actually made on

    def to_dict(self) -> dict:
        return asdict(self)


def _mean(df: pd.DataFrame, col: str) -> float:
    if col not in df.columns or df.empty:
        return 0.0
    return float(pd.to_numeric(df[col], errors="coerce").fillna(0).mean())


def compute_usage_trends(
    stats: pd.DataFrame,
    season: int,
    as_of_week: int,
    window: int = 4,
    snap_share_by_key: dict[tuple[str, int], float] | None = None,
    gsis_to_pfr: dict[str, str] | None = None,
) -> dict[str, UsageTrend]:
    """Recent-window vs prior-window opportunity, per player.

    Uses only weeks <= as_of_week so this is safe for backtesting and honest
    for live use. A player with no prior window gets direction=None rather than
    a manufactured "stable" - one game is not a trend.
    """
    d = stats[
        (stats["season"] == season)
        & (stats["season_type"] == "REG")
        & (stats["week"] <= as_of_week)
    ].copy()
    if d.empty:
        return {}

    for c in ("targets", "carries", "target_share"):
        if c not in d.columns:
            d[c] = 0.0
        d[c] = pd.to_numeric(d[c], errors="coerce").fillna(0.0)

    # Attach real snap share where we have it (joined via PFR id).
    if snap_share_by_key and gsis_to_pfr:
        d["snap_share"] = [
            snap_share_by_key.get((gsis_to_pfr.get(str(pid), ""), int(wk)), 0.0) or 0.0
            for pid, wk in zip(d["player_id"], d["week"])
        ]
    else:
        d["snap_share"] = 0.0

    out: dict[str, UsageTrend] = {}
    for pid, g in d.groupby("player_id"):
        g = g.sort_values("week")
        recent = g.tail(window)
        prior = g.iloc[: -window] if len(g) > window else g.iloc[0:0]

        rec = {m: _mean(recent, m) for m in TREND_METRICS}
        pri = {m: _mean(prior, m) for m in TREND_METRICS}

        delta_pct: dict[str, float | None] = {}
        for m in TREND_METRICS:
            if len(prior) == 0 or pri[m] <= 0:
                delta_pct[m] = None
            else:
                delta_pct[m] = round((rec[m] - pri[m]) / pri[m], 4)

        # Call direction on whichever opportunity metric this player actually
        # has volume in - targets for pass-catchers, carries for runners.
        basis = "targets" if rec["targets"] >= rec["carries"] else "carries"
        dp = delta_pct.get(basis)
        if len(prior) == 0:
            direction, basis_note = None, f"no prior window ({len(g)} game(s) played) - no trend claimed"
        elif dp is None:
            direction, basis_note = None, f"no prior {basis} volume to compare against"
        elif dp > MEANINGFUL_CHANGE:
            direction, basis_note = "rising", f"{basis} +{dp:.0%} vs earlier weeks"
        elif dp < -MEANINGFUL_CHANGE:
            direction, basis_note = "falling", f"{basis} {dp:.0%} vs earlier weeks"
        else:
            direction, basis_note = "stable", f"{basis} {dp:+.0%} vs earlier weeks"

        out[str(pid)] = UsageTrend(
            player_id=str(pid),
            games_in_window=int(len(recent)),
            games_in_prior=int(len(prior)),
            recent={k: round(v, 4) for k, v in rec.items()},
            prior={k: round(v, 4) for k, v in pri.items()},
            delta_pct=delta_pct,
            direction=direction,
            direction_basis=basis_note,
        )
    return out
