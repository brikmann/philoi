import { useCallback, useEffect, useState } from 'react';

import { fetchChallengeWatch, fetchGroupChallengeWatch } from '@/lib/api/leaderboard-social';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { ChallengeWatch, GroupChallengeWatchRow } from '@/types/database';

// A 20s poll fallback alongside the realtime subscription below — same belt-and-suspenders
// pattern as use-active-circle-lockins.ts, but this is the first real postgres_changes
// subscription in the codebase (everything else so far is poll-only), so keep the poll as a
// safety net in case a filter/RLS interaction silently drops an event.
const POLL_MS = 20000;

// Live H2H spectator read (PHILOI_UI_SPEC.md §16) — refetches on any check_ins/lock_in_sessions
// change for either competitor (both push/pull: realtime for immediacy, polling as a backstop).
export function useChallengeWatch(challengeId: string) {
  const [watch, setWatch] = useState<ChallengeWatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setWatch(await fetchChallengeWatch(challengeId));
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't load this challenge."));
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
    const interval = setInterval(refetch, POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    const channel = supabase
      .channel(`challenge-watch-${challengeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lock_in_sessions' }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [challengeId, refetch]);

  return { watch, loading, error, refetch };
}

// Live group-challenge spectator read — same shape of realtime + poll, one row per member.
export function useGroupChallengeWatch(challengeId: string) {
  const [rows, setRows] = useState<GroupChallengeWatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      setRows(await fetchGroupChallengeWatch(challengeId));
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't load this challenge."));
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
    const interval = setInterval(refetch, POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    const channel = supabase
      .channel(`group-challenge-watch-${challengeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lock_in_sessions' }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [challengeId, refetch]);

  return { rows, loading, error, refetch };
}
