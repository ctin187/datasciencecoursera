import type { SleeperDraft, SleeperLeague } from '../types';
import { detectLeagueFormat, type LeagueFormat } from './leagueFormat';

export type LeagueType = 'redraft' | 'keeper' | 'dynasty' | 'unknown';
export type WaiverSystem = 'faab' | 'non-faab';

export interface DetectedLeagueConfig {
  name: string;
  season: string;
  status: string;
  totalTeams: number;

  pprLabel: string;
  receptionPoints: number;
  tePremiumBonus: number | null;
  rbPremiumBonus: number | null;
  wrPremiumBonus: number | null;

  format: LeagueFormat;
  rosterPositions: string[];
  startingQbSlots: number;
  hasSuperFlexSlot: boolean;
  qbFormatLabel: string;
  benchSlots: number;
  irSlots: number;
  taxiSlots: number;

  leagueType: LeagueType;
  leagueTypeConfidence: 'reported' | 'inferred' | 'unknown';
  leagueTypeSignals: string[];

  waiverSystem: WaiverSystem;
  waiverSystemNote: string;
  faabBudget: number | null;
  tradeDeadlineWeek: number | null;

  playoffTeams: number | null;
  playoffWeekStart: number | null;

  draftType: string | null;
  draftStatus: string | null;
  draftRounds: number | null;
  draftId: string | null;
}

function scoringLabel(scoring: Record<string, number>): { label: string; rec: number } {
  const rec = scoring.rec ?? 0;
  if (rec === 1) return { label: 'Full PPR', rec };
  if (rec === 0.5) return { label: 'Half PPR', rec };
  if (rec === 0) return { label: 'Standard (no PPR)', rec };
  return { label: `${rec} pt/reception`, rec };
}

/**
 * Normalizes a raw Sleeper league + its draft objects into one structured
 * configuration description. Every field is either read directly off Sleeper
 * (labeled accordingly) or explicitly flagged as inferred, so nothing here
 * is presented as more certain than it is.
 *
 * `settings.type` (0=redraft, 1=keeper, 2=dynasty) and `waiver_type` are
 * long-stable, widely-used Sleeper fields, but this build environment could
 * not reach docs.sleeper.com to re-verify their exact semantics live -
 * treat the league-type/waiver-system labels as schema interpretation, not
 * an independently re-confirmed fact, and check them against your own league
 * if something looks off.
 */
export function detectLeagueConfig(league: SleeperLeague, drafts: SleeperDraft[]): DetectedLeagueConfig {
  const { label: pprLabel, rec: receptionPoints } = scoringLabel(league.scoring_settings);
  const format = detectLeagueFormat(league.roster_positions);

  const upper = league.roster_positions.map((p) => p.toUpperCase());
  const startingQbSlots = upper.filter((p) => p === 'QB').length;
  const hasSuperFlexSlot = upper.includes('SUPER_FLEX');
  const is2Qb = startingQbSlots >= 2;
  const qbFormatLabel = is2Qb && hasSuperFlexSlot ? '2QB + Superflex' : is2Qb ? '2QB' : hasSuperFlexSlot ? 'Superflex' : 'Standard 1QB';

  const benchSlots = upper.filter((p) => p === 'BN').length;
  const irSlots = league.settings.reserve_slots ?? 0;
  const taxiSlots = league.settings.taxi_slots ?? 0;

  // League type: settings.type is a documented Sleeper field (0/1/2), used as
  // primary signal when present. taxi_slots > 0 only ever makes sense in a
  // keeper/dynasty league, so it corroborates (never overrides) that reading.
  const rawType = league.settings.type;
  const signals: string[] = [];
  let leagueType: LeagueType = 'unknown';
  let confidence: DetectedLeagueConfig['leagueTypeConfidence'] = 'unknown';
  if (rawType === 0 || rawType === 1 || rawType === 2) {
    leagueType = rawType === 0 ? 'redraft' : rawType === 1 ? 'keeper' : 'dynasty';
    confidence = 'reported';
    signals.push(`Sleeper settings.type = ${rawType} (${leagueType})`);
  } else if (taxiSlots > 0) {
    leagueType = 'dynasty';
    confidence = 'inferred';
    signals.push(`settings.type not present; inferred dynasty from taxi_slots = ${taxiSlots} (a redraft-only league has no use for a taxi squad)`);
  } else {
    signals.push('No settings.type field and no dynasty-only settings (taxi squad) present - could not determine league type.');
  }
  if (taxiSlots > 0 && confidence === 'reported' && leagueType !== 'dynasty') {
    signals.push(`Note: taxi_slots = ${taxiSlots} despite league type reading as "${leagueType}" - unusual combination, worth double-checking.`);
  }

  // Waivers: waiver_budget is unambiguous ground truth for FAAB. The
  // non-FAAB rolling-vs-reverse-standings distinction (waiver_type 0 vs 1)
  // is community-documented but not re-verified live here, so it's reported
  // as a raw value rather than asserted as a confident label.
  const faabBudget = league.settings.waiver_budget ?? null;
  const waiverSystem: WaiverSystem = faabBudget && faabBudget > 0 ? 'faab' : 'non-faab';
  const waiverSystemNote =
    waiverSystem === 'faab'
      ? `FAAB bidding, $${faabBudget} season budget`
      : `Non-FAAB waivers (raw waiver_type=${league.settings.waiver_type ?? 'unset'}) - typically rolling priority or reverse-standings; not independently reverified against Sleeper's docs this session`;

  const activeDraft = drafts.find((d) => d.league_id === league.league_id) ?? drafts[0] ?? null;

  return {
    name: league.name,
    season: league.season,
    status: league.status,
    totalTeams: league.total_rosters,

    pprLabel,
    receptionPoints,
    tePremiumBonus: league.scoring_settings.bonus_rec_te ?? null,
    rbPremiumBonus: league.scoring_settings.bonus_rec_rb ?? null,
    wrPremiumBonus: league.scoring_settings.bonus_rec_wr ?? null,

    format,
    rosterPositions: league.roster_positions,
    startingQbSlots,
    hasSuperFlexSlot,
    qbFormatLabel,
    benchSlots,
    irSlots,
    taxiSlots,

    leagueType,
    leagueTypeConfidence: confidence,
    leagueTypeSignals: signals,

    waiverSystem,
    waiverSystemNote,
    faabBudget,
    tradeDeadlineWeek: league.settings.trade_deadline ?? null,

    playoffTeams: league.settings.playoff_teams ?? null,
    playoffWeekStart: league.settings.playoff_week_start ?? null,

    draftType: activeDraft?.type ?? null,
    draftStatus: activeDraft?.status ?? null,
    draftRounds: activeDraft?.settings?.rounds ?? null,
    draftId: activeDraft?.draft_id ?? null,
  };
}
