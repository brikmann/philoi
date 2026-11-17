import type { RefObject } from 'react';
import type { View } from 'react-native';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SETTLED FRAME (Gym Spark §6 — "share cards occasionally capture mid-animation / rays wrong").
//
// `captureRef` photographs whatever the native view holds at the instant it runs. Every share path
// called it straight from the Share tap, which loses two races:
//
//   1. COMMIT vs PAINT. A tap that changes what the card shows (a sticker toggle, a card mounted on
//      the tap, a prefs change that re-lays the export instance out) schedules a React commit; the
//      capture ran in the same tick, so it photographed the PREVIOUS frame — or a half-laid-out one
//      whose `onLayout` size no longer matched the view. The PNG was then resized to the stale
//      aspect ratio, which is what "rays wrong" looked like: the fan squashed or offset.
//   2. LOOPS. The capture targets carried live Reanimated loops (the footer RankBadge's Primordial
//      aura, the streak card's PersonalFlame, rare card art), so each export caught a random phase.
//      That half is fixed by rendering capture targets inside <MotionStill> (use-motion-active.ts):
//      the loops never start, so the frame is the designed resting pose — the same one a
//      reduce-motion user sees.
//
// This module closes race 1: wait for two animation frames (the first runs before the next paint,
// the second after it has been painted), then measure the view as it is NOW rather than trusting a
// size captured by an earlier `onLayout`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Resolves once any pending commit has been laid out AND painted. */
export async function waitForSettledFrame(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** How long a `measure` callback gets before the caller falls back to its last known size. */
const MEASURE_TIMEOUT_MS = 300;

/** The view's current size, or null when it cannot be measured (unmounted, or never reported). */
export function measureView(ref: RefObject<View | null>): Promise<{ width: number; height: number } | null> {
  const node = ref.current;
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { width: number; height: number } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    try {
      node.measure((_x, _y, width, height) => {
        clearTimeout(timer);
        finish(width > 0 && height > 0 ? { width, height } : null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}
