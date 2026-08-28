// ---------------------------------------------------------------------------
// Core domain types for the Fantasy Football Dynasty League Dashboard
// ---------------------------------------------------------------------------

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

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

// ---------------------------------------------------------------------------
// Derived / computed types
// ---------------------------------------------------------------------------

export interface AgingCurvePoint {
  age: number;
  multiplier: number; // relative to peak (1.0 = peak)
}

export interface AgingCurveModel {
  position: Position;
  peakStart: number;
  peakEnd: number;
  declineStartRate: number; // % decline per year immediately after peak
  declineLateRate: number; // % decline per year in the "cliff" zone
  cliffAge: number; // age at which decline accelerates
  breakoutFloor: number; // youngest age curve considers "established"
}

export interface MultiYearProjection {
  year: number;
  age: number;
  projectedPoints: number;
  percentOfPeak: number;
}

export interface ThreeDValue {
  playerId: string;
  currentProjection: number;
  threeYearOutlook: number;
  fiveYearOutlook: number;
  tenYearOutlook: number;
  blendedValue: number;
  percentile: number; // 0-100 across the pool it was computed in
  multiYear: MultiYearProjection[];
}

export interface ConsensusADP {
  playerId: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  fantasyProsEcr: number;
  sleeperAdp: number;
  underdogAdp: number;
  consensusAdp: number; // blended
}

export interface TradeValueEntry {
  playerId: string;
  name: string;
  position: Position;
  age: number | null;
  fantasyProsValue: number;
  keepTradeCutValue: number;
  draftSharksValue: number;
  consensusValue: number; // blended 0-10000 scale
  tier: string;
}

export interface DraftTier {
  tier: string;
  position: Position | 'ALL';
  minValue: number;
  maxValue: number;
  players: string[]; // player IDs, ordered
}

export type LifecyclePhase = 'win-now' | 'contend' | 'middle' | 'rebuild';

export interface RosterAnalysis {
  rosterId: number;
  ownerName: string;
  phase: LifecyclePhase;
  avgAge: number;
  eliteAgingCount: number; // 28+ elite players
  youngAssetCount: number; // <=24 startable players
  totalValue: number;
  positionalAges: Record<Position, number[]>;
  positionalValues: Record<Position, number>; // summed consensus trade value per position
  starterValue: number;
  benchValue: number;
  retirementRisk: { playerId: string; risk: 'low' | 'medium' | 'high'; reason: string }[];
}

export interface DropCandidate {
  playerId: string;
  name: string;
  position: Position;
  reason: string;
}

export interface ResolvedPlayerValue {
  playerId: string;
  name: string;
  position: Position;
  age: number | null;
  team: string | null;
  status: string;
  consensusValue: number;
  tier: string;
  /** 'curated' = from the hand-curated ADP/trade-value seed dataset. 'estimated' = derived from Sleeper's search_rank, no seed entry. 'none' = no signal available at all. */
  source: 'curated' | 'estimated' | 'none';
}

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TeamGrade {
  rosterId: number;
  ownerName: string;
  contentionScore: number; // 0-100, weight 25%
  ageCurveScore: number; // 0-100, weight 20%
  depthScore: number; // 0-100, weight 25%
  injuryRiskScore: number; // 0-100 (higher = safer), weight 15%
  projectedPointsScore: number; // 0-100, weight 15%
  overall: number; // 0-100 weighted blend
  letter: LetterGrade;
  winNowGrade: number; // 0-100
  rebuildGrade: number; // 0-100
  longevityScore: number; // 0-100
  breakdown: string[]; // human-readable line items showing the math
}

export interface FaabSuggestion {
  playerId: string;
  name: string;
  position: Position;
  suggestedBid: number;
  minBid: number;
  maxBid: number;
  priority: 'HIGH PRIORITY' | 'MEDIUM' | 'LOW' | 'SPECULATIVE';
  reason: string;
}

export interface CachedEntry<T> {
  timestamp: number;
  data: T;
}
