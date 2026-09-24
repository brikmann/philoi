import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { getDeviceFitnessGrant, requestDeviceFitnessAuthorization } from '@/lib/fitness-sync';

const FITNESS_CONNECTED_KEY = 'philoi_fitness_connected';

// Whether device fitness — Apple Health on iOS, Health Connect on Android — is actually feeding
// this app right now (Settings → Connected apps, PHILOI_UI_SPEC.md §17/§19).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 🐛 WHY THIS IS A MODULE-LEVEL STORE AND NOT `useState`.
//
// It used to be `useState` + a mount-only SecureStore read, which meant every caller got its OWN
// PRIVATE COPY that was read once and never again. There are seven call sites — connected-apps,
// settings, fitness-sync-prompt, goal-reveal-watcher, use-my-challenges, use-source-connections
// (→ challenge-card) and the create screen — and nothing propagated between them. That is the
// whole of "reconnect does nothing":
//
//   · Connecting from Connected Apps updated THAT ROW's copy and no other. The Challenges tab is
//     a mounted sibling in the same navigator, so its copy stayed `false` forever — and
//     use-my-challenges gates its entire sync block on that boolean, so the steps sync never ran
//     at all. The goal sat at 0/10,000 with the source connected.
//   · challenge-card's copy stayed `false` too, so `needsReconnect` stayed true and a correctly
//     connected goal read "⚡ Auto · Health Connect (reconnect)" indefinitely.
//   · Disconnecting and reconnecting changed nothing, because the instances that mattered were
//     never re-reading the store either way.
//
// One store, one value, every subscriber in agreement — the same shape use-motion-active.ts uses
// for AppState, and for the same reason.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 AND THE VALUE IS THE OS GRANT, NOT PHILOI'S MEMO TO ITSELF.
//
// The stored flag only ever meant "we ran the connect flow on this device once". That is not the
// same fact as "we can read steps", and the two drift in both directions: a grant revoked in
// Health Connect's own settings left the app claiming "⚡ Auto" over a goal nothing was filling,
// and a grant that was live but unrecorded — a reinstall, a device restore, cleared app storage —
// made the app demand a reconnect for permission it already had.
//
// So on Android the answer comes from Health Connect itself (getGrantedPermissions), re-asked on
// every foreground. iOS cannot participate: HealthKit deliberately refuses to tell a READ
// requester whether it was granted (see healthkit.ts), so there the stored flag is genuinely the
// best available signal and stays authoritative.
//
// 🔒 DISCONNECT HAS TO SURVIVE THAT. If the value were purely the OS grant, tapping Disconnect
// would clear the flag and the very next reconcile would flip it straight back to true, because
// Philoi cannot revoke an OS grant (only the user can, in the OS's own settings). Hence the flag
// is TRI-STATE rather than boolean:
//
//   'true'   — connected through Philoi.
//   'false'  — the user explicitly turned it OFF here. Sticky: honoured over a live OS grant.
//   absent   — never asked on this device. Defers entirely to the OS grant, which is what makes a
//              reinstall with a surviving Health Connect grant come back connected by itself.
type StoredChoice = 'true' | 'false' | null;

let stored: StoredChoice = null;
let connected = false;
let loading = true;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: { connected?: boolean; loading?: boolean }) {
  const nextConnected = next.connected ?? connected;
  const nextLoading = next.loading ?? loading;
  if (nextConnected === connected && nextLoading === loading) return;
  connected = nextConnected;
  loading = nextLoading;
  emit();
}

/** The stored choice and the live OS grant, resolved into the one boolean every caller reads. */
function resolve(choice: StoredChoice, grant: boolean | null): boolean {
  // An explicit "Disconnect" wins over everything, on both platforms.
  if (choice === 'false') return false;
  // iOS (grant === null): unknowable, so the stored choice is all there is.
  if (grant === null) return choice === 'true';
  // Android: the OS is the authority, whether or not we remembered asking.
  return grant;
}

// Re-entrancy guard. A screen focus, an AppState change and a connect() can land together; they
// all want the same answer and the last one to resolve should win rather than interleaving.
let inFlight: Promise<void> | null = null;

async function reconcile(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const [raw, grant] = await Promise.all([
        SecureStore.getItemAsync(FITNESS_CONNECTED_KEY).catch(() => null),
        getDeviceFitnessGrant().catch(() => null),
      ]);
      stored = raw === 'true' || raw === 'false' ? raw : null;
      setState({ connected: resolve(stored, grant), loading: false });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// One shared AppState subscription, attached with the first subscriber and never torn down —
// same reasoning as use-motion-active.ts. Coming back from Health Connect's own settings (where
// the user may have just granted or revoked Philoi) is a foreground transition and nothing else,
// so without this the app would keep showing whatever it believed before it was backgrounded.
let appStateSub: { remove: () => void } | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') reconcile();
    });
  }
  return () => {
    listeners.delete(onChange);
  };
}

const getConnected = () => connected;
const getLoading = () => loading;

export function useFitnessConnection() {
  // Two primitive snapshots rather than one object: useSyncExternalStore compares by identity, so
  // a `{ connected, loading }` built per call would re-render on every check forever.
  const connectedNow = useSyncExternalStore(subscribe, getConnected, getConnected);
  const loadingNow = useSyncExternalStore(subscribe, getLoading, getLoading);

  // First mount anywhere in the app hydrates the store; later mounts re-ask, which is cheap and is
  // what makes a screen pushed after a grant changed show the truth immediately.
  useEffect(() => {
    reconcile();
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    const ok = await requestDeviceFitnessAuthorization();
    if (ok) {
      // Clears any earlier explicit opt-out as well as recording this one.
      stored = 'true';
      await SecureStore.setItemAsync(FITNESS_CONNECTED_KEY, 'true').catch(() => {});
      // Re-ask the OS rather than trusting `ok` alone: on Android the grant is the thing every
      // other caller will be judged against, and reading it now means the Challenges tab's sync
      // gate is already open by the time this returns.
      await reconcile();
    }
    return ok;
  }, []);

  const disconnect = useCallback(async () => {
    // 'false', not deleted. Philoi cannot revoke an OS-level grant — that lives in the OS's own
    // health-data settings, same as for any app using either API — so this records the user's
    // choice to stop, and `resolve` honours it over a grant that is still technically live.
    stored = 'false';
    setState({ connected: false, loading: false });
    await SecureStore.setItemAsync(FITNESS_CONNECTED_KEY, 'false').catch(() => {});
  }, []);

  return { connected: connectedNow, loading: loadingNow, connect, disconnect, refresh: reconcile };
}
