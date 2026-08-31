"""Checks the IDP and kicking scoring maps against hand-computed totals.

These maps are the riskiest part of scoring K and IDP: a single wrong column
name yields a plausible-looking number that is quietly wrong, and a draft board
built on it would be confidently misleading. Every case below states the
arithmetic in the assertion message so a failure says what was expected and
why, not just that two floats differ.

Run: python scripts/validate_idp_kicking.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import scoring  # noqa: E402

failures: list[str] = []


def check(label: str, got: float, want: float, why: str) -> None:
    ok = abs(got - want) < 1e-6
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {got} (expected {want} — {why})")
    if not ok:
        failures.append(label)


# --- IDP ------------------------------------------------------------------
idp_line = {
    "def_tackles_solo": 7, "def_tackle_assists": 3, "def_sacks": 1.0,
    "def_interceptions": 1, "def_pass_defended": 2, "def_fumbles_forced": 1,
    "def_tackles_for_loss": 2, "def_tds": 1,
}
idp_scoring = {
    "idp_tkl_solo": 1.5, "idp_tkl_ast": 0.75, "idp_sack": 4, "idp_int": 4,
    "idp_pass_def": 1.5, "idp_ff": 4, "idp_tkl_loss": 2, "idp_def_td": 6,
}
r = scoring.score_stat_line(idp_line, idp_scoring)
check(
    "IDP full line", r.points,
    7 * 1.5 + 3 * 0.75 + 1 * 4 + 1 * 4 + 2 * 1.5 + 1 * 4 + 2 * 2 + 1 * 6,
    "7 solo + 3 ast + sack + int + 2 PD + FF + 2 TFL + TD",
)
check("IDP reports no unsupported keys", len(r.unsupported_keys), 0, "every key above is mapped")

# Sleeper's combined-tackles key must sum solo AND assisted.
r = scoring.score_stat_line(idp_line, {"idp_tkl": 1})
check("idp_tkl sums solo + assisted", r.points, 10, "7 solo + 3 assisted")

# --- Kicking --------------------------------------------------------------
k_line = {
    "fg_made_20_29": 1, "fg_made_40_49": 2, "fg_made_50_59": 1, "fg_made_60_": 1,
    "pat_made": 3, "fg_missed": 1,
}
k_scoring = {"fgm_20_29": 3, "fgm_40_49": 4, "fgm_50p": 5, "xpm": 1, "fgmiss": -1}
r = scoring.score_stat_line(k_line, k_scoring)
check(
    "Kicker tiered line", r.points,
    1 * 3 + 2 * 4 + 2 * 5 + 3 * 1 + 1 * -1,
    "one 20-29, two 40-49, TWO 50+ (50-59 and 60+), 3 XP, one miss",
)
check("Kicker reports no unsupported keys", len(r.unsupported_keys), 0, "every key above is mapped")

# --- The distinction that matters -----------------------------------------
# Sleeper spells team-defense scoring WITHOUT the idp_ prefix. Bare `sack`
# must NOT score off an individual's sack column, or every DST in the league
# would inherit one defender's stat line.
r = scoring.score_stat_line({"def_sacks": 3}, {"sack": 1})
check("bare `sack` (team DST) does not score a player", r.points, 0, "DST keys stay out of scope")
analysis = scoring.analyze_settings({"sack": 1, "idp_sack": 4})
check("bare `sack` is reported out of scope", "sack" in analysis["out_of_scope_keys"], True, "not a silent zero")
check("idp_sack is reported supported", "idp_sack" in analysis["supported_keys"], True, "individual sacks are mapped")

print()
if failures:
    print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
    sys.exit(1)
print("All IDP/kicking scoring checks passed.")
