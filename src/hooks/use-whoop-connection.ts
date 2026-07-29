import { useCallback, useEffect, useState } from 'react';

import { connectWhoop, disconnectWhoop, getWhoopConnectionStatus, isWhoopSupported } from '@/lib/whoop';

// Whether this ACCOUNT is connected to Whoop (PHILOI_UI_SPEC.md §17/§19) — unlike the device
// sources (use-fitness-connection), a Whoop connection is a server-side OAuth grant, not a
// per-device OS permission, so it lives in whoop_connections and follows the member to a new
// phone. Read through get_my_whoop_connection_status(), which returns connected state + the
// granted scopes and never the tokens themselves.
export function useWhoopConnection() {
  const supported = isWhoopSupported();
  const [connected, setConnected] = useState(false);
  const [grantedScopes, setGrantedScopes] = useState<string[]>([]);
  // Seeded from `supported` so the unsupported path never has to setState to settle.
  const [loading, setLoading] = useState(supported);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      const status = await getWhoopConnectionStatus();
      setConnected(status.connected);
      setGrantedScopes(status.grantedScopes);
    } catch {
      // Best-effort — a failed status read just leaves the row showing "Connect", and the manual
      // log always works regardless (§18: never gate participation on an integration).
    }
  }, [supported]);

  // Deliberately not `refresh()` — the initial read resolves through a promise callback so the
  // effect body itself never calls setState synchronously (react-hooks/set-state-in-effect), the
  // same shape use-fitness-connection.ts uses for its own first read.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getWhoopConnectionStatus()
      .then((status) => {
        if (cancelled) return;
        setConnected(status.connected);
        setGrantedScopes(status.grantedScopes);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  /** Runs the Whoop authorize flow for exactly `scopes` (plus `offline`). Whoop replaces the
   * previous grant with whatever this one asks for, so a caller widening an existing connection
   * must pass the union — see the callers in fitness-sync-prompt / connected-apps. */
  const connect = useCallback(
    async (scopes: string[]): Promise<boolean> => {
      const ok = await connectWhoop(scopes);
      if (ok) await refresh();
      return ok;
    },
    [refresh]
  );

  const disconnect = useCallback(async () => {
    await disconnectWhoop();
    setConnected(false);
    setGrantedScopes([]);
  }, []);

  return { connected, grantedScopes, loading, supported, connect, disconnect, refresh };
}
