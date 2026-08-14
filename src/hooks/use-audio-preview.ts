import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { hasPreview, playPreview, previewingId, stopPreview, subscribePreview, togglePreview } from '@/lib/sound';

/**
 * React view of the single shared preview player (PUNCHLIST_11).
 *
 * The player is a module-level singleton on purpose — only one audition may ever be audible, and a
 * ▶ badge on a shop tile has to go back to idle when the user starts a different one three screens
 * away. useSyncExternalStore is what makes every badge on screen agree without threading state
 * through a provider, the same pattern the equipped loadout store already uses.
 */
export function useAudioPreview() {
  const playing = useSyncExternalStore(subscribePreview, previewingId, previewingId);
  return { playingId: playing, toggle: togglePreview, stop: stopPreview };
}

/**
 * Auto-audition a pulled cosmetic once, when its reveal lands (PUNCHLIST_11).
 *
 * Fires exactly once per item id rather than on every render — a reveal screen re-renders as the
 * share card lays out, and re-triggering would restart the clip from the top mid-listen. On a ×10
 * only the hero pull is passed in; auditioning ten items would be noise, not a reward.
 *
 * Respects the sound preference: this one starts on its own, so a user who has turned sound off
 * must not get audio they never asked for.
 */
export function useRevealPreview(itemId: string | undefined): void {
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!itemId || firedFor.current === itemId) return;
    if (!hasPreview(itemId)) return;
    if (!getRewardPreferencesSync().sound) return;
    firedFor.current = itemId;
    playPreview(itemId);
  }, [itemId]);

  // Leaving the reveal stops it, same rule as the detail screens.
  useEffect(() => () => stopPreview(), []);
}

/**
 * Stop any audition when the calling screen goes away.
 *
 * Navigating off a detail screen has to kill the sound — audio that follows you to another screen
 * reads as a bug, and the shared player means it really would keep playing. Guarded on the id so a
 * screen unmounting AFTER another one already started its own preview doesn't cut that one off.
 */
export function useStopPreviewOnLeave(itemId?: string): void {
  useEffect(() => {
    return () => {
      if (!itemId || previewingId() === itemId) stopPreview();
    };
  }, [itemId]);
}
