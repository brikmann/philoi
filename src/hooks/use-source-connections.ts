import { useCallback } from 'react';

import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { getRealFitnessSourceForChallengeType, sourceNeedsConnection } from '@/lib/fitness-sync';
import { WHOOP_SCOPE_BY_CHALLENGE_TYPE } from '@/lib/whoop';
import type { ChallengeType } from '@/types/database';

/**
 * "Is the thing that measures THIS metric actually connected?" — per source, not one flag.
 *
 * 🐛 WHY NOT useFitnessConnection ALONE. That hook is the device pedometer (Health Connect / Apple
 * Health) and nothing else. The create screen re-prompted "Connect" for a Health Connect grant that
 * was already live because it never looked at any flag at all; the obvious fix — gate on that one
 * boolean — would then have been wrong for a run goal (Strava) or a strain goal (Whoop), each of
 * which has its own server-side OAuth state. And a Whoop connection only counts if it carries the
 * one scope this metric reads.
 *
 * Lock-in-sourced metrics (study, gym) need no connection and always read as connected.
 */
export function useSourceConnections() {
  const { connected: device, loading: deviceLoading } = useFitnessConnection();
  const { connected: strava, loading: stravaLoading } = useStravaConnection();
  const { connected: whoop, grantedScopes, loading: whoopLoading } = useWhoopConnection();

  const isConnectedFor = useCallback(
    (type: ChallengeType): boolean => {
      const source = getRealFitnessSourceForChallengeType(type, { whoopConnected: whoop });
      if (!source) return false;
      if (!sourceNeedsConnection(source)) return true;
      if (source === 'strava') return strava;
      if (source === 'whoop') {
        const scope = WHOOP_SCOPE_BY_CHALLENGE_TYPE[type];
        return whoop && (!scope || grantedScopes.includes(scope));
      }
      return device;
    },
    [device, strava, whoop, grantedScopes]
  );

  return { isConnectedFor, loading: deviceLoading || stravaLoading || whoopLoading };
}
