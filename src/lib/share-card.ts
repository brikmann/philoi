import type { RefObject } from 'react';
import type { View } from 'react-native';

// Generic off-screen-card capture + native share sheet hand-off — used by both the fire-complete
// story card (fire-share-card.ts) and the rank-up share card (rank-up-share-card.tsx). Both
// native modules are lazily require()'d, same reasoning as sound.ts's expo-audio handling: they
// resolve their native binding at import time, so a dev-client build that predates
// react-native-view-shot/expo-sharing would crash the instant anything imports them at module
// scope, before any try/catch could run. Sharing is a nice-to-have flourish on top of an
// already-successful celebration, not something that should ever take the screen down.
export async function shareCardImage(cardRef: RefObject<View | null>, dialogTitle: string): Promise<void> {
  if (!cardRef.current) return;
  try {
    const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle });
    }
  } catch (e) {
    console.warn('[share-card] could not share the card:', e);
  }
}
