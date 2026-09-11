import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router';

// ── WHEN IS A COSMETIC LOOP ALLOWED TO BURN A FRAME? ──
//
// Philoi is a fire, so almost every surface has something breathing on it: the hero flame, the
// coal bed, the rank hexagon, the XP bar, the campfire banners. Each of those is a
// `withRepeat(..., -1)` started in a mount effect, and none of them had an off switch. That is
// fine while you are looking at them and pure waste the rest of the time, because neither of the
// two ways a screen stops being looked at unmounts it:
//
//   1. BLUR. The four tabs are one navigator and all four stay mounted, and every screen pushed
//      over Home leaves Home mounted underneath. A dozen worklets per flame keep being evaluated
//      and committed onto views nobody can see, at 60fps, for as long as the user is elsewhere in
//      the app. This is the big one, and it is the one measured as "Home idles hot".
//   2. BACKGROUND. The UI thread's vsync does stop when the activity stops, so the Reanimated
//      loops mostly go quiet on their own here — but the JS thread does NOT, so this signal is
//      what the `setInterval` clocks and the poll loops need.
//
// Hence two signals rather than one, and a combined hook for the common case.

// ── The AppState half ──
//
// One module-level subscription shared by every caller instead of one listener per component.
// There are ~30 animated components in this app and a fair few of them are rendered per-row in a
// feed; at one `addEventListener` each, the bookkeeping to decide whether to stop animating would
// itself become a thing worth stopping.

// 'inactive' deliberately counts as ACTIVE. It is an iOS-only transient — the app switcher, a
// pulled-down Control Center, an incoming call banner — during which the app's own pixels are
// still on screen. Pausing there would freeze the flame in the one snapshot iOS shows the user of
// this app, to save a few hundred milliseconds of frames.
function isActive(state: AppStateStatus): boolean {
  return state === 'active' || state === 'inactive';
}

let appActive = isActive(AppState.currentState);
const appStateListeners = new Set<() => void>();
let appStateSub: { remove: () => void } | null = null;

function subscribeAppActive(onChange: () => void): () => void {
  appStateListeners.add(onChange);
  appStateSub ??= AppState.addEventListener('change', (state) => {
    const next = isActive(state);
    if (next === appActive) return;
    appActive = next;
    appStateListeners.forEach((listener) => listener());
  });
  return () => {
    appStateListeners.delete(onChange);
    if (appStateListeners.size === 0) {
      appStateSub?.remove();
      appStateSub = null;
    }
  };
}

function getAppActive(): boolean {
  return appActive;
}

/**
 * True while the app is in the foreground. Backgrounding flips it false.
 *
 * For timers and polling — the JS thread keeps running a `setInterval` after the app is
 * backgrounded, so anything on a clock needs this even though the animations largely don't.
 */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, getAppActive, getAppActive);
}

/**
 * True while this screen is both focused and in the foreground — i.e. while the pixels this
 * component draws can actually reach a human. Gate every infinite cosmetic loop on it:
 *
 *     const motionActive = useMotionActive();
 *     useEffect(() => {
 *       if (reduceMotion || !motionActive) return;
 *       pulse.value = withRepeat(...);
 *       return () => cancelAnimation(pulse);
 *     }, [pulse, reduceMotion, motionActive]);
 *
 * The `cancelAnimation` in the cleanup is the load-bearing half and is easy to leave out: without
 * it the effect re-runs on blur, takes the early return, and the loop it started last time is
 * still going. Cleanup runs on every dependency change, not only on unmount, which is exactly the
 * hook this pattern hangs on.
 *
 * This is NOT `useReduceMotion`. That one is an accessibility preference and means "this user
 * does not want motion, ever"; this one means "nothing is looking right now". They compose, and
 * both have to be checked.
 *
 * MUST be called from inside a router screen — it reads navigation context, and a component
 * mounted as a sibling of the root `<Stack>` has none. Use `useAppActive` alone up there.
 */
export function useMotionActive(): boolean {
  const focused = useIsFocused();
  const foreground = useAppActive();
  return focused && foreground;
}
