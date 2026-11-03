import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

// Typed access to "Share → Philoi" (mock 324): the iOS Share Extension's App Group hand-off
// (targets/share-intake) and Android's SEND intent. `requireOptionalNativeModule`, never
// `requireNativeModule` — a build cut before this module existed must get null here, not a crash at
// import. Every consumer goes through src/lib/share-intake.ts.
export type SharedMedia = {
  /** A file:// URI in this app's own cache — the clip or photo, already copied out of the sender. */
  uri: string;
  mimeType: string;
};

type PhiloiShareIntakeModule = {
  /** A share is waiting (iOS: the extension left one; Android: the launch / newest intent is one). */
  hasPendingShare: () => boolean;
  /** Takes the waiting share, or null. Each share is returned once. */
  consumePendingShare: () => Promise<SharedMedia | null>;
  /** Android only: a share arrived while the app was already running. */
  addListener: (event: 'onShareReceived', listener: () => void) => EventSubscription;
};

export default requireOptionalNativeModule<PhiloiShareIntakeModule>('PhiloiShareIntake');
