import { useEffect, useState } from 'react';
import {
  fetchProjections,
  fetchReplacementLevelsGet,
  isBackendConfigured,
  BackendError,
  type ReplacementLevel,
} from '../services/backendApi';
import type { PlayersMap, SleeperLeague } from '../types';
import { detectLeagueFormat } from '../lib/leagueFormat';
import {
  buildSupplementalPool,
  buildFullFallbackPool,
  unprojectedPositions,
  type ValueSource,
} from '../lib/supplementalPool';

export interface PooledPlayer {
  sleeperId: string;
  gsisId: string;
  name: string | null;
  position: string | null;
  team: string | null;
  projectedPointsPerGame: number;
  vorPerGame: number | null;
  restOfSeasonPoints: number;
  /**
   * How this player's ordering was derived. 'backend-vor' is a real projection
   * minus this league's replacement level. 'sleeper-rank' is Sleeper's own
   * relevance ordinal, used for positions the backend cannot project (K, DEF,
   * IDP) - it is NOT a projection and must never be rendered as one.
   */
  valueSource: ValueSource;
  /** Sleeper relevance ordinal, lower = more notable. Only set for 'sleeper-rank' rows. */
  sleeperRank: number | null;
}

export interface ProjectionPoolState {
  bySleeperId: Map<string, PooledPlayer>;
  replacementLevels: Record<string, ReplacementLevel> | null;
  loading: boolean;
  error: string | null;
  backendConfigured: boolean;
  asOfWeek: number | null;
  gamesRemaining: number | null;
  /** Rostered positions the backend cannot project (K/DEF/IDP), so the UI can say so. */
  unprojectedPositions: string[];
  /** True when NOTHING came from the backend and the whole pool is Sleeper-rank ordered. */
  fullFallback: boolean;
}

/**
 * The full projected-player universe (not scoped to any one roster), with
 * VOR computed the same way the backend's own POST endpoints do it:
 * projected points/game minus this league's replacement level at that
 * position. Backbone for anything that needs a value for a player nobody
 * has rostered yet - the Draft Assistant board, and retrospective "was this
 * pick good" analysis.
 */
export function useProjectionPool(
  league: SleeperLeague | undefined,
  players?: PlayersMap,
): ProjectionPoolState {
  const [bySleeperId, setBySleeperId] = useState<Map<string, PooledPlayer>>(new Map());
  const [replacementLevels, setReplacementLevels] = useState<Record<string, ReplacementLevel> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOfWeek, setAsOfWeek] = useState<number | null>(null);
  const [gamesRemaining, setGamesRemaining] = useState<number | null>(null);
  const [fullFallback, setFullFallback] = useState(false);

  const format = league ? detectLeagueFormat(league.roster_positions) : null;
  const unprojected = format ? unprojectedPositions(format) : [];

  /** Sleeper-rank rows for positions the backend can't value. Never overwrites a real projection. */
  function supplement(
    base: Map<string, PooledPlayer>,
    playersMap: PlayersMap,
    fmt: NonNullable<typeof format>,
    everything: boolean,
  ): Map<string, PooledPlayer> {
    const extra = everything
      ? buildFullFallbackPool(playersMap, fmt)
      : buildSupplementalPool(playersMap, fmt, new Set(base.keys()));
    const merged = new Map(base);
    for (const [id, s] of extra) {
      if (merged.has(id)) continue;
      merged.set(id, {
        sleeperId: s.sleeperId,
        gsisId: '',
        name: s.name,
        position: s.position,
        team: s.team,
        projectedPointsPerGame: 0,
        vorPerGame: null, // deliberately null - there is no projection to derive one from
        restOfSeasonPoints: 0,
        valueSource: s.valueSource,
        sleeperRank: s.sleeperRank,
      });
    }
    return merged;
  }

  useEffect(() => {
    if (!league) {
      setBySleeperId(new Map());
      setReplacementLevels(null);
      setFullFallback(false);
      return;
    }
    // No backend at all: still give the draft board something real to work
    // with, ordered by Sleeper's own relevance rank across every rostered
    // position, rather than rendering an empty tab.
    if (!isBackendConfigured()) {
      setError(null);
      if (players && format) {
        setBySleeperId(supplement(new Map(), players, format, true));
        setFullFallback(true);
      }
      return;
    }
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const [projRes, replRes] = await Promise.all([
          fetchProjections({ scoringSettings: league!.scoring_settings }),
          fetchReplacementLevelsGet({
            scoringSettings: league!.scoring_settings,
            rosterPositions: league!.roster_positions,
            numTeams: league!.total_rosters,
          }),
        ]);
        if (cancelled) return;

        const map = new Map<string, PooledPlayer>();
        for (const p of projRes.players) {
          if (!p.sleeper_id) continue;
          const repl = replRes.replacement_levels[p.position ?? ''];
          map.set(p.sleeper_id, {
            sleeperId: p.sleeper_id,
            gsisId: p.player_id,
            name: p.name,
            position: p.position,
            team: p.team,
            projectedPointsPerGame: p.projected_points_per_game,
            vorPerGame: repl ? p.projected_points_per_game - repl.replacement_points : null,
            restOfSeasonPoints: p.rest_of_season_points,
            valueSource: 'backend-vor',
            sleeperRank: null,
          });
        }
        // Add K/DEF/IDP from Sleeper rank. Without this, a league that starts
        // those positions gets a draft board that silently omits roster spots
        // it is required to fill.
        setBySleeperId(players && format ? supplement(map, players, format, false) : map);
        setFullFallback(false);
        setReplacementLevels(replRes.replacement_levels);
        setAsOfWeek(projRes.as_of_week);
        setGamesRemaining(projRes.games_remaining);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof BackendError ? err.message : 'Could not load the player projection pool.');
        // Backend failed mid-flight - fall back to a rank-ordered board rather
        // than leaving the draft tab empty.
        if (players && format) {
          setBySleeperId(supplement(new Map(), players, format, true));
          setFullFallback(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.league_id, league?.season, JSON.stringify(league?.scoring_settings), league?.roster_positions.join(','), league?.total_rosters]);

  return {
    bySleeperId,
    replacementLevels,
    loading,
    error,
    backendConfigured: isBackendConfigured(),
    asOfWeek,
    gamesRemaining,
    unprojectedPositions: unprojected,
    fullFallback,
  };
}
