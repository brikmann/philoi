import { useCallback, useEffect, useState } from 'react';

import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  isGoogleCalendarSupported,
  type GoogleCalendarStatus,
} from '@/lib/google-calendar';

// Whether this ACCOUNT has a read-only Google Calendar grant (GCAL_INTEGRATION_SPEC.md) — like
// Strava and Whoop, and unlike the device fitness sources, this is a server-side OAuth grant
// rather than a per-device OS permission, so it follows the member to a new phone. Read through
// get_my_google_calendar_status(), which returns connected state + which Google account and never
// the token itself.
//
// Same shape as use-whoop-connection so Connected Apps can drive every row the same way.
export function useGoogleCalendarConnection() {
  const supported = isGoogleCalendarSupported();
  const [connected, setConnected] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  // Seeded from `supported` so the unsupported path never has to setState to settle.
  const [loading, setLoading] = useState(supported);

  const apply = useCallback((status: GoogleCalendarStatus) => {
    setConnected(status.connected);
    setAccountEmail(status.accountEmail);
  }, []);

  const refresh = useCallback(async () => {
    if (!supported) return;
    try {
      apply(await getGoogleCalendarStatus());
    } catch {
      // Best-effort — a failed status read just leaves the row showing "Connect". The coach works
      // without a calendar by design, so nothing downstream depends on this succeeding.
    }
  }, [supported, apply]);

  // Deliberately not `refresh()` — the initial read resolves through a promise callback so the
  // effect body itself never calls setState synchronously (react-hooks/set-state-in-effect), the
  // same shape use-whoop-connection.ts uses for its own first read.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    getGoogleCalendarStatus()
      .then((status) => {
        if (cancelled) return;
        setConnected(status.connected);
        setAccountEmail(status.accountEmail);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  /** Also the "switch account" path — connectGoogleCalendar() always offers Google's account
   * chooser, so re-running it on an already-connected row is how a member moves their grant to a
   * different Google account. Returns false when they backed out, which the caller treats as a
   * non-event rather than an error. */
  const connect = useCallback(async (): Promise<boolean> => {
    const result = await connectGoogleCalendar();
    if (result.status !== 'connected') return false;
    // Paint the new state from what the exchange just told us rather than waiting on a round
    // trip. A member switching accounts would otherwise watch the row show the OLD address for as
    // long as the status read takes, which reads as "the switch didn't work".
    setConnected(true);
    setAccountEmail(result.accountEmail);
    // Then reconcile with the server, which is the authority on both fields.
    await refresh();
    return true;
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await disconnectGoogleCalendar();
    setConnected(false);
    setAccountEmail(null);
  }, []);

  return { connected, accountEmail, loading, supported, connect, disconnect, refresh };
}
