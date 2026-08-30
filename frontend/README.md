# Fantasy Decision Intelligence Dashboard

A league-specific quantitative decision-support tool for Sleeper fantasy football — not a generic rankings
site. Paste a Sleeper League ID and the app pulls that league's real settings, rosters, users, matchups, and
playoff bracket, auto-detects its format (redraft vs. keeper vs. dynasty, scoring, superflex, waivers,
playoffs), and layers real analytics on top: value over replacement from actual nflverse projections, and
Monte Carlo playoff/championship probability from actual matchup history.

This is being built in phases (see Roadmap below). Nothing here is a placeholder dressed up as a finished
feature — a tab that can't back a number with real data says so instead of showing one.

## Features (implemented)

- **League Overview** — auto-detects scoring format (PPR/half/standard, TE/RB/WR premium), QB format (1QB /
  superflex / 2QB), league type (redraft / keeper / dynasty, from Sleeper's own `settings.type` plus
  corroborating signals like taxi slots), waiver system (FAAB vs. non-FAAB) and budget, trade deadline,
  playoff structure, draft type/status/rounds, full roster construction (bench/IR/taxi), and IDP/kicker usage
  — every detected field states what it's based on, and inferred fields are labeled as such rather than
  presented as fact. Also shows live standings and your current roster.
- **Edge Engine** — the "what should I do" home base. An Action Center (rules-based synthesis, not a language
  model call — see below) prioritizes your empty starting slots, best waiver add, and championship-probability
  trajectory. Below it, every edge signal (championship/playoff edge vs. an equal 1/N share, starting-lineup
  and bench-depth VOR vs. league average, retrospective draft-day VOR efficiency, best current waiver
  opportunity) is a comparison of two numbers already computed elsewhere in the app — nothing new is
  calculated here, and a signal with no real data behind it says "insufficient evidence" rather than showing
  zero.
- **Roster Value** — value-over-replacement (VOR) for every rostered player, computed by the Python backend
  from real nflverse play-by-play data under *this league's exact scoring settings and starting-lineup
  requirements* (not a generic ranking). Shows per-team league rankings, your starters/bench with per-player
  VOR, the league's actual replacement-level baseline at each position, and exactly which of the league's
  scoring rules the projection engine can and can't apply.
- **Draft Assistant** — a live draft board: on-the-clock/nomination tracking from Sleeper's real snake/linear
  slot math, undrafted players ranked by VOR (pulled from the backend's full projected-player universe, not
  just rostered players), each one's positional drop-off (scarcity), and — via a greedy lineup optimizer — the
  real marginal value of adding that specific player to your specific roster right now. This is the product
  spec's opportunity-cost example (Player A's raw value vs. Player B's marginal value) implemented on real
  data. Explicitly NOT implemented: probability a player is still available at your next pick, which needs a
  real ADP feed this app has no legitimate free source for.
- **Trade Analyzer** — build both sides of a trade, and see real before/after starter VOR (lineups
  re-optimized on both sides) *and* before/after playoff/championship probability, by feeding the VOR delta
  into the same Monte Carlo season simulator as a per-team mean-score shift. Not a static trade-value chart.
- **Waiver Wire** — every meaningful free agent ranked by the same VOR model, plus usage-trend direction and
  "upgrade over your weakest starter." For FAAB leagues, a **FAAB bid guidance** section derives a real
  $-per-VOR-point rate from this league's own historical winning bids (25th/50th/75th percentile) and applies
  it to each target — not a fabricated win-probability number, which the spec explicitly warns against
  overstating.
- **Season Outlook** — Monte Carlo playoff and championship probability (default 4,000 simulated seasons),
  built entirely from real Sleeper matchup results. See "Season Outlook: method & limitations" below.
- **League DNA** — per-manager behavioral profiles built from this league's own draft picks and transactions
  only. Positional draft tendency (rounds earlier/later than *this league's own average* for that position — a
  real, self-referential signal, since a market-relative "reach vs. ADP" metric needs external ADP data this
  app doesn't have) is pooled across every season Franchise History's `previous_league_id` walk found, keyed
  by `owner_id` since Sleeper's `roster_id` numbering isn't stable season to season. Trade frequency and FAAB
  spend stay current-season-only (fetching full transaction history per prior season isn't done, to bound the
  API call count), each with a percentile rank among your league mates. Every profile states its sample size —
  picks across N seasons, one season of transactions — rather than implying more track record than the data
  supports.
- **Franchise History** — real per-season standings, champions, and runner-ups, walked from Sleeper's own
  `previous_league_id` chain (bounded to a handful of seasons to keep the request count reasonable). Champion
  comes from that season's actual playoff bracket where available; a season without one falls back to best
  regular-season record, labeled as such rather than asserted as the real playoff result.

## Getting started

```bash
npm install
npm run dev
```

Run the test suite (pure logic only — `lib/*.ts`, no component tests) with:

```bash
npm test
```

It's also gated in CI: `.github/workflows/deploy-frontend.yml` runs it before every deploy, so a broken
lib module fails the build instead of shipping.

Open the app, paste a Sleeper League ID (the long number in your league's URL, e.g.
`sleeper.com/leagues/918876425783136256/team`), and pick your team from the dropdown once it loads to see
roster-specific analysis. Works for both redraft and dynasty/keeper leagues.

Roster Value, Draft Assistant, Trade Analyzer, and Waiver Wire need the companion Python backend (`/backend`)
— set `VITE_API_BASE_URL` (see `.env.example`) to a running instance, or they'll say the backend isn't
configured rather than guessing.

## Architecture

```
src/
  services/sleeperApi.ts     Sleeper API client: fetch + localStorage caching + rate-limit-friendly queueing
  services/cache.ts          TTL-based localStorage cache with stale-data fallback on network failure
  services/backendApi.ts     Client for the Python VOR/projections/waiver backend
  lib/leagueConfig.ts        Normalizes raw Sleeper league settings into a labeled, source-transparent config
  lib/leagueFormat.ts        Derives which positions (incl. IDP/K) and flex types a league actually starts
  lib/seasonSimulator.ts     Monte Carlo playoff/championship probability from real matchup history;
                              accepts a per-team mean-score adjustment for trade what-ifs
  lib/lineupOptimizer.ts     Greedy VOR-maximizing lineup assignment given a player pool and roster_positions
  lib/tradeSimulator.ts      Before/after VOR + championship-probability impact of a hypothetical trade
  lib/draftAssistant.ts      Snake/linear on-the-clock math; VOR ranking + marginal-value-for-your-roster
  lib/faabModel.ts           Empirical $-per-VOR rate from this league's own real historical FAAB bids
  lib/leagueDna.ts           Per-manager behavioral profiles from this league's own draft/transaction data
  lib/edgeEngine.ts          Aggregates already-computed results into edge/deficit comparisons
  lib/actionCenter.ts        Rules-based prioritization of the edge signals into a "what should I do" list
  lib/explain.ts             Rules-based (not LLM) natural-language explanations over structured results
  hooks/useLeagueData.ts     Sleeper fetch orchestration (league/rosters/users/players/drafts/traded picks)
  hooks/useSeasonSimulation.ts  Fetches every week's matchups + the playoff bracket, runs the simulator
  hooks/useRosterHealth.ts   Calls the backend's /roster-health with this league's real settings
  hooks/useWaiverTargets.ts  Calls the backend's /waiver-targets with this league's real settings
  hooks/useProjectionPool.ts Full projected-player universe (backend /projections + /replacement-level),
                              VOR computed client-side the same way the backend's POST endpoints do it
  hooks/useDraftPicks.ts     Draft picks with a manual (non-polling) live refresh
  hooks/useSeasonTransactions.ts  Every week's transactions this season (FAAB history + League DNA)
  hooks/useLeagueHistory.ts  Walks previous_league_id for prior seasons' rosters/users/draft/bracket
  lib/*.test.ts              Vitest unit tests for every pure lib/ module above (run: npm test)
  components/tabs/           One component per dashboard tab
  components/ui/             Shared table/card/badge primitives
```

## Data sources & limitations

- **League, roster, user, player, matchup, and draft data** come live from the public
  [Sleeper API](https://docs.sleeper.com/) (no auth required) and are cached client-side (localStorage) to stay
  well under Sleeper's rate limit and avoid re-downloading the ~5MB `/players/nfl` payload every session.
- **`settings.type` (league type) and `waiver_type` semantics** are long-stable, widely-used Sleeper fields,
  but this codebase's build/test environment could not reach `docs.sleeper.com` or `api.sleeper.app` to
  re-verify them live — treat the League Overview tab's league-type and waiver-system labels as schema
  interpretation (shown alongside the raw values and the signals used), not independently re-confirmed fact.
  If a label looks wrong for your league, the raw Sleeper values are shown right next to it.
- **Projections and VOR** come from the Python backend's nflverse ingestion — see `/backend/README.md` for
  its own extensive validation notes (scoring reconciled against nflverse's own `fantasy_points_ppr` across
  6,037 player-weeks, backtested projection accuracy, replacement-level sanity checks).
- **No hand-curated ADP/consensus-ranking dataset is shipped.** Earlier iterations of this app used one; it
  was removed because a static seed dataset silently goes stale and violates this project's own rule against
  presenting invented numbers as real data. ADP/consensus-ranking integration will come back once wired to a
  real, refreshable source.

## Season Outlook: method & limitations

The Season Outlook tab answers "what's my actual chance of winning this league" via a bootstrap-parametric
Monte Carlo simulation (thousands of simulated seasons, default 4,000):

1. Each team's real weekly scores are pulled from Sleeper's `/matchups/{week}` endpoint for every week that's
   actually been played. Already-played weeks are replayed exactly as they happened (real wins/losses/points
   from `roster.settings`) — nothing about the past is simulated.
2. Each team's future weekly score is modeled as Normal(mean, stdev), where mean/stdev are that team's own
   actual scores shrunk toward the league-wide average (an empirical-Bayes-style prior worth ~3 games) so a
   hot or cold start in Week 1-2 doesn't overwhelm the model before there's enough evidence to trust it.
3. Remaining weeks are simulated using the real future schedule — Sleeper publishes the full season's
   matchup pairings upfront, so the schedule itself isn't guessed.
4. A single-elimination playoff bracket is seeded from each simulated season's final standings (byes to the
   top seeds when the field isn't a power of two) and simulated through to a champion.

**Known simplifications, stated so they aren't mistaken for fact:** weekly scores are treated as independent
Normal draws (no player-level correlation or matchup-specific boosts); the regular-season tiebreaker used is
wins-then-points-for, which may not match your league's actual tiebreak rule; the playoff bracket is assumed
fully re-seeded each round (best remaining seed vs. worst remaining seed) rather than a fixed bracket, which
some leagues use instead; rosters/starters are assumed unchanged for the rest of the season. All probabilities
are labeled as model estimates in the UI, not guarantees. With zero completed weeks the tab refuses to
simulate at all rather than fabricate a projection-based estimate.

## Why the "AI analyst" is rules-based, not a live model call

The product spec asks for a layer that explains the analytical engine's outputs without inventing numbers.
`lib/explain.ts` and `lib/actionCenter.ts` do exactly that — but as deterministic templates over typed
structured data, not an actual call to an LLM. That was a deliberate choice, not a shortcut:

- It is structurally incapable of inventing a figure — every sentence is built from fields that already exist
  in a typed result object, so there is no path from "explain this" to a hallucinated statistic.
- It needs no API key, no server-side secret, no backend proxy endpoint, and no per-request cost — meaningful
  new infrastructure for a personal tool whose numbers already come with plain-language labels.
- It's clearly labeled as rules-based in the UI everywhere it appears, so it's never mistaken for a model call.

A real LLM call (e.g. wired through the existing Python backend, which already keeps secrets server-side)
would read more naturally and could synthesize across tabs more flexibly. If that's wanted, it's a scoped,
addable layer on top of this one, not a replacement for it — the structured outputs it would explain still
need to exist first, and now they do.

## Roadmap (not yet built)

- **ADP / consensus rankings from a real, refreshable source.** Nothing here today (an earlier iteration
  shipped a hand-curated seed dataset; it was removed as a violation of this project's own anti-fabrication
  rule — see Data sources above). Without it, two spec features stay explicitly out of scope rather than
  faked: probability a drafted player is still available at your next pick (Draft Assistant), and market-value
  vs. model-value mispricing (a true "Market Inefficiency Engine").
- **Monte Carlo draft simulation** (opponent-pick modeling, pick-availability probabilities) — blocked on the
  same missing ADP/variance data as the point above.
- **Draft-strategy backtesting** (VORP drafting, zero-RB, wait-on-QB, etc. tested against historical seasons)
  — still not implemented, and can't be honestly implemented without real historical ADP (same blocker as
  above): comparing a strategy against "what else was available" requires knowing what was actually available
  at each historical pick. What *is* now implemented, in `/backend/scripts/backtest_multi_season.py`: the same
  projection-accuracy and replacement-level-believability checks `validate.py` runs for 2025 alone, looped
  across multiple real seasons, so the model's documented behavior can be checked for whether it holds up
  out-of-sample rather than taken on faith for one season. That validates the projection/VOR *model*, not any
  drafting *strategy* — a narrower and more honest claim.
- **Real LLM analyst layer** — see the section above. Explicitly declined (not just deferred): asked and the
  answer was no, since it would need the user's own Anthropic API key and incur real per-request cost on their
  account for a feature the rules-based layer already covers.

## Tech stack

React 19 + TypeScript + Vite, Tailwind CSS v4. Talks directly to the public Sleeper API from the browser, plus
a companion Python/FastAPI backend (`/backend`) for nflverse-derived projections and VOR.
