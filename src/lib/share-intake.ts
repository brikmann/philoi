import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import ShareIntake, { type SharedMedia } from '../../modules/philoi-share-intake';

// "Share → Philoi" (mock 324). A photo or clip shared to Philoi from the OS share sheet — typically
// right after posting it to Instagram — lands in the import composer (src/app/agora/import.tsx).
//
// How it gets there:
//   * iOS — the Share Extension (targets/share-intake) opens philoi://share-intake; that route
//     forwards to the composer.
//   * Android — MainActivity's SEND filter delivers the intent; the native module fires
//     onShareReceived (app running) or reports it pending (cold start), and useShareIntakeRouting
//     below opens the composer.
//   * Either, signed out — the share waits (an hour on iOS; the launch intent on Android) and the
//     composer opens once the app is usable.
//
// The composer itself consumes the share, so whichever path opened it, the file is read once.

export type { SharedMedia };

/** True when this build has the native half — older builds never offer the share target at all. */
export function shareIntakeAvailable(): boolean {
  return Boolean(ShareIntake);
}

/** Takes the waiting shared photo / clip, or null. Never throws. */
export async function consumeSharedMedia(): Promise<SharedMedia | null> {
  if (!ShareIntake) return null;
  try {
    return await ShareIntake.consumePendingShare();
  } catch (e) {
    console.warn('[share-intake] could not read the shared file:', e);
    return null;
  }
}

export function isSharedVideo(media: SharedMedia): boolean {
  return media.mimeType.startsWith('video/');
}

const IMPORT_ROUTES = ['/agora/import', '/share-intake'];

/**
 * Mounted once in the root navigator. `enabled` is "the app is usable" — signed in, handle set,
 * consent done — so a share never opens a composer over sign-in.
 */
export function useShareIntakeRouting(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  // Read inside the callbacks, so the effect doesn't resubscribe on every navigation.
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!enabled || !ShareIntake) return;
    const module = ShareIntake;
    const open = () => {
      // Already there (the iOS deep link got in first, or a second share while composing): the
      // open composer is the one that reads it.
      if (IMPORT_ROUTES.includes(here.current)) return;
      router.push('/agora/import');
    };
    try {
      if (module.hasPendingShare()) open();
    } catch {
      // A pending-check failure is the same as nothing pending.
    }
    const sub = module.addListener('onShareReceived', open);
    return () => sub.remove();
  }, [enabled, router]);
}
