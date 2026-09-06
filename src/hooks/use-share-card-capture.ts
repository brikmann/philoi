import { useCallback, useRef, useState } from 'react';
import type { View } from 'react-native';

import { shareCardImage } from '@/lib/share-card';

/** How long to wait for the just-mounted card to lay out before capturing anyway. */
const LAYOUT_TIMEOUT_MS = 1200;

/**
 * Mount a share card off-screen only for as long as it takes to photograph it.
 *
 * 🐛 THE OFF-SCREEN RENDER TAX (mock 171 bug 5 / PUNCHLIST_8). Every screen that can share kept its
 * card permanently mounted at `top: -10000`, with a comment explaining why: `captureRef` needs a
 * laid-out view, so the card was rendered up front to guarantee the ref was ready before the first
 * tap on Share.
 *
 * That is correct and it is also expensive. A share card is a 360×640 tree with a full-bleed
 * gradient, a 24-wedge ray fan, item art and a footer — and on the box-open screen it was mounted
 * for EVERY result in the haul. A ten-box open rendered ten complete story cards nobody would ever
 * look at, during the reveal animation, which is exactly when the JS thread is least able to
 * afford it. Most of them are never shared at all.
 *
 * So the card mounts on the tap instead. The thing that made "mount up front" necessary — the race
 * between mounting and capturing — is handled by waiting for the card's own `onLayout` rather than
 * by hoping, with a timeout so a card that never reports layout still gets its shot rather than
 * hanging the Share button forever.
 *
 * Usage:
 *
 *     const { cardRef, mounted, onCardLayout, capture } = useShareCardCapture();
 *     ...
 *     {mounted ? (
 *       <View style={styles.offscreen} pointerEvents="none" onLayout={onCardLayout}>
 *         <UnlockShareCard ref={cardRef} … />
 *       </View>
 *     ) : null}
 */
export function useShareCardCapture() {
  const cardRef = useRef<View>(null);
  const [mounted, setMounted] = useState(false);
  /** Resolver for the in-flight "has the card laid out yet?" wait. */
  const readyRef = useRef<(() => void) | null>(null);

  const onCardLayout = useCallback(() => {
    readyRef.current?.();
    readyRef.current = null;
  }, []);

  const capture = useCallback(async (dialogTitle: string) => {
    setMounted(true);
    try {
      await new Promise<void>((resolve) => {
        readyRef.current = resolve;
        // The card should lay out on the very next frame; this only exists so a Share button can
        // never become permanently dead if it does not.
        setTimeout(() => {
          if (readyRef.current) {
            readyRef.current = null;
            resolve();
          }
        }, LAYOUT_TIMEOUT_MS);
      });
      // One more frame after layout: `onLayout` fires when the box is measured, which is a beat
      // before it is painted, and captureRef photographs pixels rather than geometry.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await shareCardImage(cardRef, dialogTitle);
    } finally {
      setMounted(false);
    }
  }, []);

  return { cardRef, mounted, onCardLayout, capture };
}
