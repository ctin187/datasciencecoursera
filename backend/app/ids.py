"""Sleeper <-> nflverse (GSIS) player ID translation.

Sleeper player IDs and nflverse GSIS IDs are separate namespaces. Every place
we cross that boundary goes through here, and every failure to cross it is
logged and counted rather than silently dropped - an unmatched player would
otherwise just vanish from the analysis with no trace, which is precisely the
kind of bug that quietly makes the numbers wrong.
"""
from __future__ import annotations

import logging
import re
import threading
import unicodedata

import pandas as pd

from . import store

log = logging.getLogger("ids")

_LOCK = threading.Lock()
_sleeper_to_gsis: dict[str, str] = {}
_gsis_to_sleeper: dict[str, str] = {}
_gsis_meta: dict[str, dict] = {}
_name_pos_to_gsis: dict[tuple[str, str], str] = {}
_loaded = False

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str) -> str:
    """Lowercase, strip accents/punctuation/suffixes - for fallback matching."""
    if not isinstance(name, str):
        return ""
    s = unicodedata.normalize("NFD", name)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower().replace(".", "").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    parts = [p for p in s.split() if p and p not in _SUFFIXES]
    return " ".join(parts)


def _build() -> None:
    global _loaded
    id_map = store.load_table("id_map")
    if id_map is None:
        log.warning("id_map table missing; ID translation unavailable until refresh")
        return

    s2g: dict[str, str] = {}
    g2s: dict[str, str] = {}
    meta: dict[str, dict] = {}
    np_idx: dict[tuple[str, str], str] = {}

    for row in id_map.itertuples(index=False):
        gsis = getattr(row, "gsis_id", None)
        sleeper = getattr(row, "sleeper_id", None)
        if not isinstance(gsis, str) or not gsis:
            continue

        name = getattr(row, "name", None)
        pos = getattr(row, "position", None)
        meta[gsis] = {
            "name": name if isinstance(name, str) else None,
            "position": pos if isinstance(pos, str) else None,
        }

        if isinstance(name, str) and isinstance(pos, str):
            np_idx.setdefault((normalize_name(name), pos.upper()), gsis)

        if pd.notna(sleeper):
            # Sleeper IDs arrive as floats via CSV inference (e.g. 4034.0).
            sid = str(sleeper)
            if sid.endswith(".0"):
                sid = sid[:-2]
            if sid:
                s2g[sid] = gsis
                g2s.setdefault(gsis, sid)

    _sleeper_to_gsis.clear(); _sleeper_to_gsis.update(s2g)
    _gsis_to_sleeper.clear(); _gsis_to_sleeper.update(g2s)
    _gsis_meta.clear(); _gsis_meta.update(meta)
    _name_pos_to_gsis.clear(); _name_pos_to_gsis.update(np_idx)
    _loaded = True
    log.info("ID map built: %d sleeper->gsis pairs", len(s2g))


def ensure_loaded(force: bool = False) -> None:
    with _LOCK:
        if _loaded and not force:
            return
        _build()


def sleeper_to_gsis(sleeper_id: str) -> str | None:
    ensure_loaded()
    return _sleeper_to_gsis.get(str(sleeper_id))


def gsis_to_sleeper(gsis_id: str) -> str | None:
    ensure_loaded()
    return _gsis_to_sleeper.get(str(gsis_id))


def gsis_info(gsis_id: str) -> dict:
    ensure_loaded()
    return _gsis_meta.get(str(gsis_id), {})


def resolve_by_name(name: str, position: str) -> str | None:
    """Fallback for Sleeper IDs absent from the ID map (usually rookies).

    Name+position matching is genuinely less reliable than an ID join, so
    resolutions from here are reported separately from exact ID matches
    rather than being folded in as if they were equally certain.
    """
    ensure_loaded()
    return _name_pos_to_gsis.get((normalize_name(name), (position or "").upper()))


class Resolution:
    """Outcome of translating a batch of Sleeper IDs, including the misses."""

    def __init__(self) -> None:
        self.by_id: dict[str, str] = {}       # sleeper_id -> gsis_id (exact)
        self.by_name: dict[str, str] = {}     # sleeper_id -> gsis_id (fallback)
        self.unmatched: list[dict] = []       # never silently dropped

    @property
    def mapping(self) -> dict[str, str]:
        return {**self.by_id, **self.by_name}

    def summary(self) -> dict:
        total = len(self.by_id) + len(self.by_name) + len(self.unmatched)
        return {
            "total": total,
            "matched_by_id": len(self.by_id),
            "matched_by_name": len(self.by_name),
            "unmatched": len(self.unmatched),
            "unmatched_players": self.unmatched,
        }


def resolve_many(players: list[dict]) -> Resolution:
    """Translates Sleeper roster entries to GSIS IDs.

    `players` items: {"sleeper_id", "name", "position"}.
    """
    ensure_loaded()
    res = Resolution()
    for p in players:
        sid = str(p.get("sleeper_id", ""))
        if not sid:
            continue
        gsis = _sleeper_to_gsis.get(sid)
        if gsis:
            res.by_id[sid] = gsis
            continue
        gsis = resolve_by_name(p.get("name", "") or "", p.get("position", "") or "")
        if gsis:
            res.by_name[sid] = gsis
            log.info("sleeper %s resolved by name fallback -> %s", sid, gsis)
            continue
        res.unmatched.append(
            {"sleeper_id": sid, "name": p.get("name"), "position": p.get("position")}
        )
        log.warning(
            "UNMATCHED sleeper_id=%s name=%r pos=%s", sid, p.get("name"), p.get("position")
        )
    return res
