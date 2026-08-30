import { useEffect, useState } from 'react';
import {
  fetchProjections,
  fetchReplacementLevelsGet,
  isBackendConfigured,
  BackendError,
  type ReplacementLevel,
} from '../services/backendApi';
import type { SleeperLeague } from '../types';

export interface PooledPlayer {
  sleeperId: string;
  gsisId: string;
  name: string | null;
  position: string | null;
  team: string | null;
  projectedPointsPerGame: number;
  vorPerGame: number | null;
  restOfSeasonPoints: number;
}

export interface ProjectionPoolState {
  bySleeperId: Map<string, PooledPlayer>;
  replacementLevels: Record<string, ReplacementLevel> | null;
  loading: boolean;
  error: string | null;
  backendConfigured: boolean;
  asOfWeek: number | null;
  gamesRemaining: number | null;
}

/**
 * The full projected-player universe (not scoped to any one roster), with
 * VOR computed the same way the backend's own POST endpoints do it:
 * projected points/game minus this league's replacement level at that
 * position. Backbone for anything that needs a value for a player nobody
 * has rostered yet - the Draft Assistant board, and retrospective "was this
 * pick good" analysis.
 */
export function useProjectionPool(league: SleeperLeague | undefined): ProjectionPoolState {
  const [bySleeperId, setBySleeperId] = useState<Map<string, PooledPlayer>>(new Map());
  const [replacementLevels, setReplacementLevels] = useState<Record<string, ReplacementLevel> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOfWeek, setAsOfWeek] = useState<number | null>(null);
  const [gamesRemaining, setGamesRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!league) {
      setBySleeperId(new Map());
      setReplacementLevels(null);
      return;
    }
    if (!isBackendConfigured()) {
      setError(null);
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
          });
        }
        setBySleeperId(map);
        setReplacementLevels(replRes.replacement_levels);
        setAsOfWeek(projRes.as_of_week);
        setGamesRemaining(projRes.games_remaining);
      } catch (err) {
        if (!cancelled) setError(err instanceof BackendError ? err.message : 'Could not load the player projection pool.');
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

  return { bySleeperId, replacementLevels, loading, error, backendConfigured: isBackendConfigured(), asOfWeek, gamesRemaining };
}
