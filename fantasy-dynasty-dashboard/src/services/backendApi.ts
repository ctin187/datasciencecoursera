/**
 * Client for the Python VOR backend (see /fantasy-backend).
 *
 * The base URL comes from VITE_API_BASE_URL at build time. When it isn't set
 * the UI says the backend is unconfigured rather than rendering an empty state
 * that could be mistaken for "your roster has no value".
 */

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const isBackendConfigured = (): boolean => API_BASE_URL.length > 0;

export interface Provenance {
  data_as_of: string | null;
  age_hours: number | null;
  stale: boolean;
  last_error: string | null;
  source: string;
}

export interface VorPlayer {
  sleeper_id: string;
  gsis_id: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  has_projection: boolean;
  reason?: string;
  projected_points_per_game: number | null;
  replacement_points: number | null;
  vor_per_game: number | null;
  vor_rest_of_season: number | null;
}

export interface StarterSlot {
  slot: string;
  empty: boolean;
  player: VorPlayer | null;
  slot_mismatch?: boolean;
  slot_mismatch_reason?: string | null;
}

export interface TeamReport {
  roster_id: number;
  owner_name: string | null;
  league_rank: number;
  starters: StarterSlot[];
  bench: VorPlayer[];
  starter_vor_total_per_game: number;
  starter_vor_rest_of_season: number;
  starters_with_projection: number;
  starters_missing_projection: number;
}

export interface ReplacementLevel {
  position: string;
  dedicated_starters: number;
  flex_absorbed: number;
  total_startable: number;
  replacement_rank: number;
  replacement_points: number;
  replacement_player: string | null;
  method: string;
}

export interface ScoringAnalysis {
  supported_keys: string[];
  unsupported_keys: Record<string, string>;
  out_of_scope_keys: string[];
  fully_supported: boolean;
}

export interface RosterHealthResponse {
  provenance: Provenance;
  season: number;
  as_of_week: number;
  latest_cached_week: number;
  games_remaining: number;
  num_teams: number;
  scoring_analysis: ScoringAnalysis;
  replacement_levels: Record<string, ReplacementLevel>;
  id_resolution: {
    total: number;
    matched_by_id: number;
    matched_by_name: number;
    unmatched: number;
    unmatched_players: { sleeper_id: string; name: string | null; position: string | null }[];
  };
  methodology: string;
  teams: TeamReport[];
  focus_roster_id: number | null;
}

export interface RosterHealthRequest {
  season?: number | null;
  week?: number | null;
  num_teams: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  rosters: {
    roster_id: number;
    owner_name: string | null;
    player_ids: string[];
    starters: string[];
  }[];
  focus_roster_id?: number | null;
  player_meta: Record<string, { name: string | null; position: string | null }>;
}

export interface UsageTrend {
  games_in_window: number;
  games_in_prior: number;
  recent: Record<string, number>;
  prior: Record<string, number>;
  delta_pct: Record<string, number | null>;
  /** null when there's no prior window to compare against - no trend is claimed. */
  direction: 'rising' | 'falling' | 'stable' | null;
  direction_basis: string;
}

export interface WaiverTarget extends VorPlayer {
  usage: UsageTrend | null;
  upgrade_over_weakest_starter: number | null;
  weakest_starter_vor_at_position: number | null;
}

export interface BenchPlayer extends VorPlayer {
  below_replacement: boolean;
}

export interface WaiverTargetsResponse {
  provenance: Provenance;
  season: number;
  as_of_week: number;
  games_remaining: number;
  scoring_analysis: ScoringAnalysis;
  replacement_levels: Record<string, ReplacementLevel>;
  methodology: string;
  count: number;
  targets: WaiverTarget[];
  bench_ranked: BenchPlayer[];
}

export interface WaiverTargetsRequest {
  season?: number | null;
  week?: number | null;
  num_teams: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  rostered_sleeper_ids: string[];
  my_bench_sleeper_ids: string[];
  my_starter_sleeper_ids: string[];
  limit?: number;
}

export class BackendError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!isBackendConfigured()) {
    throw new BackendError('Backend not configured (VITE_API_BASE_URL is unset).');
  }
  console.debug('[backendApi] POST', path);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new BackendError(
      `Could not reach the backend at ${API_BASE_URL}. It may be asleep (free tiers idle out) or the URL may be wrong.`,
    );
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* keep the status-code message */
    }
    throw new BackendError(detail, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchRosterHealth(req: RosterHealthRequest): Promise<RosterHealthResponse> {
  return post<RosterHealthResponse>('/roster-health', req);
}

export async function fetchWaiverTargets(req: WaiverTargetsRequest): Promise<WaiverTargetsResponse> {
  return post<WaiverTargetsResponse>('/waiver-targets', req);
}

export async function fetchHealth(): Promise<{ status: string; provenance: Provenance }> {
  if (!isBackendConfigured()) throw new BackendError('Backend not configured.');
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new BackendError(`HTTP ${res.status}`, res.status);
  return res.json();
}
