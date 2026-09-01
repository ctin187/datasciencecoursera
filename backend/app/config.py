"""Runtime configuration.

Everything here is environment-overridable so the same image runs locally and
on Railway/Render without code changes.
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

# Where the on-disk parquet cache lives. On Railway/Render attach a volume here
# if you want the cache to survive restarts; otherwise it rebuilds on boot.
DATA_DIR = Path(os.getenv("DATA_DIR", "./data_cache")).resolve()

def current_nfl_season(today: date | None = None) -> int:
    """The season label the NFL is currently in.

    Seasons are named for the year they kick off, and run September to early
    February. So anything from September onward belongs to that calendar year;
    January and February still belong to the season that began the previous
    year. Getting this wrong is not cosmetic - it is the difference between
    ranking players on what they are expected to do and on what they already
    did.
    """
    d = today or date.today()
    return d.year if d.month >= 9 else d.year - 1


CURRENT_SEASON: int = int(os.getenv("CURRENT_SEASON", current_nfl_season()))


# Seasons to ingest.
#
# The current season first, with the one before it as a fallback: before
# kickoff, and in the days after it, nflverse has not published the new
# season's stats yet and its asset 404s. Ingesting the previous season means
# the app still has something to say - but it must then say WHICH season the
# numbers come from, which is why `season_status` below exists.
#
# One season is held in memory at a time. An earlier version pulled two "for
# prior-year context" that nothing ever read; on Render's 512MB free tier that
# waste is the difference between comfortable and OOM.
def _parse_seasons() -> list[int]:
    raw = os.getenv("SEASONS")
    if raw:
        return [int(s.strip()) for s in raw.split(",") if s.strip()]
    return [CURRENT_SEASON, CURRENT_SEASON - 1]


SEASONS: list[int] = _parse_seasons()

# The season the API serves by default. Overridden at runtime by whichever
# season actually has cached data - see store.resolve_season().
DEFAULT_SEASON: int = int(os.getenv("DEFAULT_SEASON", max(SEASONS)))

# Regular-season week count. nflverse weeks 19-22 are playoffs, which fantasy
# leagues do not score, so projections and validation stop at this week.
REG_SEASON_WEEKS: int = 18

# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------

# nflverse publishes roughly weekly in season. Daily is plenty and stays well
# clear of anything that could look like hammering their release assets.
REFRESH_INTERVAL_HOURS: float = float(os.getenv("REFRESH_INTERVAL_HOURS", "24"))

# A cache older than this is reported as stale in every response.
STALE_AFTER_HOURS: float = float(os.getenv("STALE_AFTER_HOURS", "36"))

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

# Explicit origins only - never a wildcard (per spec). Comma-separated.
def _parse_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "https://ctin187.github.io,http://localhost:5173,http://localhost:4173",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


CORS_ORIGINS: list[str] = _parse_origins()
