"""Value Over Replacement.

The idea: a player's value is not his projected points, it is his projected
points minus what the roster spot could get for free. A 14-point QB in a league
where the waiver wire is stocked with 13-point QBs is worth ~1 point. A 14-point
TE in a league where the next TE up scores 6 is worth 8.

Provenance: this is value-based drafting (Joe Bryant's VBD, building on earlier
baseline-comparison work). It is well-tested practitioner methodology, not
peer-reviewed research, and UI copy should describe it that way.

Every input that could be hardcoded is instead read from the league: team count
and starting requirements come from Sleeper's `roster_positions`, so a superflex
or TE-premium league moves the baselines on its own.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

# Slot labels Sleeper uses that are not startable lineup spots.
NON_STARTING_SLOTS = {"BN", "IR", "TAXI"}

# Which real positions each flex-type slot can absorb.
FLEX_ELIGIBILITY: dict[str, tuple[str, ...]] = {
    "FLEX": ("RB", "WR", "TE"),
    "WRRB_FLEX": ("RB", "WR"),
    "REC_FLEX": ("WR", "TE"),
    "SUPER_FLEX": ("QB", "RB", "WR", "TE"),
    "IDP_FLEX": ("DL", "LB", "DB"),
}

SCORABLE = ("QB", "RB", "WR", "TE")


@dataclass
class ReplacementLevel:
    position: str
    dedicated_starters: int
    flex_absorbed: int
    total_startable: int
    replacement_rank: int
    replacement_points: float
    replacement_player: str | None
    method: str


@dataclass
class PlayerVOR:
    player_id: str
    name: str | None
    position: str | None
    team: str | None
    projected_points_per_game: float
    replacement_points: float
    vor_per_game: float
    vor_rest_of_season: float
    games_remaining: int

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("projected_points_per_game", "replacement_points", "vor_per_game", "vor_rest_of_season"):
            d[k] = round(float(d[k]), 2)
        return d


def parse_lineup(roster_positions: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    """Splits roster_positions into dedicated starters and flex slots."""
    dedicated: dict[str, int] = {}
    flex: dict[str, int] = {}
    for raw in roster_positions or []:
        slot = str(raw).upper()
        if slot in NON_STARTING_SLOTS:
            continue
        if slot in FLEX_ELIGIBILITY:
            flex[slot] = flex.get(slot, 0) + 1
        elif slot in SCORABLE or slot in ("K", "DEF", "DL", "LB", "DB"):
            dedicated[slot] = dedicated.get(slot, 0) + 1
    return dedicated, flex


def compute_replacement_levels(
    projections: list,
    roster_positions: list[str],
    num_teams: int,
    positions: tuple[str, ...] = SCORABLE,
) -> dict[str, ReplacementLevel]:
    """Derives per-position replacement level from the league's own settings.

    Flex absorption is *not* split evenly across RB/WR/TE. Instead we take the
    players who fall outside each position's dedicated starters, pool them,
    and let the highest projected among them claim the flex slots - which is
    what managers actually do. In a pass-heavy scoring format that pool skews
    WR on its own, without us asserting a ratio.
    """
    dedicated, flex = parse_lineup(roster_positions)

    by_pos: dict[str, list] = {}
    for p in projections:
        if p.position in positions:
            by_pos.setdefault(p.position, []).append(p)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda x: x.projected_points_per_game, reverse=True)

    # Step 1: dedicated starters league-wide.
    dedicated_counts = {pos: dedicated.get(pos, 0) * num_teams for pos in positions}

    # Step 2: flex absorption, decided by who is actually best available.
    flex_counts = {pos: 0 for pos in positions}
    for slot, n_slots in flex.items():
        eligible = [p for p in FLEX_ELIGIBILITY.get(slot, ()) if p in positions]
        if not eligible:
            continue
        pool = []
        for pos in eligible:
            already = dedicated_counts[pos] + flex_counts[pos]
            pool.extend(by_pos.get(pos, [])[already:])
        pool.sort(key=lambda x: x.projected_points_per_game, reverse=True)
        for p in pool[: n_slots * num_teams]:
            flex_counts[p.position] += 1

    levels: dict[str, ReplacementLevel] = {}
    for pos in positions:
        pool = by_pos.get(pos, [])
        total = dedicated_counts[pos] + flex_counts[pos]
        if total <= 0:
            # Position isn't started in this league - it has no replacement
            # baseline, and reporting 0.0 would imply every player is valuable.
            levels[pos] = ReplacementLevel(
                position=pos, dedicated_starters=0, flex_absorbed=0, total_startable=0,
                replacement_rank=0, replacement_points=0.0, replacement_player=None,
                method="position not started in this league",
            )
            continue

        idx = total  # 0-based index of the player just below the last starter
        if idx < len(pool):
            repl = pool[idx]
            pts, who, method = repl.projected_points_per_game, repl.name, "player ranked immediately below last startable"
        elif pool:
            repl = pool[-1]
            pts, who = repl.projected_points_per_game, repl.name
            method = "pool exhausted; used last available player (baseline is a floor, likely too high)"
        else:
            pts, who, method = 0.0, None, "no players at position"

        levels[pos] = ReplacementLevel(
            position=pos,
            dedicated_starters=dedicated_counts[pos],
            flex_absorbed=flex_counts[pos],
            total_startable=total,
            replacement_rank=total + 1,
            replacement_points=round(float(pts), 2),
            replacement_player=who,
            method=method,
        )
    return levels


def compute_vor(
    projections: list,
    levels: dict[str, ReplacementLevel],
    games_remaining: int,
) -> dict[str, PlayerVOR]:
    """VOR per player. Positive = worth more than a free replacement."""
    out: dict[str, PlayerVOR] = {}
    for p in projections:
        lvl = levels.get(p.position)
        if lvl is None:
            continue
        vor = p.projected_points_per_game - lvl.replacement_points
        out[p.player_id] = PlayerVOR(
            player_id=p.player_id,
            name=p.name,
            position=p.position,
            team=p.team,
            projected_points_per_game=p.projected_points_per_game,
            replacement_points=lvl.replacement_points,
            vor_per_game=vor,
            vor_rest_of_season=vor * games_remaining,
            games_remaining=games_remaining,
        )
    return out
