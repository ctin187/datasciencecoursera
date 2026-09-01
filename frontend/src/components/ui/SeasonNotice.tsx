import type { SeasonStatus } from '../../services/backendApi';

/**
 * States, once and plainly, which season a set of numbers describes.
 *
 * This exists because of a real failure: the app served completed-season
 * production with no label, and it read as a forecast for the season about to
 * start. That put aging veterans at the top of a draft board and made rookies
 * invisible. A number without its season attached is not a neutral omission -
 * it is a number the reader will date wrongly.
 *
 * Renders nothing when the data IS the current season, because then there is
 * nothing to warn about.
 */
export function SeasonNotice({ status }: { status?: SeasonStatus }) {
  if (!status) return null;

  if (status.status === 'no-data') {
    return (
      <div className="notice mb-3">
        <span className="font-semibold">No season data cached yet.</span> {status.note}
      </div>
    );
  }

  if (status.is_current_season) {
    return (
      <p className="mb-2 text-[11px] text-muted">
        {status.season} season, through week {status.weeks_played ?? 0}.
      </p>
    );
  }

  return (
    <div className="notice mb-3">
      <p className="text-sm">
        <span className="font-semibold">
          These numbers describe the {status.season} season, not {status.current_season}.
        </span>{' '}
        {status.current_season} hasn't published any stats yet, so there is nothing current to compute from.
        Read this as a record of what players <em>did</em> — it is not a forecast, it cannot see rookies, and it
        rewards veterans who compiled counting stats last year.
      </p>
      <p className="mt-1 text-[11px] text-muted">
        For forward-looking value, the Draft Assistant ranks on Sleeper's {status.current_season} consensus instead.
      </p>
    </div>
  );
}
