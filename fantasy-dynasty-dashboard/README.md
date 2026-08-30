# Fantasy Dynasty Dashboard

A research-backed, data-driven dashboard for Sleeper dynasty fantasy football leagues. Built for a 10-team
dynasty startup draft: paste your Sleeper League ID and the app pulls your league's live settings, rosters,
and users, then layers on draft strategy, trade analysis, waiver optimization, and aging-curve projections.

## Features

- **League Settings** — scoring format, roster construction, FAAB budget, playoff structure, and per-team
  record/FAAB standings, all pulled live from Sleeper.
- **Draft Assistant** — consensus ADP vs. a computed "3D Value" (current + 3/5/10-year outlook), sleeper/reach
  flags, tier breakpoints, and positional scarcity.
- **Trade Analyzer** — build both sides of a trade (players + picks), see the value delta, win-now vs. rebuild
  context, and each player's age curve / multi-year outlook.
- **Waivers** — free-agent board ranked by a simulated opportunity score (snap share / target share trend) with
  suggested FAAB bids scaled to your league's budget.
- **Aging Curves** — position-specific decline curves (QB/RB/WR/TE), a per-player multi-year projection chart,
  and a sell-high candidate list.
- **Roster Health** — lifecycle-phase detection (win-now / contend / rebuild / stuck-in-the-middle), a
  retirement-risk heatmap, and a 3-year future-roster projection.
- **Season Outlook** — Monte Carlo playoff and championship probability, built entirely from real Sleeper
  matchup results (not fabricated projections). See below for method and limitations.

## Getting started

```bash
npm install
npm run dev
```

Open the app, paste a Sleeper League ID (the long number in your league's URL, e.g.
`sleeper.com/leagues/918876425783136256/team`), and optionally your Sleeper User ID to see your own roster
analysis.

## Architecture

```
src/
  services/sleeperApi.ts    Sleeper API client: fetch + localStorage caching + rate-limit-friendly queueing
  services/cache.ts         TTL-based localStorage cache with stale-data fallback on network failure
  lib/agingCurves.ts        Position-specific aging curve model + multi-year projection
  lib/valueCalculator.ts    "3D Value" computation (current + 3/5/10-yr outlook) and percentile ranking
  lib/draftAssistant.ts     Tiering, tier-breakpoint detection, positional scarcity
  lib/tradeAnalyzer.ts      Trade value delta, win-now/rebuild context assessment
  lib/waiverOptimizer.ts    Snap/target share trend estimation, FAAB bid suggestions
  lib/rosterAnalyzer.ts     Lifecycle-phase detection, retirement risk, future roster projection
  lib/seasonSimulator.ts    Monte Carlo playoff/championship probability from real matchup history
  hooks/useSeasonSimulation.ts  Fetches every week's matchups + the playoff bracket, runs the simulator
  data/consensusPlayers.ts  Curated seed dataset (ADP + dynasty trade value) — see note below
  lib/playerMatcher.ts      Joins the seed dataset to live Sleeper player IDs by normalized name
  hooks/                    useLeagueData (Sleeper fetch orchestration), useDerivedData (memoized value calcs)
  components/tabs/          One component per dashboard tab
  components/ui/            Shared table/card/badge primitives
```

## Data sources & limitations

- **League, roster, user, player, and draft data** come live from the public [Sleeper API](https://docs.sleeper.com/)
  (no auth required) and are cached client-side (localStorage) to stay well under Sleeper's rate limit and avoid
  re-downloading the ~5MB `/players/nfl` payload every session.
- **Consensus ADP and dynasty trade values** (FantasyPros ECR, Underdog ADP, KeepTradeCut, Draft Sharks) are not
  available through any free public API. `src/data/consensusPlayers.ts` is a hand-curated seed dataset covering
  the top ~130 dynasty-relevant players — treat it as a starting point to refresh periodically from a live export,
  not a real-time feed.
- **Snap count / target share trends** on the Waivers tab are simulated (deterministic per player) as a stand-in
  for a licensed stats feed — see the comment in `lib/waiverOptimizer.ts` for what to swap in for production use.
- **Current-season point projections** are approximated from consensus ADP rank via a decay curve
  (`lib/valueCalculator.ts`), since the app has no licensed weekly-projection feed.

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
are labeled as model estimates in the UI, not guarantees — every card states the simulation count and the
weeks actually played (i.e. the sample size) so you can judge how much to trust a given number. With zero
completed weeks the tab refuses to simulate at all rather than fabricate a projection-based estimate.

## Tech stack

React 19 + TypeScript + Vite, Tailwind CSS v4, Recharts. No backend — everything runs client-side against the
public Sleeper API.
