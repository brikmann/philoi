import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { FITNESS_SYNC_ENABLED } from '@/constants/feature-flags';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useAuth } from '@/lib/auth/auth-context';
import { getStravaConnectionStatus, isStravaSupported } from '@/lib/strava';
import { getWhoopConnectionStatus, isWhoopSupported } from '@/lib/whoop';

// "IS TRACKING ON?" — the one app-wide answer every fitness-connect prompt reads (mock 314):
// the Home setup card, the Gym/Run prompt on the Lock In tab, and the fitness board's banner.
//
// 🔴 ONE TRACKER IS DONE. Any one source connected — the device health store, Strava, or Whoop —
// flips this on, and from then on every prompt is gone for good. There is no "also connect X":
// the other providers live only as quiet "+ Add" rows on the Fitness trackers screen.
//
// 🔒 AND IT LATCHES. The first time any source is seen connected, a per-account flag is written
// and `trackingOn` stays true even if that source later drops (an OS grant revoked, a Strava
// disconnect). The point of the spec is one setup, then silence — a disconnect is a decision the
// member made on the trackers screen, not a reason to start nagging again.
//
// Why a module store and not a per-caller hook: the same lesson as use-fitness-connection.ts.
// Home, Lock In and the board are sibling tabs that never unmount, so a connect on one has to
// clear the prompt on the others without each re-reading the server. useStravaConnection is
// per-instance (and backfills on every mount), so it is deliberately NOT used here — this reads
// the status RPCs directly, once per account per process, and again on refreshFitnessTracking().
//
// Device-scoped by design, like the first-run flags (they survive reinstall only as far as
// AsyncStorage does). Losing the latch only means a prompt can reappear for someone whose source
// is no longer connected — the cheap direction.

const LATCH_KEY_PREFIX = 'philoi_tracking_on_';
const DISMISS_KEY_PREFIX = 'philoi_tracker_card_dismissed_';

type State = {
  userId: string | null;
  hydrated: boolean;
  latched: boolean;
  homeDismissed: boolean;
  /** Server-side OAuth sources. The device health store is read live from useFitnessConnection. */
  oauthConnected: boolean;
};

let state: State = { userId: null, hydrated: false, latched: false, homeDismissed: false, oauthConnected: false };
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const getState = () => state;

async function readOauthConnected(): Promise<boolean> {
  const [strava, whoop] = await Promise.all([
    isStravaSupported() ? getStravaConnectionStatus().then((s) => s.connected).catch(() => false) : false,
    isWhoopSupported() ? getWhoopConnectionStatus().then((s) => s.connected).catch(() => false) : false,
  ]);
  return strava || whoop;
}

// Deduped per account: a read still running for a previous account must not stand in for this one.
let inFlight: { userId: string; promise: Promise<void> } | null = null;

async function hydrate(userId: string): Promise<void> {
  if (inFlight?.userId === userId) return inFlight.promise;
  const promise = (async () => {
    try {
      const [latch, dismissed, oauth] = await Promise.all([
        AsyncStorage.getItem(LATCH_KEY_PREFIX + userId).catch(() => null),
        AsyncStorage.getItem(DISMISS_KEY_PREFIX + userId).catch(() => null),
        readOauthConnected(),
      ]);
      // Signed out (or into another account) while this was in flight — drop it.
      if (state.userId !== userId) return;
      setState({ hydrated: true, latched: latch === 'true', homeDismissed: dismissed === 'true', oauthConnected: oauth });
    } finally {
      if (inFlight?.userId === userId) inFlight = null;
    }
  })();
  inFlight = { userId, promise };
  return promise;
}

/**
 * Re-read the OAuth sources — call after a Strava/Whoop connect completes (including from the
 * strava-auth redirect route, which finishes the flow in its own mount). Safe to call anywhere.
 */
export function refreshFitnessTracking(): Promise<void> {
  return state.userId ? hydrate(state.userId) : Promise.resolve();
}

export function useFitnessTracking() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const snap = useSyncExternalStore(subscribe, getState, getState);
  const { connected: deviceConnected, loading: deviceLoading } = useFitnessConnection();

  useEffect(() => {
    if (!userId) return;
    if (state.userId !== userId) {
      setState({ userId, hydrated: false, latched: false, homeDismissed: false, oauthConnected: false });
      void hydrate(userId);
    }
  }, [userId]);

  const live = deviceConnected || snap.oauthConnected;
  const ready = snap.userId === userId && snap.hydrated;

  // First sighting of a connected source → latch it for this account, permanently.
  useEffect(() => {
    if (!userId || !ready || !live || snap.latched) return;
    setState({ latched: true });
    AsyncStorage.setItem(LATCH_KEY_PREFIX + userId, 'true').catch(() => {});
  }, [userId, ready, live, snap.latched]);

  const dismissHomeCard = useCallback(() => {
    if (!userId) return;
    setState({ homeDismissed: true });
    AsyncStorage.setItem(DISMISS_KEY_PREFIX + userId, 'true').catch(() => {});
  }, [userId]);

  return {
    /** Any tracker connected, now or ever on this account. Every connect prompt hides on this. */
    trackingOn: !FITNESS_SYNC_ENABLED || live || (ready && snap.latched),
    /** Still finding out — prompts render nothing until this is false, so they never flash. */
    loading: !ready || deviceLoading,
    /** Is a source connected right now (the trackers screen's "You're tracking" header). */
    liveConnected: live,
    homeDismissed: snap.homeDismissed,
    dismissHomeCard,
  };
}
