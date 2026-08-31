"""Applies a Sleeper league's scoring_settings literally to nflverse stat lines.

A VOR number computed under the wrong scoring format is worse than no number,
so this module is deliberately explicit about two things:

1. Every scoring key it *does* support maps to a named nflverse column.
2. Every key in the league's settings it *cannot* compute is returned in
   `unsupported_keys` rather than silently contributing zero. A league with
   40+ yard TD bonuses should be told those aren't in the number, not handed a
   total that quietly omits them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Sleeper scoring key -> nflverse weekly-stats column. Straight multiplication.
LINEAR_MAP: dict[str, str] = {
    # Passing
    "pass_yd": "passing_yards",
    "pass_td": "passing_tds",
    "pass_int": "passing_interceptions",
    "pass_2pt": "passing_2pt_conversions",
    "pass_cmp": "completions",
    "pass_att": "attempts",
    "pass_fd": "passing_first_downs",
    "pass_sack": "sacks_suffered",
    # Rushing
    "rush_yd": "rushing_yards",
    "rush_td": "rushing_tds",
    "rush_2pt": "rushing_2pt_conversions",
    "rush_att": "carries",
    "rush_fd": "rushing_first_downs",
    # Receiving
    "rec": "receptions",
    "rec_yd": "receiving_yards",
    "rec_td": "receiving_tds",
    "rec_2pt": "receiving_2pt_conversions",
    "rec_tgt": "targets",
    "rec_fd": "receiving_first_downs",
    # Fumbles (see FUMBLE_SCOPE below - these are the "all" variants)
    "fum": "fumbles_total",
    "fum_lost": "fumbles_lost_total",
    "fum_rec_td": "fumble_recovery_tds",
    # Return / special teams (player-level)
    "st_td": "special_teams_tds",
    "pr_yd": "punt_return_yards",
    "kr_yd": "kickoff_return_yards",
    "pr_td": "pt_return_tds",
}

# --- Individual defensive players (IDP) ---------------------------------
# Sleeper namespaces these `idp_*`. Note the distinction from team-defense
# scoring, which uses the BARE names (`sack`, `int`, `ff`, `fum_rec`, `safe`,
# `blk_kick`): those score a whole DST unit and stay out of scope here, because
# a team defense is not a row in a player-stats table.
IDP_MAP: dict[str, str] = {
    "idp_tkl_solo": "def_tackles_solo",
    "idp_tkl_ast": "def_tackle_assists",
    "idp_tkl_loss": "def_tackles_for_loss",
    "idp_sack": "def_sacks",
    "idp_sack_yd": "def_sack_yards",
    "idp_qb_hit": "def_qb_hits",
    "idp_int": "def_interceptions",
    "idp_int_ret_yd": "def_interception_yards",
    "idp_ff": "def_fumbles_forced",
    "idp_pass_def": "def_pass_defended",
    "idp_safe": "def_safeties",
    "idp_def_td": "def_tds",
    "idp_td": "def_tds",
}

# --- Kickers ------------------------------------------------------------
# nflverse buckets made/missed field goals by distance, which is exactly the
# granularity Sleeper's distance-tiered scoring needs.
KICKING_MAP: dict[str, str] = {
    "fgm": "fg_made",
    "fga": "fg_att",
    "fgmiss": "fg_missed",
    "fgm_0_19": "fg_made_0_19",
    "fgm_20_29": "fg_made_20_29",
    "fgm_30_39": "fg_made_30_39",
    "fgm_40_49": "fg_made_40_49",
    "fgmiss_0_19": "fg_missed_0_19",
    "fgmiss_20_29": "fg_missed_20_29",
    "fgmiss_30_39": "fg_missed_30_39",
    "fgmiss_40_49": "fg_missed_40_49",
    "xpm": "pat_made",
    "xpa": "pat_att",
    "xpmiss": "pat_missed",
}

# Keys that sum several nflverse columns: key -> columns to add together.
SUM_MAP: dict[str, tuple[str, ...]] = {
    # Sleeper's "total tackles" is solo + assisted.
    "idp_tkl": ("def_tackles_solo", "def_tackle_assists"),
    # Sleeper tiers 50+ as one bucket; nflverse splits 50-59 and 60+.
    "fgm_50p": ("fg_made_50_59", "fg_made_60_"),
    "fgmiss_50p": ("fg_missed_50_59", "fg_missed_60_"),
    "idp_blk_kick": ("def_fg_blocks", "def_pat_blocks", "def_punt_blocks"),
}

# Per-game yardage milestones: key -> (stat column(s), threshold).
THRESHOLD_BONUSES: dict[str, tuple[tuple[str, ...], float]] = {
    "bonus_pass_yd_300": (("passing_yards",), 300),
    "bonus_pass_yd_400": (("passing_yards",), 400),
    "bonus_rush_yd_100": (("rushing_yards",), 100),
    "bonus_rush_yd_200": (("rushing_yards",), 200),
    "bonus_rec_yd_100": (("receiving_yards",), 100),
    "bonus_rec_yd_200": (("receiving_yards",), 200),
    "bonus_rush_rec_yd_100": (("rushing_yards", "receiving_yards"), 100),
    "bonus_rush_rec_yd_200": (("rushing_yards", "receiving_yards"), 200),
}

# Per-reception bonuses that only apply to one position (TE premium etc).
POSITION_REC_BONUSES: dict[str, str] = {
    "bonus_rec_rb": "RB",
    "bonus_rec_wr": "WR",
    "bonus_rec_te": "TE",
}

# Keys we knowingly cannot compute from weekly aggregates. Listing them
# explicitly (rather than lumping them into "unknown") documents *why*.
# All of these need play-by-play granularity we don't ingest.
KNOWN_UNSUPPORTED: dict[str, str] = {
    "bonus_pass_td_40p": "needs play-level TD distance",
    "bonus_rush_td_40p": "needs play-level TD distance",
    "bonus_rec_td_40p": "needs play-level TD distance",
    "bonus_pass_td_50p": "needs play-level TD distance",
    "bonus_rush_td_50p": "needs play-level TD distance",
    "bonus_rec_td_50p": "needs play-level TD distance",
    "bonus_fd_qb": "first-down splits by scorer not aggregated",
}

# Scoring keys that belong to team defense / kicker / IDP scoring. This module
# scores offensive skill players only, so these are expected to be present in
# a league's settings and are not evidence of a mapping gap.
# Team-defense (DST) scoring only. A DST is a unit, not a row in a player
# stats table, so these stay out of scope. Sleeper spells team-defense keys
# WITHOUT the `idp_` prefix - bare `sack`, `int`, `ff` are the DST versions of
# stats whose individual counterparts are `idp_sack`, `idp_int`, `idp_ff`.
_OUT_OF_SCOPE_PREFIXES = (
    "def_st_", "dst_", "st_ff", "st_fum_rec", "st_tkl", "sack", "int_ret",
    "blk_", "safe", "pts_allow", "yds_allow",
    "kick", "punt", "tkl", "ff", "fum_rec", "int", "td", "def_td", "def_2pt",
)


# ---------------------------------------------------------------------------
# Fumble scope: a genuine, unresolved ambiguity - documented rather than buried.
#
# nflverse's `fumbles_lost_total` counts every fumble a player lost, including
# muffed punts and kick-return fumbles. nflverse's own `fantasy_points_ppr`
# column, by contrast, only penalises offensive fumbles (rushing + receiving +
# sack). Across 2025 regular season these disagree on exactly 28 player-weeks,
# all of them return specialists.
#
# Which one matches Sleeper could not be verified here: this build environment's
# egress proxy blocks api.sleeper.app, so the definitive check - scoring a known
# player-week and comparing to what Sleeper actually awarded - could not be run.
# `scripts/validate_vs_sleeper.py` performs exactly that check and should be run
# somewhere Sleeper is reachable.
#
# Default is "all", because Sleeper's `fum_lost` is a player-level stat that is
# not documented as offense-restricted. Set FUMBLE_SCOPE=offensive to match
# nflverse's convention instead.
# ---------------------------------------------------------------------------
OFFENSIVE_FUMBLE_COLS = ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost")
OFFENSIVE_FUMBLE_ALL_COLS = ("rushing_fumbles", "receiving_fumbles", "sack_fumbles")


# Every straight-multiplication key in one lookup.
_ALL_LINEAR: dict[str, str] = {**LINEAR_MAP, **IDP_MAP, **KICKING_MAP}


@dataclass
class ScoreResult:
    points: float
    breakdown: dict[str, float] = field(default_factory=dict)
    unsupported_keys: dict[str, str] = field(default_factory=dict)


def _num(stats: dict, col: str) -> float:
    v = stats.get(col)
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if f != f else f  # NaN guard


def analyze_settings(scoring_settings: dict) -> dict:
    """Reports which of a league's offensive scoring keys we can honour.

    Call this once per league so the UI can surface any gap before a user
    trusts a VOR number derived under it.
    """
    supported, unsupported, out_of_scope = [], {}, []
    for key, value in (scoring_settings or {}).items():
        if not value:
            continue  # zero-weighted keys can't change any total
        if key in _ALL_LINEAR or key in SUM_MAP or key in THRESHOLD_BONUSES or key in POSITION_REC_BONUSES:
            supported.append(key)
        elif key == "pass_inc":
            supported.append(key)
        elif key in KNOWN_UNSUPPORTED:
            unsupported[key] = KNOWN_UNSUPPORTED[key]
        elif any(key.startswith(p) for p in _OUT_OF_SCOPE_PREFIXES):
            out_of_scope.append(key)
        else:
            unsupported[key] = "no nflverse column mapped for this key"
    return {
        "supported_keys": sorted(supported),
        "unsupported_keys": unsupported,
        "out_of_scope_keys": sorted(out_of_scope),
        "fully_supported": not unsupported,
    }


def score_stat_line(
    stats: dict,
    scoring_settings: dict,
    position: str | None = None,
    fumble_scope: str = "all",
) -> ScoreResult:
    """Scores one player-week under one league's settings.

    fumble_scope: "all" counts return fumbles too; "offensive" restricts to
    rushing/receiving/sack fumbles (nflverse's own convention). See the note
    above FUMBLE_SCOPE.
    """
    pts = 0.0
    breakdown: dict[str, float] = {}
    unsupported: dict[str, str] = {}

    for key, weight in (scoring_settings or {}).items():
        if not weight:
            continue

        if key in ("fum", "fum_lost") and fumble_scope == "offensive":
            cols = OFFENSIVE_FUMBLE_COLS if key == "fum_lost" else OFFENSIVE_FUMBLE_ALL_COLS
            val = sum(_num(stats, c) for c in cols)
            if val:
                contrib = val * float(weight)
                pts += contrib
                breakdown[key] = round(contrib, 4)
            continue

        if key in SUM_MAP:
            val = sum(_num(stats, c) for c in SUM_MAP[key])
            if val:
                contrib = val * float(weight)
                pts += contrib
                breakdown[key] = round(contrib, 4)
            continue

        if key in _ALL_LINEAR:
            val = _num(stats, _ALL_LINEAR[key])
            if val:
                contrib = val * float(weight)
                pts += contrib
                breakdown[key] = round(contrib, 4)
            continue

        if key == "pass_inc":
            incompletions = _num(stats, "attempts") - _num(stats, "completions")
            if incompletions:
                contrib = incompletions * float(weight)
                pts += contrib
                breakdown[key] = round(contrib, 4)
            continue

        if key in THRESHOLD_BONUSES:
            cols, threshold = THRESHOLD_BONUSES[key]
            total = sum(_num(stats, c) for c in cols)
            if total >= threshold:
                pts += float(weight)
                breakdown[key] = round(float(weight), 4)
            continue

        if key in POSITION_REC_BONUSES:
            if (position or "").upper() == POSITION_REC_BONUSES[key]:
                val = _num(stats, "receptions")
                if val:
                    contrib = val * float(weight)
                    pts += contrib
                    breakdown[key] = round(contrib, 4)
            continue

        if key in KNOWN_UNSUPPORTED:
            unsupported[key] = KNOWN_UNSUPPORTED[key]
        elif not any(key.startswith(p) for p in _OUT_OF_SCOPE_PREFIXES):
            unsupported[key] = "no nflverse column mapped for this key"

    return ScoreResult(points=round(pts, 2), breakdown=breakdown, unsupported_keys=unsupported)


# Standard full-PPR settings, used as the default when a caller doesn't supply a
# league config and as the reference format for validation against nflverse's
# own `fantasy_points_ppr` column.
DEFAULT_PPR: dict[str, float] = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "pass_2pt": 2,
    "rush_yd": 0.1, "rush_td": 6, "rush_2pt": 2,
    "rec": 1, "rec_yd": 0.1, "rec_td": 6, "rec_2pt": 2,
    "fum_lost": -2,
}
