"""Runtime configuration.

Everything here is environment-overridable so the same image runs locally and
on Railway/Render without code changes.
"""
from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

# Where the on-disk parquet cache lives. On Railway/Render attach a volume here
# if you want the cache to survive restarts; otherwise it rebuilds on boot.
DATA_DIR = Path(os.getenv("DATA_DIR", "./data_cache")).resolve()

# Seasons to ingest. Two seasons gives the projection model prior-year context
# for players with thin current-season samples.
def _parse_seasons() -> list[int]:
    raw = os.getenv("SEASONS")
    if raw:
        return [int(s.strip()) for s in raw.split(",") if s.strip()]
    return [2024, 2025]


SEASONS: list[int] = _parse_seasons()

# The season the API serves by default. Must be present in SEASONS.
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
