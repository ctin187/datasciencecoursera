/**
 * Client for the Python VOR backend (see /backend).
 *
 * The base URL comes from VITE_API_BASE_URL at build time. When it isn't set
 * the UI says the backend is unconfigured rather than rendering an empty state
 * that could be mistaken for "your roster has no value".
 */

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const isBackendConfigured = (): boolean => API_BASE_URL.length > 0;

/**
 * Which season the numbers in a response actually describe, relative to the
 * one being played. Before a season kicks off nflverse has published nothing
 * for it, so the backend serves the previous season - and this is how the UI
 * knows to say so rather than passing last year's production off as a
 * forecast.
 */
export interface SeasonStatus {
  season: number | null;
  current_season: number;
  is_current_season: boolean;
  weeks_played?: number;
  status: 'prior-season-complete' | 'in-progress' | 'complete' | 'no-data';
  note: string;
}

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
  season_status?: SeasonStatus;
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
  season_status?: SeasonStatus;
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

// ---------------------------------------------------------------------------
// Cold starts
//
// The backend runs on a free Render instance, which sleeps after inactivity
// and takes ~30s to wake, then another minute to ingest nflverse data before
// the data endpoints answer. From a browser both stages look like failure:
// Render's holding response during wake-up carries no CORS headers, so the
// fetch rejects outright rather than returning a status, and once the process
// is up the data endpoints return 503 until the first refresh lands.
//
// Neither is a real error, so retry through both rather than reporting the
// service as unreachable. Every endpoint here is a pure read - the POST
// bodies describe a computation, they don't mutate anything - so replaying a
// request is safe.
// ---------------------------------------------------------------------------

/** Backoff schedule, ~79s total: covers wake-up plus part of the first ingest. */
let retryDelaysMs = [2000, 4000, 8000, 15000, 20000, 30000];

/** Test seam: shrink the schedule so retry behaviour is testable in ms. */
export function __setRetryDelaysForTests(delays: number[]): void {
  retryDelaysMs = delays;
}

type WakeListener = (waking: boolean) => void;
const wakeListeners = new Set<WakeListener>();
let waking = false;

/**
 * Notifies when the client is sitting in a retry loop, so the UI can say
 * "waking the backend" instead of leaving a spinner unexplained.
 */
export function onBackendWaking(fn: WakeListener): () => void {
  wakeListeners.add(fn);
  fn(waking);
  return () => wakeListeners.delete(fn);
}

function setWaking(v: boolean): void {
  if (waking === v) return;
  waking = v;
  for (const fn of wakeListeners) fn(v);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 502/503/504 are Render waking or the cache still filling; 429 is throttling. */
const isRetryableStatus = (s: number) => s === 502 || s === 503 || s === 504 || s === 429;

async function readDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j.detail === 'string') return j.detail;
    // The cache-not-ready 503 sends a structured detail; pull out its hint
    // rather than dumping JSON at the user.
    if (j.detail && typeof j.detail === 'object') {
      const d = j.detail as { error?: string; hint?: string };
      return [d.error, d.hint].filter(Boolean).join(' — ') || JSON.stringify(j.detail);
    }
    return JSON.stringify(j.detail ?? j);
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isBackendConfigured()) {
    throw new BackendError('Backend not configured (VITE_API_BASE_URL is unset).');
  }

  let lastError: BackendError | null = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      setWaking(true);
      await sleep(retryDelaysMs[attempt - 1]);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}${path}`, init);
    } catch {
      // Network-level rejection. During a Render cold start this is what a
      // CORS-header-less holding response looks like, so keep retrying.
      lastError = new BackendError(
        `Could not reach the backend at ${API_BASE_URL} after retrying for about 80 seconds. ` +
          `Its free tier sleeps after inactivity — reload in a minute and it should be awake.`,
      );
      continue;
    }

    if (res.ok) {
      setWaking(false);
      return (await res.json()) as T;
    }

    const detail = await readDetail(res);
    lastError = new BackendError(
      res.status === 503
        ? `The backend is awake but still loading its data (${detail}). This finishes about a minute after it wakes.`
        : detail,
      res.status,
    );
    if (!isRetryableStatus(res.status)) break;
  }

  setWaking(false);
  throw lastError ?? new BackendError('Unknown backend error.');
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path);
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

// ---------------------------------------------------------------------------
// Whole-player-universe endpoints (not scoped to one roster) - the backbone
// for anything that needs a value for a player nobody has rostered yet:
// draft boards, and any retrospective "was this pick good" analysis.
// ---------------------------------------------------------------------------

export interface ProjectedPlayer {
  player_id: string; // GSIS ID
  sleeper_id: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  games_sampled: number;
  projected_points_per_game: number;
  rest_of_season_points: number;
}

export interface ProjectionsResponse {
  provenance: Provenance;
  season: number;
  season_status?: SeasonStatus;
  as_of_week: number;
  latest_cached_week: number;
  games_remaining: number;
  scoring_analysis: ScoringAnalysis;
  count: number;
  players: ProjectedPlayer[];
}

export async function fetchProjections(params: { scoringSettings: Record<string, number>; limit?: number }): Promise<ProjectionsResponse> {
  const q = new URLSearchParams({
    scoring: JSON.stringify(params.scoringSettings),
    limit: String(params.limit ?? 2000),
  });
  return get<ProjectionsResponse>(`/projections?${q.toString()}`);
}

export async function fetchReplacementLevelsGet(params: {
  scoringSettings: Record<string, number>;
  rosterPositions: string[];
  numTeams: number;
}): Promise<{ provenance: Provenance; replacement_levels: Record<string, ReplacementLevel> }> {
  const q = new URLSearchParams({
    scoring: JSON.stringify(params.scoringSettings),
    roster_positions: params.rosterPositions.join(','),
    num_teams: String(params.numTeams),
  });
  return get(`/players/replacement-level?${q.toString()}`);
}
