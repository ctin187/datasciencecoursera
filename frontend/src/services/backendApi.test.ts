import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __setRetryDelaysForTests,
  onBackendWaking,
  fetchProjections,
  BackendError,
} from './backendApi';

/**
 * The backend sleeps on Render's free tier. These cover the two shapes a cold
 * start takes in a browser - a rejected fetch while the instance wakes, then a
 * 503 while it ingests - and confirm neither is reported to the user as a dead
 * service before the retry budget is actually spent.
 */

const SCORING = { rec: 1 };
const okBody = {
  provenance: {}, season: 2025, as_of_week: 8, latest_cached_week: 8,
  games_remaining: 9, scoring_analysis: {}, count: 0, players: [],
};

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  // Keep the schedule but make it instant, so behaviour is tested, not timing.
  __setRetryDelaysForTests([0, 0, 0]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cold-start retry', () => {
  it('recovers when the instance wakes after a few rejected fetches', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchProjections({ scoringSettings: SCORING });

    expect(res.season).toBe(2025);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a 503 while the cache is still filling, then succeeds', async () => {
    const notCached = {
      detail: { error: "'weekly' is not cached yet", hint: 'The first refresh may still be running.' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(notCached, 503))
      .mockResolvedValueOnce(jsonResponse(okBody));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjections({ scoringSettings: SCORING })).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up only after the whole budget is spent, and says why', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjections({ scoringSettings: SCORING })).rejects.toThrow(BackendError);
    // One initial attempt plus one per configured delay.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(fetchProjections({ scoringSettings: SCORING })).rejects.toThrow(/sleeps after inactivity/);
  });

  it('does not retry a client error - that is not a cold start', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'scoring must be a JSON object' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProjections({ scoringSettings: SCORING })).rejects.toThrow('scoring must be a JSON object');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unpacks the structured 503 detail instead of showing raw JSON', async () => {
    const notCached = {
      detail: { error: "'weekly' is not cached yet", hint: 'The first refresh may still be running.' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(notCached, 503)));

    await expect(fetchProjections({ scoringSettings: SCORING })).rejects.toThrow(
      /'weekly' is not cached yet — The first refresh may still be running/,
    );
  });

  it('reports waking while retrying, and clears it on success', async () => {
    const seen: boolean[] = [];
    const unsubscribe = onBackendWaking((w) => seen.push(w));

    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(okBody)));

    await fetchProjections({ scoringSettings: SCORING });
    unsubscribe();

    expect(seen).toEqual([false, true, false]);
  });
});
