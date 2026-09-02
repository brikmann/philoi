import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { fetchMyChallenges } from '@/lib/api/challenges';
import { DEVICE_METRIC_TYPES, syncChallengeFromDevice } from '@/lib/api/fitness-challenge-sync';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { Challenge } from '@/types/database';

// The list moved to lib/api/fitness-challenge-sync.ts when GoalRevealWatcher became a second
// caller (§A) — this tab is no longer the only thing that syncs.

export function useMyChallenges() {
  const { session } = useAuth();
  const { connected: deviceFitnessConnected } = useFitnessConnection();
  const { connected: stravaConnected } = useStravaConnection();
  const { connected: whoopConnected } = useWhoopConnection();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const data = await fetchMyChallenges(session.user.id);
      setChallenges(data);

      // Foreground-only re-sync (no true background delivery yet, see healthkit.ts /
      // health-connect.ts / the strava-sync Edge Function) — every time the Challenges tab
      // comes into focus, catch up any connected device-metric challenge. Best-effort and
      // silent: a failed sync just leaves the always-working manual-log fallback as what the
      // user sees until the next focus tries again (§18 — never gate participation on this
      // working). syncChallengeFromDevice itself routes steps to the platform pedometer, run/ride
      // to Strava and workouts/strain/sleep to Whoop, so this only needs to know "is ANY source
      // connected" to decide whether attempting a sync is worthwhile at all.
      if (deviceFitnessConnected || stravaConnected || whoopConnected) {
        const deviceChallenges = data.filter((c) => DEVICE_METRIC_TYPES.includes(c.type) && !c.completed_at);
        const outcomes = await Promise.all(
          deviceChallenges.map((c) => syncChallengeFromDevice(c).catch(() => null))
        );

        // 🐛 A goal the phone finished for you now gets its payout screen — but the queuing happens
        // inside syncChallengeFromDevice, not here (lib/goal-reveal-queue.ts), so create.tsx's
        // fire-and-forget sync is covered by the same mechanism. Until that existed, an auto-tracked
        // completion (Noah's 10k-step repro) paid embers server-side and showed NOTHING: the reveal
        // was wired only to the card's manual-log callback, which a Health Connect sync never
        // touches.
        if (outcomes.some((o) => (o?.synced ?? 0) > 0)) {
          setChallenges(await fetchMyChallenges(session.user.id));
        }
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your challenges.'));
    } finally {
      setLoading(false);
    }
  }, [session, deviceFitnessConnected, stravaConnected, whoopConnected]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { challenges, loading, error, refetch };
}
