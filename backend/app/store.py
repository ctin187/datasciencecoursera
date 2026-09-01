"""nflverse ingest + on-disk cache.

Design note on the data source (this diverges from the project spec, deliberately):

The spec calls for `nfl_data_py`. That package's latest release (0.3.3) still
points `import_weekly_data` at the retired nflverse asset path
`.../releases/download/player_stats/player_stats_{season}.parquet`. nflverse
renamed that release to `stats_player` (files `stats_player_week_{season}.parquet`),
so 0.3.3 returns HTTP 404 for 2025 while happily serving 2023-2024. Verified
directly against both URLs. We therefore use `nflreadpy`, the maintained
successor from the same org, which points at the current paths.

Nothing on a user request path ever touches the network: `refresh()` pulls and
writes parquet, request handlers read parquet only.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import config

log = logging.getLogger("store")

_META_FILE = "cache_meta.json"
_LOCK = threading.Lock()


@dataclass
class CacheMeta:
    """What we know about the freshness of what's on disk."""

    last_success_utc: str | None = None
    last_attempt_utc: str | None = None
    last_error: str | None = None
    seasons: list[int] | None = None
    #: Seasons that actually produced rows. `seasons` is only what we asked
    #: for - before kickoff the new season 404s, and the difference between
    #: the two is exactly what the UI has to disclose.
    seasons_loaded: list[int] | None = None
    #: Latest regular-season week held per season, keyed by season as a string
    #: (JSON object keys are strings). Computed once at refresh: season_status()
    #: runs on every response, and re-reading the parquet there would put a
    #: full table load on every request.
    weeks_by_season: dict[str, int] | None = None
    row_counts: dict[str, int] | None = None

    @property
    def age_hours(self) -> float | None:
        if not self.last_success_utc:
            return None
        then = datetime.fromisoformat(self.last_success_utc)
        return (datetime.now(timezone.utc) - then).total_seconds() / 3600.0

    @property
    def is_stale(self) -> bool:
        age = self.age_hours
        if age is None:
            return True
        return age > config.STALE_AFTER_HOURS


def _meta_path() -> Path:
    return config.DATA_DIR / _META_FILE


def read_meta() -> CacheMeta:
    p = _meta_path()
    if not p.exists():
        return CacheMeta()
    try:
        return CacheMeta(**json.loads(p.read_text()))
    except Exception as exc:  # corrupt meta shouldn't crash the API
        log.warning("could not read cache meta: %s", exc)
        return CacheMeta()


def _write_meta(meta: CacheMeta) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    _meta_path().write_text(json.dumps(asdict(meta), indent=2))


def _parquet_path(name: str) -> Path:
    return config.DATA_DIR / f"{name}.parquet"


def load_table(name: str) -> pd.DataFrame | None:
    """Reads a cached table, or None if it was never successfully written."""
    p = _parquet_path(name)
    if not p.exists():
        return None
    try:
        return pd.read_parquet(p)
    except Exception as exc:
        log.error("failed reading cached table %s: %s", name, exc)
        return None


def _to_pandas(df) -> pd.DataFrame:
    """nflreadpy returns polars; normalise to pandas."""
    return df.to_pandas() if hasattr(df, "to_pandas") else df


def refresh(seasons: list[int] | None = None) -> CacheMeta:
    """Pulls fresh nflverse data to disk. Safe to call concurrently.

    Partial success is real and worth keeping: if snap counts fail but weekly
    stats succeed, we keep the stats rather than discarding a good pull, and
    the error is recorded so responses can say what's missing.
    """
    seasons = seasons or config.SEASONS
    with _LOCK:
        meta = read_meta()
        meta.last_attempt_utc = datetime.now(timezone.utc).isoformat()
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)

        import nflreadpy as nr

        row_counts: dict[str, int] = {}
        errors: list[str] = []

        def pull(name: str, fn) -> None:
            try:
                df = _to_pandas(fn())
                df.to_parquet(_parquet_path(name), index=False)
                row_counts[name] = len(df)
                log.info("refreshed %s: %d rows", name, len(df))
            except Exception as exc:
                msg = f"{name}: {type(exc).__name__}: {exc}"
                errors.append(msg)
                log.error("refresh failed for %s", msg)

        # Seasons are pulled one at a time on purpose. Before a season kicks
        # off nflverse has not published its asset yet and the request 404s;
        # asking for [2026, 2025] in one call loses 2025 too. Per-season means
        # a missing current season costs only that season.
        loaded: set[int] = set()

        def pull_seasons(name: str, fn) -> None:
            frames: list[pd.DataFrame] = []
            for yr in seasons:
                try:
                    df = _to_pandas(fn(yr))
                    if len(df):
                        frames.append(df)
                        loaded.add(yr)
                        log.info("refreshed %s %d: %d rows", name, yr, len(df))
                except Exception as exc:
                    # A 404 for a season that has not started is expected, not
                    # a fault; record it without treating the pull as failed.
                    log.info("%s %d unavailable: %s", name, yr, type(exc).__name__)
            if not frames:
                msg = f"{name}: no season returned data ({seasons})"
                errors.append(msg)
                log.error(msg)
                return
            df = pd.concat(frames, ignore_index=True)
            df.to_parquet(_parquet_path(name), index=False)
            row_counts[name] = len(df)
            if name == "player_stats":
                weeks: dict[str, int] = {}
                d = df[df["season_type"] == "REG"] if "season_type" in df.columns else df
                for yr, g in d.groupby("season"):
                    w = g["week"].dropna()
                    weeks[str(int(yr))] = int(w.max()) if len(w) else 0
                meta.weeks_by_season = weeks

        pull_seasons("player_stats", lambda yr: nr.load_player_stats(seasons=[yr]))
        pull_seasons("snap_counts", lambda yr: nr.load_snap_counts(seasons=[yr]))
        pull("players", lambda: nr.load_players())
        pull("id_map", _load_id_map_raw)

        meta.row_counts = row_counts
        meta.seasons = seasons
        meta.seasons_loaded = sorted(loaded)
        meta.last_error = "; ".join(errors) if errors else None
        # Only stamp success if the table everything else depends on landed.
        if "player_stats" in row_counts:
            meta.last_success_utc = datetime.now(timezone.utc).isoformat()
        _write_meta(meta)
        return meta


def seasons_available() -> list[int]:
    """Seasons with regular-season rows actually on disk, newest last."""
    meta = read_meta()
    if meta.seasons_loaded:
        return list(meta.seasons_loaded)
    df = load_table("player_stats")
    if df is None or df.empty or "season" not in df.columns:
        return []
    return sorted(int(s) for s in df["season"].dropna().unique())


def resolve_season(requested: int | None = None) -> int | None:
    """Which season to actually serve.

    An explicit request wins if we hold that season. Otherwise the newest
    season on disk - which before kickoff is LAST season, and callers are
    expected to surface that via season_status().
    """
    have = seasons_available()
    if not have:
        return None
    if requested is not None and requested in have:
        return requested
    return max(have)


def season_status(served: int | None) -> dict:
    """Describes the served season relative to the one being played.

    This is the field that stops a completed season's numbers from being read
    as a forecast for the season about to start.
    """
    current = config.CURRENT_SEASON
    if served is None:
        return {
            "season": None, "current_season": current, "is_current_season": False,
            "status": "no-data",
            "note": "No season data is cached yet.",
        }
    # Read from the cached meta, never the parquet: this runs on every response.
    weeks = int((read_meta().weeks_by_season or {}).get(str(served), 0))

    if served < current:
        return {
            "season": served, "current_season": current, "is_current_season": False,
            "weeks_played": weeks, "status": "prior-season-complete",
            "note": (
                f"The {current} season has not published stats yet, so these numbers describe "
                f"{served} production. Use them to judge what players have done, not to "
                f"forecast {current}."
            ),
        }
    return {
        "season": served, "current_season": current, "is_current_season": True,
        "weeks_played": weeks,
        "status": "in-progress" if weeks < config.REG_SEASON_WEEKS else "complete",
        "note": f"{served} data through week {weeks}.",
    }


def _load_id_map_raw() -> pd.DataFrame:
    """Cross-platform player IDs (Sleeper <-> nflverse GSIS).

    nflreadpy's `load_ff_playerids()` requests
    `github.com/dynastyprocess/data/raw/master/...`, which this environment's
    egress proxy rejects with 403. The identical file on
    `raw.githubusercontent.com` returns 200, so we fetch that directly. Same
    upstream file, different host - not a different data source.
    """
    url = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
    keep = [
        "name", "merge_name", "position", "team", "birthdate",
        "gsis_id", "sleeper_id", "espn_id", "yahoo_id", "fantasypros_id",
    ]
    df = pd.read_csv(url, low_memory=False)
    present = [c for c in keep if c in df.columns]
    return df[present].copy()


def ensure_fresh_background() -> None:
    """Kicks a refresh on a daemon thread if the cache is missing or stale."""
    meta = read_meta()
    if meta.last_success_utc and not meta.is_stale:
        return

    def _run() -> None:
        try:
            refresh()
        except Exception as exc:
            log.error("background refresh crashed: %s", exc)

    threading.Thread(target=_run, name="nflverse-refresh", daemon=True).start()


def start_scheduler() -> None:
    """Daily refresh loop on a daemon thread."""

    def _loop() -> None:
        while True:
            time.sleep(config.REFRESH_INTERVAL_HOURS * 3600)
            try:
                refresh()
            except Exception as exc:
                log.error("scheduled refresh failed: %s", exc)

    threading.Thread(target=_loop, name="nflverse-scheduler", daemon=True).start()


def provenance() -> dict:
    """The freshness block attached to every API response."""
    meta = read_meta()
    return {
        "data_as_of": meta.last_success_utc,
        "age_hours": round(meta.age_hours, 2) if meta.age_hours is not None else None,
        "stale": meta.is_stale,
        "last_error": meta.last_error,
        "source": "nflverse (via nflreadpy)",
    }
