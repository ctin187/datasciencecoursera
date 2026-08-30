"""FastAPI surface.

Two rules hold everywhere in this file:

1. No request handler touches the network. Everything reads the on-disk parquet
   cache that `store.refresh()` populates.
2. Every response carries a `provenance` block (data_as_of, staleness, last
   error). An endpoint returning confident-looking numbers from three-week-old
   data with no indication is worse than one returning an error.
"""
from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, ids, projections, scoring, store, usage, vor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

app = FastAPI(
    title="Fantasy Dynasty Backend",
    description="nflverse-backed stats, projections and Value Over Replacement for Sleeper leagues.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,  # explicit list, never "*"
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    store.ensure_fresh_background()
    store.start_scheduler()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _require(table: str) -> pd.DataFrame:
    df = store.load_table(table)
    if df is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"'{table}' is not cached yet",
                "hint": "The first refresh may still be running. Retry shortly, or POST /admin/refresh.",
                "provenance": store.provenance(),
            },
        )
    return df


def _clean(v):
    """JSON-safe scalar: NaN/NaT -> None so nulls stay nulls."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if f != f else round(f, 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if pd.isna(v):
        return None
    return v


def _parse_scoring(raw: str | None) -> dict:
    if not raw:
        return scoring.DEFAULT_PPR
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"scoring must be valid JSON: {exc}")
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="scoring must be a JSON object")
    return parsed


def _snap_share_lookup(season: int, week: int | None) -> dict[tuple[str, int], float]:
    """(pfr_player_id, week) -> offensive snap share."""
    snaps = store.load_table("snap_counts")
    if snaps is None:
        return {}
    s = snaps[(snaps["season"] == season) & (snaps["game_type"] == "REG")]
    if week is not None:
        s = s[s["week"] == week]
    out: dict[tuple[str, int], float] = {}
    for r in s.itertuples(index=False):
        pid = getattr(r, "pfr_player_id", None)
        if isinstance(pid, str):
            out[(pid, int(r.week))] = getattr(r, "offense_pct", None)
    return out


def _gsis_to_pfr() -> dict[str, str]:
    players = store.load_table("players")
    if players is None or "pfr_id" not in players.columns:
        return {}
    return {
        str(r.gsis_id): str(r.pfr_id)
        for r in players.itertuples(index=False)
        if isinstance(getattr(r, "gsis_id", None), str) and isinstance(getattr(r, "pfr_id", None), str)
    }


# Fields the spec asks for that no free nflverse source provides. Returned as
# null with a stated reason rather than zero-filled - a zero would read as
# "ran no routes", which is a different claim from "we don't have this".
UNAVAILABLE_FIELDS = {
    "routes_run": "not published by nflverse; routes run is a PFF/FTN-licensed metric requiring a paid feed",
}

# Stats that are meaningless for a position, so they are nulled rather than
# zeroed: a QB with null target_share and a QB with 0.0 target_share are
# different claims, and only one of them is true.
_POSITION_IRRELEVANT = {
    "QB": ("targets", "target_share", "air_yards_share", "receiving_air_yards", "receptions", "receiving_yards"),
    "RB": ("attempts", "completions", "passing_yards"),
    "WR": ("attempts", "completions", "passing_yards"),
    "TE": ("attempts", "completions", "passing_yards"),
}


def _null_irrelevant(rec: dict, position: str | None) -> dict:
    """Nulls stats that don't apply to a position *only* when truly unused."""
    for col in _POSITION_IRRELEVANT.get((position or "").upper(), ()):
        if rec.get(col) in (0, 0.0):
            rec[col] = None
    return rec


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    meta = store.read_meta()
    return {
        "status": "ok" if meta.last_success_utc and not meta.is_stale else "degraded",
        "provenance": store.provenance(),
        "cached_tables": meta.row_counts or {},
        "seasons": meta.seasons,
        "config": {
            "default_season": config.DEFAULT_SEASON,
            "refresh_interval_hours": config.REFRESH_INTERVAL_HOURS,
            "cors_origins": config.CORS_ORIGINS,
        },
    }


@app.post("/admin/refresh")
def admin_refresh() -> dict:
    meta = store.refresh()
    ids.ensure_loaded(force=True)
    return {"refreshed": True, "provenance": store.provenance(), "row_counts": meta.row_counts}


STAT_FIELDS = [
    "player_id", "player_display_name", "position", "team", "opponent_team",
    "season", "week", "targets", "target_share", "air_yards_share",
    "receiving_air_yards", "receptions", "receiving_yards", "receiving_tds",
    "carries", "rushing_yards", "rushing_tds", "attempts", "completions",
    "passing_yards", "passing_tds", "passing_interceptions",
    "fantasy_points", "fantasy_points_ppr",
]


@app.get("/players/stats")
def players_stats(
    season: int = Query(default=config.DEFAULT_SEASON),
    week: int | None = Query(default=None),
    position: str | None = Query(default=None),
    limit: int = Query(default=500, le=5000),
) -> dict:
    df = _require("player_stats")
    d = df[(df["season"] == season) & (df["season_type"] == "REG")]
    if week is not None:
        d = d[d["week"] == week]
    if position:
        d = d[d["position"].isin([p.strip().upper() for p in position.split(",")])]
    if d.empty:
        return {"provenance": store.provenance(), "count": 0, "players": [],
                "note": f"no regular-season rows for season={season}"
                        + (f" week={week}" if week else "")}

    snap = _snap_share_lookup(season, week)
    g2p = _gsis_to_pfr()

    out = []
    for r in d.head(limit).to_dict("records"):
        rec = {k: _clean(r.get(k)) for k in STAT_FIELDS if k in r}
        pos = r.get("position")
        rec = _null_irrelevant(rec, pos)
        # rush_share needs a team denominator, computed below per team-week
        pfr = g2p.get(str(r.get("player_id")))
        rec["snap_share"] = _clean(snap.get((pfr, int(r.get("week"))))) if pfr else None
        for f, reason in UNAVAILABLE_FIELDS.items():
            rec[f] = None
        rec["sleeper_id"] = ids.gsis_to_sleeper(str(r.get("player_id")))
        out.append(rec)

    # rush_share: player's carries / team's carries that week
    team_carries = (
        d.groupby(["team", "week"])["carries"].sum().to_dict() if "carries" in d.columns else {}
    )
    for rec, r in zip(out, d.head(limit).to_dict("records")):
        denom = team_carries.get((r.get("team"), r.get("week")), 0)
        c = r.get("carries") or 0
        rec["rush_share"] = round(float(c) / float(denom), 4) if denom else None

    return {
        "provenance": store.provenance(),
        "season": season,
        "week": week,
        "count": len(out),
        "unavailable_fields": UNAVAILABLE_FIELDS,
        "players": out,
    }


TREND_METRICS = [
    "targets", "target_share", "air_yards_share", "carries",
    "receptions", "receiving_yards", "rushing_yards", "fantasy_points_ppr",
]


@app.get("/players/trends")
def players_trends(
    player_ids: str = Query(..., description="Comma-separated GSIS or Sleeper IDs"),
    weeks: int = Query(default=4, ge=1, le=17),
    season: int = Query(default=config.DEFAULT_SEASON),
) -> dict:
    df = _require("player_stats")
    requested = [p.strip() for p in player_ids.split(",") if p.strip()]

    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for pid in requested:
        if pid.startswith("00-"):
            resolved[pid] = pid
        else:
            g = ids.sleeper_to_gsis(pid)
            (resolved.setdefault(pid, g) if g else unresolved.append(pid))

    d = df[(df["season"] == season) & (df["season_type"] == "REG")]
    results = []
    for original, gsis in resolved.items():
        g = d[d["player_id"] == gsis].sort_values("week")
        if g.empty:
            unresolved.append(original)
            continue
        recent, prior = g.tail(weeks), g.iloc[:-weeks] if len(g) > weeks else g.iloc[0:0]
        metrics = {}
        for m in TREND_METRICS:
            if m not in g.columns:
                continue
            r_avg = float(pd.to_numeric(recent[m], errors="coerce").fillna(0).mean())
            p_avg = float(pd.to_numeric(prior[m], errors="coerce").fillna(0).mean()) if len(prior) else None
            delta = (r_avg - p_avg) if p_avg is not None else None
            metrics[m] = {
                "recent_avg": round(r_avg, 3),
                "prior_avg": round(p_avg, 3) if p_avg is not None else None,
                "delta": round(delta, 3) if delta is not None else None,
                # Direction is only claimed when there is a prior window to
                # compare against; otherwise it stays null rather than "stable".
                "direction": (None if delta is None else "rising" if delta > 0.05 else "falling" if delta < -0.05 else "stable"),
            }
        results.append({
            "player_id": gsis,
            "requested_as": original,
            "sleeper_id": ids.gsis_to_sleeper(gsis),
            "name": _clean(g["player_display_name"].iloc[-1]) if "player_display_name" in g else None,
            "position": _clean(g["position"].iloc[-1]),
            "weeks_in_window": int(len(recent)),
            "weeks_in_prior": int(len(prior)),
            "metrics": metrics,
        })

    return {
        "provenance": store.provenance(),
        "season": season,
        "window_weeks": weeks,
        "unresolved_ids": unresolved,
        "players": results,
    }


def _projection_inputs(season: int, as_of_week: int | None, scoring_settings: dict, fumble_scope: str):
    df = _require("player_stats")
    d = df[(df["season"] == season) & (df["season_type"] == "REG")]
    if d.empty:
        raise HTTPException(status_code=404, detail=f"no regular-season data cached for season {season}")
    max_week = int(d["week"].max())
    week = min(as_of_week, max_week) if as_of_week is not None else max_week
    projs = projections.build_projections(df, season, week, scoring_settings, fumble_scope=fumble_scope)
    return projs, week, max_week


@app.get("/projections")
def get_projections(
    season: int = Query(default=config.DEFAULT_SEASON),
    week: int | None = Query(default=None, description="Project as of this week (default: latest cached)"),
    scoring_json: str | None = Query(default=None, alias="scoring"),
    fumble_scope: str = Query(default="all", pattern="^(all|offensive)$"),
    limit: int = Query(default=300, le=2000),
) -> dict:
    settings = _parse_scoring(scoring_json)
    projs, as_of, max_week = _projection_inputs(season, week, settings, fumble_scope)
    games_left = max(0, config.REG_SEASON_WEEKS - as_of)
    ros = projections.rest_of_season(projs, as_of, config.REG_SEASON_WEEKS)

    return {
        "provenance": store.provenance(),
        "season": season,
        "as_of_week": as_of,
        "latest_cached_week": max_week,
        "games_remaining": games_left,
        "rest_of_season_note": (
            "Season complete - 0 games remain, so rest-of-season totals are 0 by definition."
            if games_left == 0 else None
        ),
        "scoring_analysis": scoring.analyze_settings(settings),
        "model": {
            "type": "first-pass volume x regressed-efficiency",
            "recent_window": projections.RECENT_WINDOW,
            "recent_weight": projections.RECENT_WEIGHT,
            "caveat": "Transparent, not best-in-class. Expect worse accuracy than commercial projections.",
        },
        "count": len(projs),
        "players": [
            {**p.to_dict(), "rest_of_season_points": ros.get(p.player_id, 0.0),
             "sleeper_id": ids.gsis_to_sleeper(p.player_id)}
            for p in projs[:limit]
        ],
    }


@app.get("/players/replacement-level")
def replacement_level(
    season: int = Query(default=config.DEFAULT_SEASON),
    scoring_json: str | None = Query(default=None, alias="scoring"),
    roster_positions: str = Query(
        default="QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX",
        description="Comma-separated Sleeper roster_positions",
    ),
    num_teams: int = Query(default=10, ge=2, le=32),
    week: int | None = Query(default=None),
    fumble_scope: str = Query(default="all", pattern="^(all|offensive)$"),
) -> dict:
    settings = _parse_scoring(scoring_json)
    projs, as_of, _ = _projection_inputs(season, week, settings, fumble_scope)
    slots = [s.strip().upper() for s in roster_positions.split(",") if s.strip()]
    levels = vor.compute_replacement_levels(projs, slots, num_teams)
    return {
        "provenance": store.provenance(),
        "season": season,
        "as_of_week": as_of,
        "num_teams": num_teams,
        "roster_positions": slots,
        "scoring_analysis": scoring.analyze_settings(settings),
        "methodology": (
            "Value-based drafting (Bryant/VBD lineage): replacement level is the player "
            "ranked immediately below the last startable player at each position. Flex "
            "absorption is assigned to whichever positions actually project highest at the "
            "margin, not split evenly. Well-tested practitioner methodology, not peer-reviewed research."
        ),
        "replacement_levels": {k: vars(v) for k, v in levels.items()},
    }


# ---------------------------------------------------------------------------
# roster health (POST: needs full league context, too much for a query string)
# ---------------------------------------------------------------------------

class RosterIn(BaseModel):
    roster_id: int
    owner_name: str | None = None
    player_ids: list[str] = Field(default_factory=list)   # Sleeper IDs
    starters: list[str] = Field(default_factory=list)     # Sleeper IDs, slot-aligned


class RosterHealthRequest(BaseModel):
    season: int | None = None
    week: int | None = None
    num_teams: int
    roster_positions: list[str]
    scoring_settings: dict = Field(default_factory=dict)
    rosters: list[RosterIn]
    focus_roster_id: int | None = None
    fumble_scope: str = "all"
    player_meta: dict[str, dict] = Field(default_factory=dict)  # sleeper_id -> {name, position}


class WaiverTargetsRequest(BaseModel):
    season: int | None = None
    week: int | None = None
    num_teams: int
    roster_positions: list[str]
    scoring_settings: dict = Field(default_factory=dict)
    rostered_sleeper_ids: list[str] = Field(default_factory=list)
    my_bench_sleeper_ids: list[str] = Field(default_factory=list)
    my_starter_sleeper_ids: list[str] = Field(default_factory=list)
    fumble_scope: str = "all"
    limit: int = 60


@app.post("/waiver-targets")
def waiver_targets(req: WaiverTargetsRequest) -> dict:
    """Free agents ranked by VOR, with REAL opportunity trends.

    Every number here is measured: VOR against this league's own replacement
    level, and usage direction from actual game logs. Nothing is simulated.
    Players the projection model has never seen are returned in a separate
    `unprojected` bucket rather than being ranked against real ones on a
    fabricated score.
    """
    season = req.season or config.DEFAULT_SEASON
    settings = req.scoring_settings or scoring.DEFAULT_PPR
    projs, as_of, max_week = _projection_inputs(season, req.week, settings, req.fumble_scope)
    levels = vor.compute_replacement_levels(projs, req.roster_positions, req.num_teams)
    games_left = max(0, config.REG_SEASON_WEEKS - as_of)
    vor_by_gsis = vor.compute_vor(projs, levels, games_left)

    stats = _require("player_stats")
    trends = usage.compute_usage_trends(
        stats, season, as_of,
        snap_share_by_key=_snap_share_lookup(season, None),
        gsis_to_pfr=_gsis_to_pfr(),
    )

    rostered_gsis = {
        g for g in (ids.sleeper_to_gsis(s) for s in req.rostered_sleeper_ids) if g
    }

    # What the current starting lineup is worth at each position, so a target
    # can be described as an upgrade over something specific rather than in
    # the abstract.
    starter_vor_by_pos: dict[str, float] = {}
    for sid in req.my_starter_sleeper_ids:
        g = ids.sleeper_to_gsis(sid)
        v = vor_by_gsis.get(g) if g else None
        if v and v.position:
            cur = starter_vor_by_pos.get(v.position)
            if cur is None or v.vor_per_game < cur:
                starter_vor_by_pos[v.position] = v.vor_per_game

    bench_gsis = {
        g for g in (ids.sleeper_to_gsis(s) for s in req.my_bench_sleeper_ids) if g
    }

    available = []
    for gsis, v in vor_by_gsis.items():
        if gsis in rostered_gsis:
            continue
        t = trends.get(gsis)
        weakest = starter_vor_by_pos.get(v.position or "")
        available.append({
            **v.to_dict(),
            "sleeper_id": ids.gsis_to_sleeper(gsis),
            "usage": t.to_dict() if t else None,
            "upgrade_over_weakest_starter": (
                round(v.vor_per_game - weakest, 2) if weakest is not None else None
            ),
            "weakest_starter_vor_at_position": weakest,
        })

    available.sort(key=lambda p: p["vor_per_game"], reverse=True)

    # Your bench, worst first. Only players actually BELOW replacement are
    # flagged droppable - a positive-VOR bench player is surplus value, and
    # labelling him "droppable" just because he is your weakest bench spot
    # would be wrong.
    bench_ranked = sorted(
        (
            {
                **vor_by_gsis[g].to_dict(),
                "sleeper_id": ids.gsis_to_sleeper(g),
                "below_replacement": vor_by_gsis[g].vor_per_game < 0,
            }
            for g in bench_gsis
            if g in vor_by_gsis
        ),
        key=lambda p: p["vor_per_game"],
    )

    return {
        "provenance": store.provenance(),
        "season": season,
        "as_of_week": as_of,
        "latest_cached_week": max_week,
        "games_remaining": games_left,
        "scoring_analysis": scoring.analyze_settings(settings),
        "replacement_levels": {k: vars(v) for k, v in levels.items()},
        "methodology": (
            "Free agents ranked by Value Over Replacement using this league's own "
            "roster settings. Usage direction is measured from actual game logs "
            "(recent 4-game window vs. all earlier weeks), not simulated."
        ),
        "count": len(available),
        "targets": available[: req.limit],
        "bench_ranked": bench_ranked,
    }


@app.post("/roster-health")
def roster_health(req: RosterHealthRequest) -> dict:
    season = req.season or config.DEFAULT_SEASON
    settings = req.scoring_settings or scoring.DEFAULT_PPR
    projs, as_of, max_week = _projection_inputs(season, req.week, settings, req.fumble_scope)
    levels = vor.compute_replacement_levels(projs, req.roster_positions, req.num_teams)
    games_left = max(0, config.REG_SEASON_WEEKS - as_of)
    vor_by_gsis = vor.compute_vor(projs, levels, games_left)

    # Resolve every Sleeper ID on every roster, keeping the misses visible.
    to_resolve = []
    seen: set[str] = set()
    for r in req.rosters:
        for sid in r.player_ids:
            if sid in seen:
                continue
            seen.add(sid)
            meta = req.player_meta.get(sid, {})
            to_resolve.append({"sleeper_id": sid, "name": meta.get("name"), "position": meta.get("position")})
    resolution = ids.resolve_many(to_resolve)
    s2g = resolution.mapping

    starting_slots = vor.parse_lineup(req.roster_positions)
    slot_labels = [s.upper() for s in req.roster_positions if s.upper() not in vor.NON_STARTING_SLOTS]

    def player_block(sid: str) -> dict:
        gsis = s2g.get(sid)
        v = vor_by_gsis.get(gsis) if gsis else None
        meta = req.player_meta.get(sid, {})
        if v is None:
            return {
                "sleeper_id": sid, "gsis_id": gsis,
                "name": meta.get("name"), "position": meta.get("position"),
                "has_projection": False,
                "reason": ("no nflverse ID match" if not gsis
                           else "matched, but no projection (no regular-season snaps in this window)"),
                "projected_points_per_game": None, "vor_per_game": None, "vor_rest_of_season": None,
            }
        d = v.to_dict()
        d.update({"sleeper_id": sid, "gsis_id": gsis, "has_projection": True})
        return d

    def slot_eligible(label: str, position: str | None) -> bool:
        """Is `position` allowed in this slot? Unknown slots don't get judged."""
        if not position:
            return True
        pos = position.upper()
        if label in vor.FLEX_ELIGIBILITY:
            return pos in vor.FLEX_ELIGIBILITY[label]
        if label in ("QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"):
            return pos == label
        return True

    team_reports = []
    for r in req.rosters:
        starters, used = [], set()
        for i, label in enumerate(slot_labels):
            sid = r.starters[i] if i < len(r.starters) else None
            if sid in (None, "", "0"):
                starters.append({"slot": label, "empty": True, "player": None})
                continue
            used.add(sid)
            blk = player_block(sid)
            # Sleeper's `starters` array is positionally aligned with the
            # starting-slot portion of roster_positions. If a caller sends a
            # misaligned array we would otherwise render "WR: <a quarterback>",
            # which is a visibly false claim. Flag it instead of displaying it
            # as fact - the VOR itself is still computed against the player's
            # own position, so the number stays correct either way.
            mismatch = not slot_eligible(label, blk.get("position"))
            starters.append({
                "slot": label,
                "empty": False,
                "player": blk,
                "slot_mismatch": mismatch,
                "slot_mismatch_reason": (
                    f"{blk.get('position')} is not eligible for a {label} slot - "
                    "starters array may not be aligned with roster_positions"
                ) if mismatch else None,
            })

        bench = [player_block(sid) for sid in r.player_ids if sid not in used]
        starter_vors = [s["player"]["vor_per_game"] for s in starters
                        if s["player"] and s["player"]["vor_per_game"] is not None]
        team_reports.append({
            "roster_id": r.roster_id,
            "owner_name": r.owner_name,
            "starters": starters,
            "bench": sorted(bench, key=lambda b: (b["vor_per_game"] is None, -(b["vor_per_game"] or 0))),
            "starter_vor_total_per_game": round(sum(starter_vors), 2),
            "starter_vor_rest_of_season": round(sum(starter_vors) * games_left, 2),
            "starters_with_projection": len(starter_vors),
            "starters_missing_projection": sum(1 for s in starters if not s["empty"] and not (s["player"] or {}).get("has_projection")),
        })

    team_reports.sort(key=lambda t: t["starter_vor_total_per_game"], reverse=True)
    for i, t in enumerate(team_reports, 1):
        t["league_rank"] = i

    return {
        "provenance": store.provenance(),
        "season": season,
        "as_of_week": as_of,
        "latest_cached_week": max_week,
        "games_remaining": games_left,
        "num_teams": req.num_teams,
        "scoring_analysis": scoring.analyze_settings(settings),
        "replacement_levels": {k: vars(v) for k, v in levels.items()},
        "id_resolution": resolution.summary(),
        "methodology": (
            "VOR = projected points per game minus replacement level at that position, where "
            "replacement level is derived from this league's own team count and starting "
            "requirements. Value-based drafting lineage; well-tested practitioner methodology, "
            "not peer-reviewed research."
        ),
        "teams": team_reports,
        "focus_roster_id": req.focus_roster_id,
    }
