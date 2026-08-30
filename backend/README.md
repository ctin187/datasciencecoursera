# Fantasy Decision Dashboard Backend

Python/FastAPI service that serves nflverse NFL data, transparent projections,
and Value Over Replacement to the React Sleeper dashboard (`/frontend`).

## Why it exists

The dashboard is a browser-only React app calling the Sleeper API. That works for
rosters and league settings but cannot reach the data that makes analysis
meaningful — snap share, target share, air yards — because those sources either
block cross-origin browser requests or need keys that must not ship in client
code. This backend is that missing layer.

## Quick start

```bash
pip install -r requirements.txt
python -c "from app import store; store.refresh()"   # ~1 min, populates ./data_cache
uvicorn app.main:app --reload --port 8000
open http://localhost:8000/docs
```

Validate before trusting any number:

```bash
python scripts/validate.py                    # offline suite (runs anywhere)
python scripts/validate_vs_sleeper.py --season 2025 --week 12   # needs Sleeper access
python scripts/backtest_multi_season.py --seasons 2022,2023,2024,2025   # does the model hold up across years?
```

`backtest_multi_season.py` runs the same projection-accuracy and replacement-level-believability
checks as `validate.py`, once per season, so the single-season results below can be checked against
prior years instead of taken on faith. It validates the projection/VOR **model** only — not any
draft strategy (zero-RB, wait-on-QB, VORP drafting, etc.), which would need real historical ADP data
this project has no legitimate free source for. It is not part of the deployed API (loading several
seasons of stats at once is exactly the memory cost the API's single-season `SEASONS` scoping in
`config.py` exists to avoid on Render's free tier) — run it locally or in CI. Its logic was dry-run
against a synthetic multi-season dataset during development (real `app.projections`/`app.scoring`/
`app.vor` code, fabricated stat lines) to confirm it executes correctly end-to-end, but never against
real nflverse data — this build environment has no network access to nflverse's release assets.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness + last successful data refresh |
| `GET /players/stats?season=&week=&position=` | Per-player weekly stats incl. snap/target/air-yards share |
| `GET /players/trends?player_ids=&weeks=` | Rolling averages + direction of travel |
| `GET /players/replacement-level?...` | Replacement-level points per position |
| `GET /projections?season=&week=&scoring=` | Weekly + rest-of-season projections |
| `POST /roster-health` | Per-slot VOR, team totals, league ranking, bench value |
| `POST /admin/refresh` | Force a data refresh |

Every response carries a `provenance` block (`data_as_of`, `age_hours`, `stale`,
`last_error`). No request handler touches the network — handlers read the parquet
cache that a daily background job populates.

## Deployment

The Blueprint lives at the **repository root** (`/render.yaml`), not in this
directory — Render only looks for `render.yaml` at the root, and points it here
via `rootDir: backend`.

1. render.com → **New +** → **Blueprint** → connect this repo.
   It finds `/render.yaml` and fills in build command, start command, health
   check and env vars. Pick the free plan and Apply.
2. Copy the service URL it gives you (e.g. `https://fantasy-dynasty-backend.onrender.com`).
3. In GitHub: **Settings → Secrets and variables → Actions → Variables** →
   new variable `VITE_API_BASE_URL` = that URL. (A variable, not a secret — it's
   a public URL baked into client-side JS.)
4. **Actions → Deploy Fantasy Dynasty Dashboard → Run workflow.**

Notes:
- Free tier sleeps after ~15 min idle; the first request after that takes ~30s.
- Ingest peaks around **334 MB** against the free tier's 512 MB, measured. That
  headroom is why `SEASONS` defaults to a single season — see `config.py`.
- The disk is ephemeral, so the parquet cache rebuilds on boot (about a minute).

**This was not deployed for you** — that needs your own Render account. Until
`VITE_API_BASE_URL` points at a live instance, the My Team and Waiver Wire tabs
say so rather than showing numbers they can't compute.

---

# Findings, and where this diverges from the spec

### 1. `nfl_data_py` is broken for 2025 — switched to `nflreadpy`

The spec specifies `nfl_data_py`. Its latest release (0.3.3) still points
`import_weekly_data` at the retired nflverse asset path
`.../releases/download/player_stats/player_stats_{season}.parquet`. nflverse
renamed that release to `stats_player`. Verified directly:

```
player_stats_2024.parquet      200
player_stats_2025.parquet      404      <- the season we need
stats_player_week_2025.parquet 200      <- current path
```

`nfl_data_py` therefore serves 2023–2024 fine and 404s on 2025. We use
`nflreadpy` 0.1.5 (same org, actively maintained, current paths). All six
loaders the spec names do exist in 0.3.3 — the function names were fine, the
data URL behind one of them was not.

### 2. `routes_run` is not obtainable from free sources

The spec lists `routes_run` in `/players/stats`. It is absent from
`load_player_stats`, `load_snap_counts`, `load_pfr_advstats(rec)` and
`load_ff_opportunity` — routes run is a PFF/FTN-licensed metric. It is returned
as `null` with a stated reason in `unavailable_fields`, never zero-filled: a
zero would assert "ran no routes", which is a different and false claim.

Everything else the spec asked for is present. `snap_share` comes from
`snap_counts.offense_pct` joined via PFR ID; `rush_share` is computed against
team carries per week.

### 3. The 2025 season is complete, so "rest of season" is zero

2025 has all 22 weeks cached (18 regular + playoffs). Rest-of-season projections
for a finished season are 0 games by definition, and the API says exactly that
rather than emitting a confident-looking number:

```json
"games_remaining": 0,
"rest_of_season_note": "Season complete - 0 games remain, so rest-of-season totals are 0 by definition."
```

Projections are built "as of" a week (`?week=`), using only weeks ≤ that. This
makes the same code path serve live use and backtesting.

### 4. The Sleeper scoring check could not be run here

The spec calls this the highest-value test, and it is. It could not run in the
build environment: that sandbox's egress proxy rejects `api.sleeper.app` with
403. `scripts/validate_vs_sleeper.py` implements it in full — run it anywhere
with normal internet access.

What *was* verified: the engine reconciles **exactly** with nflverse's
independently-computed `fantasy_points_ppr` across all **6,037** 2025
regular-season QB/RB/WR/TE player-weeks — 0 mismatches — once two convention
differences are matched (below).

### 5. Two scoring conventions worth knowing about

Reconciling against nflverse surfaced two real differences, both now explicit:

- **Return touchdowns.** nflverse's `fantasy_points_ppr` includes special-teams
  TDs. 19 player-weeks differed by exactly 6.0 until `st_td` was mapped.
- **Fumble scope.** nflverse's `fumbles_lost_total` counts return fumbles;
  its own PPR column penalises only offensive fumbles. These disagree on exactly
  28 player-weeks in 2025, all return specialists. Which one Sleeper uses is
  **unresolved** — it needs the Sleeper test above. Default is `fumble_scope="all"`
  because Sleeper's `fum_lost` is not documented as offense-restricted; set
  `offensive` to match nflverse. `validate_vs_sleeper.py` reports which fits.

Any scoring key the engine cannot compute is returned in `unsupported_keys`
rather than silently contributing zero (e.g. 40+ yard TD bonuses need
play-level data). A league with those bonuses is told they aren't in the number.

### 6. Projection accuracy

Backtested on weeks 10/12/14/16 by projecting from prior weeks only:

| Position | MAE (startable pool) | MAE (all players) |
|---|---|---|
| QB | 7.32 | 6.79 |
| RB | 6.24 | 4.18 |
| WR | 6.62 | 4.18 |
| TE | 5.80 | 3.58 |

**The startable-pool column is the one to read.** The all-players MAE (RB 4.18)
initially looked *better* than the 5–7 published benchmark, which would be
implausible for a first-pass model. It was pool composition, not skill: 216 of
the 328 RB observations are deep-bench players averaging 4.45 actual points,
whose small absolute errors drag the mean down. Restricted to the startable pool
that published benchmarks actually measure, RB/WR land at 6.24/6.62 — inside the
5–7 band. No bug; the naive number was just measuring a different population.

### 7. Replacement levels

10-team, 1QB/2RB/3WR/1TE/2FLEX, as of week 17:

| Pos | Startable | Replacement rank | Points | Player |
|---|---|---|---|---|
| QB | 10 | 11 | 17.56 | Justin Herbert |
| RB | 33 | 34 | 10.56 | Woody Marks |
| WR | 34 | 35 | 10.35 | Justin Jefferson |
| TE | 13 | 14 | 10.10 | Colby Parkinson |

Against the spec's rough expectation (QB11, RB~30, WR~40, TE11): QB lands exactly,
RB/TE run a few slots deep and WR a few shallow. That is the flex split doing its
job — flex went 13 RB / 4 WR / 3 TE because marginal RBs (12.8→10.7) genuinely
outproject marginal WRs (10.9→) and TEs (11.2→) in this data. The spec asked for
flex to be distributed by observed usage rather than evenly, and it is.

Two sanity results worth flagging:

- **Justin Jefferson as replacement-level WR** looks alarming and was
  investigated. It is faithful to the data: his 2025 log shows 6.9 targets/game
  with recent weeks of 2.4/3.1/4.2/7.0 points. WR30–40 form a tight 10.0–11.2
  band, which is what a replacement band should look like.
- **QB replacement is 91% of the top-12 QB average.** Also real: QB1 (21.6)
  through QB11 (17.6) span four points. That compression is precisely the fact
  VOR exists to surface — QB scarcity is low in 1QB leagues, so QB VOR is small.
  The validation suite's believability band is position-aware for this reason.

Baselines move correctly with league settings: adding a `SUPER_FLEX` slot doubles
QB startable (10→20) and drops the QB baseline (17.56→15.49); growing the league
10→12→14 lowers every baseline monotonically.

### 8. ID matching

6,185 Sleeper→GSIS pairs available. In the 10-team synthetic league test, 90 of
91 players resolved by exact ID; the one failure was a deliberately fake ID, and
it was reported in `id_resolution.unmatched_players` rather than dropped. Name+
position fallback exists for players missing from the map (usually rookies) and
is reported separately from exact matches, because it is genuinely less certain.

`nflreadpy.load_ff_playerids()` requests `github.com/dynastyprocess/data/raw/...`,
which this environment's proxy rejects with 403; the identical file on
`raw.githubusercontent.com` returns 200, so `store._load_id_map_raw()` fetches
that. Same upstream file, different host.

### 9. Slot-eligibility guarding

`/roster-health` trusts that Sleeper's `starters[i]` aligns with the i-th
starting slot in `roster_positions`, which is how Sleeper actually sends it. If a
caller sends a misaligned array the endpoint now flags `slot_mismatch` per slot
instead of rendering "WR: <a quarterback>" as fact. The VOR number stays correct
either way, because it is always computed against the player's own position.
