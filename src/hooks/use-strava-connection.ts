import { useCallback, useEffect, useState } from 'react';

import { connectStrava, disconnectStrava, getStravaConnectionStatus, isStravaSupported } from '@/lib/strava';

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    const ok = await connectStrava();
    if (ok) setConnectedState(true);
    return ok;
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectStrava();
    setConnectedState(false);
  }, []);

  return { connected, loading, connect, disconnect, refresh };
}
