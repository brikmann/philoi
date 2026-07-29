import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { requestDeviceFitnessAuthorization } from '@/lib/fitness-sync';

const FITNESS_CONNECTED_KEY = 'philoi_fitness_connected';

// Whether THIS device has completed the device-fitness connect flow — Apple Health on iOS,
// Health Connect on Android, whichever is real on this platform (Settings → Connected apps,
// PHILOI_UI_SPEC.md §17/§19). Stored locally, not server-side — both are per-device OS grants,
// not account properties, so a reinstall or a new device always starts from Disconnected
// regardless of what the server thinks. "Disconnect" here only clears Philoi's own record of
// having asked; it can't revoke the OS-level grant — that's managed in the OS's own health-data
// settings, same as any app using either API.
export function useFitnessConnection() {
  const [connected, setConnectedState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(FITNESS_CONNECTED_KEY)
      .then((v) => setConnectedState(v === 'true'))
      .finally(() => setLoading(false));
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    const ok = await requestDeviceFitnessAuthorization();
    if (ok) {
      setConnectedState(true);
      await SecureStore.setItemAsync(FITNESS_CONNECTED_KEY, 'true');
    }
    return ok;
  }, []);

  const disconnect = useCallback(async () => {
    setConnectedState(false);
    await SecureStore.deleteItemAsync(FITNESS_CONNECTED_KEY);
  }, []);

  return { connected, loading, connect, disconnect };
}
