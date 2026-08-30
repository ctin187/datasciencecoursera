// ---------------------------------------------------------------------------
// Core domain types for the Fantasy Football Decision Intelligence Dashboard
// ---------------------------------------------------------------------------

export type OffensivePosition = 'QB' | 'RB' | 'WR' | 'TE';
export type SpecialTeamsPosition = 'K' | 'DEF';
/** Sleeper's standard IDP granularity - individual defensive players are typed to one of these three summary positions. */
export type IdpPosition = 'DL' | 'LB' | 'DB';
export type Position = OffensivePosition | SpecialTeamsPosition | IdpPosition;

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  sport: string;
  status: string; // 'pre_draft' | 'drafting' | 'in_season' | 'complete'
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: {
    /** 0 = redraft, 1 = keeper, 2 = dynasty (per Sleeper's long-standing, widely-used convention). */
    type?: number;
    playoff_teams?: number;
    playoff_week_start?: number;
    trade_deadline?: number;
    waiver_budget?: number;
    waiver_type?: number;
    num_teams?: number;
    reserve_slots?: number;
    taxi_slots?: number;
    [key: string]: number | undefined;
  };
  previous_league_id?: string | null;
  draft_id?: string | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_against?: number;
    waiver_budget_used?: number;
    total_moves?: number;
    [key: string]: number | undefined;
  };
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: {
    team_name?: string;
    [key: string]: unknown;
  };
  is_owner?: boolean;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  status: string; // 'pre_draft' | 'drafting' | 'complete'
  type: string; // 'snake' | 'linear' | 'auction'
  start_time: number | null;
  settings: {
    rounds: number;
    teams: number;
    [key: string]: number | undefined;
  };
  season: string;
  /** user_id -> draft slot (1-indexed). Sleeper's per-user pick order. */
  draft_order?: Record<string, number> | null;
  /** draft slot (1-indexed, as string keys) -> roster_id. */
  slot_to_roster_id?: Record<string, number> | null;
}

export interface SleeperDraftPick {
  round: number;
  roster_id: number;
  player_id: string;
  picked_by: string;
  pick_no: number;
  draft_id: string;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position: Position | string;
  fantasy_positions?: string[];
  team: string | null;
  age: number | null;
  years_exp: number | null;
  status: string; // 'Active' | 'Inactive' | 'Injured Reserve' | etc.
  injury_status?: string | null;
  height?: string;
  weight?: string;
  college?: string;
  number?: number | null;
  depth_chart_order?: number | null;
  /** Sleeper's own relevance ordinal across its full player database (lower = more notable). Not fantasy-specific, but the only universal signal available for players outside the curated seed dataset. */
  search_rank?: number | null;
}

export type PlayersMap = Record<string, SleeperPlayer>;

export interface SleeperTransaction {
  type: string; // 'waiver' | 'free_agent' | 'trade'
  status: string;
  roster_ids: number[];
  settings?: {
    waiver_bid?: number;
    [key: string]: number | undefined;
  };
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  created: number;
  leg: number;
}

/** One traded draft pick. Only picks that have actually changed hands appear here - an original, never-traded pick belongs to its original roster_id and simply doesn't show up in this list. */
export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number; // the pick's original owner
  previous_owner_id: number;
  owner_id: number; // current owner
}

// ---------------------------------------------------------------------------
// Weekly matchups / playoff bracket / NFL state — inputs to the season simulator
// ---------------------------------------------------------------------------

export interface SleeperMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number;
  starters?: string[] | null;
  players?: string[] | null;
}

/** One node in Sleeper's single-elimination playoff bracket. `p` marks a placement game (3rd place, etc.) - absent on the real championship match. */
export interface WinnersBracketMatchup {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  t1_from?: { w?: number; l?: number } | null;
  t2_from?: { w?: number; l?: number } | null;
  p?: number;
}

export interface NflState {
  week: number;
  season: string;
  season_type: string; // 'pre' | 'regular' | 'post'
}

export interface CachedEntry<T> {
  timestamp: number;
  data: T;
}
