"""A deliberately simple, legible projection model.

FIRST-PASS MODEL - READ THIS BEFORE TRUSTING THE OUTPUT.

This will be worse than commercial projections (FantasyPros, PFF, 4for4). It
exists because an explainable number a user can audit beats an unexplained one
they have to take on faith. Every projection this produces exposes the volume
and efficiency assumptions that generated it, so a wrong number is *visibly*
wrong rather than mysteriously wrong.

Method, in one line: project opportunity, regress efficiency, multiply, then
score under the league's actual settings.

Why that order: opportunity (targets, carries, attempts) is far more stable
week to week than efficiency (yards per target, TD rate). Projecting fantasy
points directly bakes last month's touchdown luck into next month's forecast.
Projecting volume and regressing efficiency toward the positional mean does not.

Everything is computed "as of" a week, using only weeks <= as_of_week. That
makes the model honest for live use and makes backtesting trivial: project
week 12 with as_of_week=11 and compare to what actually happened.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

from . import scoring

# Recency weighting: the last 4 games carry more signal about a player's
# current role than the season average, but not so much that one outlier game
# dominates. 65/35 is a judgement call, not a fitted parameter.
RECENT_WINDOW = 4
RECENT_WEIGHT = 0.65
SEASON_WEIGHT = 0.35

# Shrinkage strength, expressed in "equivalent opportunities" of the positional
# prior. Larger = trust the league mean more and the player's own sample less.
# TD rates get the heaviest shrinkage because they are the noisiest thing on
# this page: a 3-TD game is mostly variance, not a repeatable skill.
SHRINK = {
    "yards_per_target": 30.0,
    "yards_per_carry": 40.0,
    "td_per_target": 70.0,
    "td_per_carry": 70.0,
    "yards_per_attempt": 100.0,
    "td_per_attempt": 120.0,
    "int_per_attempt": 120.0,
    "rec_per_target": 25.0,
}

VOLUME_COLS = ["targets", "carries", "attempts"]


@dataclass
class PlayerProjection:
    """One player's weekly projection, with the assumptions that produced it."""

    player_id: str
    name: str | None
    position: str | None
    team: str | None
    games_sampled: int
    # Projected per-game opportunity
    proj_targets: float
    proj_carries: float
    proj_attempts: float
    # Regressed per-opportunity efficiency
    yards_per_target: float
    yards_per_carry: float
    yards_per_attempt: float
    # Resulting projected per-game stat line
    projected_stats: dict = field(default_factory=dict)
    # Points under the league's settings
    projected_points_per_game: float = 0.0
    points_breakdown: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in (
            "proj_targets", "proj_carries", "proj_attempts",
            "yards_per_target", "yards_per_carry", "yards_per_attempt",
            "projected_points_per_game",
        ):
            d[k] = round(float(d[k]), 3)
        d["projected_stats"] = {k: round(float(v), 3) for k, v in d["projected_stats"].items()}
        return d


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return float(num) / float(den) if den else default


def _positional_priors(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    """League-wide efficiency means per position - the shrinkage target."""
    priors: dict[str, dict[str, float]] = {}
    for pos, g in df.groupby("position"):
        tgt = g["targets"].sum()
        car = g["carries"].sum()
        att = g["attempts"].sum()
        priors[pos] = {
            "yards_per_target": _safe_div(g["receiving_yards"].sum(), tgt),
            "td_per_target": _safe_div(g["receiving_tds"].sum(), tgt),
            "rec_per_target": _safe_div(g["receptions"].sum(), tgt, 0.65),
            "yards_per_carry": _safe_div(g["rushing_yards"].sum(), car),
            "td_per_carry": _safe_div(g["rushing_tds"].sum(), car),
            "yards_per_attempt": _safe_div(g["passing_yards"].sum(), att),
            "td_per_attempt": _safe_div(g["passing_tds"].sum(), att),
            "int_per_attempt": _safe_div(g["passing_interceptions"].sum(), att),
        }
    return priors


def _shrink(player_num: float, player_den: float, prior_rate: float, k: float) -> float:
    """Empirical-Bayes style shrinkage toward the positional prior.

    With few opportunities the estimate is essentially the positional mean;
    as the sample grows it converges on the player's own rate. This is what
    stops a WR with 3 targets and 2 touchdowns from projecting as a superstar.
    """
    return (player_num + k * prior_rate) / (player_den + k)


def build_projections(
    stats: pd.DataFrame,
    season: int,
    as_of_week: int,
    scoring_settings: dict | None = None,
    positions: tuple[str, ...] = ("QB", "RB", "WR", "TE"),
    fumble_scope: str = "all",
    min_games: int = 1,
) -> list[PlayerProjection]:
    """Projects per-game points for every player with data through as_of_week.

    Uses only weeks <= as_of_week, so this is safe for backtesting.
    """
    scoring_settings = scoring_settings or scoring.DEFAULT_PPR

    df = stats[
        (stats["season"] == season)
        & (stats["season_type"] == "REG")
        & (stats["week"] <= as_of_week)
        & (stats["position"].isin(positions))
    ].copy()
    if df.empty:
        return []

    numeric_needed = [
        "targets", "carries", "attempts", "receptions", "receiving_yards",
        "receiving_tds", "rushing_yards", "rushing_tds", "passing_yards",
        "passing_tds", "passing_interceptions", "receiving_first_downs",
        "rushing_first_downs", "passing_first_downs", "fumbles_lost_total",
        "rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost",
        "completions", "sacks_suffered",
    ]
    for c in numeric_needed:
        if c not in df.columns:
            df[c] = 0.0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    priors = _positional_priors(df)
    out: list[PlayerProjection] = []

    for pid, g in df.groupby("player_id"):
        g = g.sort_values("week")
        games = len(g)
        if games < min_games:
            continue

        pos = str(g["position"].iloc[-1])
        prior = priors.get(pos, {})
        recent = g.tail(RECENT_WINDOW)

        # --- Opportunity: recency-weighted per-game volume ---
        vol: dict[str, float] = {}
        for col in VOLUME_COLS:
            season_pg = g[col].sum() / games
            recent_pg = recent[col].sum() / len(recent)
            vol[col] = RECENT_WEIGHT * recent_pg + SEASON_WEIGHT * season_pg

        # --- Efficiency: regressed toward the positional mean by sample size ---
        tgt, car, att = g["targets"].sum(), g["carries"].sum(), g["attempts"].sum()

        ypt = _shrink(g["receiving_yards"].sum(), tgt, prior.get("yards_per_target", 7.0), SHRINK["yards_per_target"])
        tdpt = _shrink(g["receiving_tds"].sum(), tgt, prior.get("td_per_target", 0.05), SHRINK["td_per_target"])
        rpt = _shrink(g["receptions"].sum(), tgt, prior.get("rec_per_target", 0.65), SHRINK["rec_per_target"])
        ypc = _shrink(g["rushing_yards"].sum(), car, prior.get("yards_per_carry", 4.2), SHRINK["yards_per_carry"])
        tdpc = _shrink(g["rushing_tds"].sum(), car, prior.get("td_per_carry", 0.03), SHRINK["td_per_carry"])
        ypa = _shrink(g["passing_yards"].sum(), att, prior.get("yards_per_attempt", 7.0), SHRINK["yards_per_attempt"])
        tdpa = _shrink(g["passing_tds"].sum(), att, prior.get("td_per_attempt", 0.045), SHRINK["td_per_attempt"])
        intpa = _shrink(g["passing_interceptions"].sum(), att, prior.get("int_per_attempt", 0.025), SHRINK["int_per_attempt"])

        # First downs and fumbles are modelled as simple per-game rates: they
        # matter only in leagues that score them, and inventing a regression
        # for them would add opacity without adding accuracy.
        fd_rec_pg = g["receiving_first_downs"].sum() / games
        fd_rush_pg = g["rushing_first_downs"].sum() / games
        fd_pass_pg = g["passing_first_downs"].sum() / games
        fum_pg = g["fumbles_lost_total"].sum() / games
        off_fum_pg = (
            g["rushing_fumbles_lost"].sum() + g["receiving_fumbles_lost"].sum() + g["sack_fumbles_lost"].sum()
        ) / games
        cmp_rate = _safe_div(g["completions"].sum(), att, 0.63)
        sack_pg = g["sacks_suffered"].sum() / games

        # --- Multiply out into a projected per-game stat line ---
        projected_stats = {
            "targets": vol["targets"],
            "receptions": vol["targets"] * rpt,
            "receiving_yards": vol["targets"] * ypt,
            "receiving_tds": vol["targets"] * tdpt,
            "receiving_first_downs": fd_rec_pg,
            "carries": vol["carries"],
            "rushing_yards": vol["carries"] * ypc,
            "rushing_tds": vol["carries"] * tdpc,
            "rushing_first_downs": fd_rush_pg,
            "attempts": vol["attempts"],
            "completions": vol["attempts"] * cmp_rate,
            "passing_yards": vol["attempts"] * ypa,
            "passing_tds": vol["attempts"] * tdpa,
            "passing_interceptions": vol["attempts"] * intpa,
            "passing_first_downs": fd_pass_pg,
            "sacks_suffered": sack_pg,
            "fumbles_lost_total": fum_pg,
            "rushing_fumbles_lost": off_fum_pg,
            "receiving_fumbles_lost": 0.0,
            "sack_fumbles_lost": 0.0,
        }

        scored = scoring.score_stat_line(projected_stats, scoring_settings, pos, fumble_scope=fumble_scope)

        out.append(
            PlayerProjection(
                player_id=str(pid),
                name=str(g["player_display_name"].iloc[-1]) if "player_display_name" in g else None,
                position=pos,
                team=str(g["team"].iloc[-1]) if "team" in g else None,
                games_sampled=games,
                proj_targets=vol["targets"],
                proj_carries=vol["carries"],
                proj_attempts=vol["attempts"],
                yards_per_target=ypt,
                yards_per_carry=ypc,
                yards_per_attempt=ypa,
                projected_stats=projected_stats,
                projected_points_per_game=scored.points,
                points_breakdown=scored.breakdown,
            )
        )

    out.sort(key=lambda p: p.projected_points_per_game, reverse=True)
    return out


def rest_of_season(projections: list[PlayerProjection], as_of_week: int, final_week: int = 18) -> dict[str, float]:
    """Weekly projection x games remaining.

    Note this assumes a player plays every remaining game - it does not model
    injury risk or bye weeks. For a completed season this correctly returns
    zero remaining games rather than pretending there is season left to play.
    """
    games_left = max(0, final_week - as_of_week)
    return {p.player_id: round(p.projected_points_per_game * games_left, 2) for p in projections}
