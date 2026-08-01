import { useCallback, useEffect, useState } from 'react';

import { backfillStravaActivities, connectStrava, disconnectStrava, getStravaConnectionStatus, isStravaSupported } from '@/lib/strava';

// Strava connection state (PHILOI_UI_SPEC.md §17/§19) lives server-side in strava_connections
// (an OAuth grant tied to the account, not the device — unlike HealthKit/Health Connect, which
// are per-device OS permissions), so this reads from get_my_strava_connection_status() instead
// of local storage.
export function useStravaConnection() {
  const [connected, setConnectedState] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isStravaSupported()) {
      setLoading(false);
      return;
    }
    try {
      const status = await getStravaConnectionStatus();
      setConnectedState(status.connected);
      // Poll-on-app-open safety net (§17b) — strava-webhook is the real-time primary trigger,
      // this just catches anything it missed. Fire-and-forget: backfillStravaActivities()
      // already swallows its own errors, and nothing here should block showing connection state.
      if (status.connected) backfillStravaActivities();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    await connectStrava();
    // connectStrava()'s own return value isn't trustworthy on its own — on Android the OAuth
    // redirect is typically completed by app/strava-auth.tsx (a separate screen/mount) rather
    // than by promptAsync's result here, so re-check the server directly regardless of what it
    // returned. By the time the browser has closed and this resumes, that route's exchange call
    // has normally already finished.
    const status = await getStravaConnectionStatus();
    setConnectedState(status.connected);
    if (status.connected) backfillStravaActivities();
    return status.connected;
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectStrava();
    setConnectedState(false);
  }, []);

  return { connected, loading, connect, disconnect, refresh };
}
