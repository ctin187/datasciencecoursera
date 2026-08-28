import { useCallback, useEffect, useRef, useState } from 'react';
import { LeagueService } from '../services/sleeperApi';
import type { SleeperDraft, SleeperDraftPick } from '../types';

const POLL_MS = 3000;
const RECENT_PICK_DISPLAY_MS = 5000;

export interface LiveDraftState {
  picks: SleeperDraftPick[];
  draftedIds: Set<string>;
  lastPick: SleeperDraftPick | null; // cleared automatically after RECENT_PICK_DISPLAY_MS
  polling: boolean;
  pollError: string | null;
  observedPickTimestamps: number[]; // ms, one per pick seen arrive this session - for pace estimation
  refreshNow: () => void;
}

/**
 * Polls a live Sleeper draft's picks every ~3s while draft.status === 'drafting'.
 * Stops polling automatically once the draft completes or this component
 * unmounts. Draft picks are always fetched fresh (see getDraftPicksLive) -
 * they're the one thing in this app that must never be served from cache.
 */
export function useLiveDraft(draft: SleeperDraft | null, enabled: boolean): LiveDraftState {
  const [picks, setPicks] = useState<SleeperDraftPick[]>([]);
  const [lastPick, setLastPick] = useState<SleeperDraftPick | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [observedPickTimestamps, setObservedPickTimestamps] = useState<number[]>([]);

  const picksRef = useRef<SleeperDraftPick[]>([]);
  const lastPickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftId = draft?.draft_id;
  const isLive = draft?.status === 'drafting';

  const poll = useCallback(async () => {
    if (!draftId) return;
    try {
      const { data } = await LeagueService.getDraftPicksLive(draftId);
      setPollError(null);
      if (data.length !== picksRef.current.length) {
        const newest = data[data.length - 1] ?? null;
        picksRef.current = data;
        setPicks(data);
        setObservedPickTimestamps((prev) => [...prev, Date.now()].slice(-20));
        setLastPick(newest);
        if (lastPickTimerRef.current) clearTimeout(lastPickTimerRef.current);
        lastPickTimerRef.current = setTimeout(() => setLastPick(null), RECENT_PICK_DISPLAY_MS);
      }
    } catch {
      setPollError('Live draft update failed - will retry automatically.');
    }
  }, [draftId]);

  useEffect(() => {
    if (!enabled || !draftId || !isLive) {
      setPolling(false);
      return;
    }
    setPolling(true);
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(interval);
      if (lastPickTimerRef.current) clearTimeout(lastPickTimerRef.current);
      setPolling(false);
    };
  }, [enabled, draftId, isLive, poll]);

  // Non-live draft (pre_draft or complete): fetch picks once, no polling.
  useEffect(() => {
    if (!draftId || isLive) return;
    LeagueService.getDraftPicks(draftId)
      .then(({ data }) => {
        picksRef.current = data;
        setPicks(data);
      })
      .catch(() => setPollError('Could not load draft results.'));
  }, [draftId, isLive]);

  const draftedIds = new Set(picks.map((p) => p.player_id));

  return {
    picks,
    draftedIds,
    lastPick,
    polling,
    pollError,
    observedPickTimestamps,
    refreshNow: poll,
  };
}
