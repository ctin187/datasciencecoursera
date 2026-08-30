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
- **Roster Value** — value-over-replacement (VOR) for every rostered player, computed by the Python backend
  from real nflverse play-by-play data under *this league's exact scoring settings and starting-lineup
  requirements* (not a generic ranking). Shows per-team league rankings, your starters/bench with per-player
  VOR, the league's actual replacement-level baseline at each position, and exactly which of the league's
  scoring rules the projection engine can and can't apply.
- **Waiver Wire** — every meaningful free agent ranked by the same VOR model, plus usage-trend direction and
  "upgrade over your weakest starter" — the question that actually matters, not just "who's the best player
  left." FAAB bid sizing and acquisition-probability modeling are not implemented yet (see Roadmap).
- **Season Outlook** — Monte Carlo playoff and championship probability (default 4,000 simulated seasons),
  built entirely from real Sleeper matchup results. See "Season Outlook: method & limitations" below.

## Getting started

```bash
npm install
npm run dev
```

Open the app, paste a Sleeper League ID (the long number in your league's URL, e.g.
`sleeper.com/leagues/918876425783136256/team`), and pick your team from the dropdown once it loads to see
roster-specific analysis. Works for both redraft and dynasty/keeper leagues.

Roster Value and Waiver Wire need the companion Python backend (`/backend`) — set `VITE_API_BASE_URL` (see
`.env.example`) to a running instance, or they'll say the backend isn't configured rather than guessing.

## Architecture

```
src/
  services/sleeperApi.ts     Sleeper API client: fetch + localStorage caching + rate-limit-friendly queueing
  services/cache.ts          TTL-based localStorage cache with stale-data fallback on network failure
  services/backendApi.ts     Client for the Python VOR/waiver backend
  lib/leagueConfig.ts        Normalizes raw Sleeper league settings into a labeled, source-transparent config
  lib/leagueFormat.ts        Derives which positions (incl. IDP/K) and flex types a league actually starts
  lib/seasonSimulator.ts     Monte Carlo playoff/championship probability from real matchup history
  hooks/useLeagueData.ts     Sleeper fetch orchestration (league/rosters/users/players/drafts/traded picks)
  hooks/useSeasonSimulation.ts  Fetches every week's matchups + the playoff bracket, runs the simulator
  hooks/useRosterHealth.ts   Calls the backend's /roster-health with this league's real settings
  hooks/useWaiverTargets.ts  Calls the backend's /waiver-targets with this league's real settings
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

## Roadmap (not yet built)

In rough priority order, following the product spec this app is being built against:

- **Draft Assistant** — opportunity-cost pick recommendations (marginal value over next-best alternative at
  position), tiering, positional scarcity, and Monte Carlo draft simulation for pick availability. Needs to
  branch meaningfully by league type: a redraft draft-day assistant and a dynasty startup/rookie draft
  assistant are different tools wearing the same UI, not one feature with a flag.
- **Trade Analyzer** — before/after championship-probability delta (via the season simulator), not a static
  trade-value chart.
- **FAAB Optimization** — recommended bid ranges with modeled win probability, informed by opponent FAAB
  remaining and historical bidding behavior.
- **League DNA / manager behavioral profiles** — draft tendencies, waiver aggression, trade frequency, reach-
  vs-ADP, with sample size and confidence shown, not asserted from a handful of data points.
- **Market Inefficiency / Edge engine** — model value vs. ADP, with an edge score computed only when the
  methodology actually supports one ("insufficient evidence" otherwise).
- **AI analyst layer** — explains the analytical engine's own outputs; never invents its own numbers.
- **Backtesting framework** — validate draft/trade strategies against historical seasons before trusting them.
- **ADP / consensus rankings from a real, refreshable source** (currently absent — see Data sources above).

## Tech stack

React 19 + TypeScript + Vite, Tailwind CSS v4. Talks directly to the public Sleeper API from the browser, plus
a companion Python/FastAPI backend (`/backend`) for nflverse-derived projections and VOR.
