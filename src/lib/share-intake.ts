import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { splitSharedLink } from '@/lib/share-link';

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
//
// 0294 · a LINK (an Instagram Reel hands over its URL, never the video) or TEXT share arrives the
// same way; agora/import reads it, sees no file, and replaces itself with agora/compose carrying
// the link — the in-app composer, with its campfire / forest / Everyone picker. A photo or clip can
// go there too, from import's "A campfire or forest" row.

export type { SharedMedia };

/** True when this build has the native half — older builds never offer the share target at all. */
export function shareIntakeAvailable(): boolean {
  return Boolean(ShareIntake);
}

/**
 * What a share turned out to be (0294). A FILE stays on the import composer (agora/import — the ⚔
 * question is about a clip); a LINK — an Instagram Reel arrives as its URL, never its video — or
 * plain TEXT goes on to agora/compose, which posts it as a link card to any audience.
 */
export type SharedShare =
  | { kind: 'media'; media: SharedMedia }
  | { kind: 'link'; url: string | null; text: string };

/** Takes the waiting share, or null. Each share is read once. Never throws. */
export async function consumeShare(): Promise<SharedShare | null> {
  if (!ShareIntake) return null;
  try {
    const raw = await ShareIntake.consumePendingShare();
    if (!raw) return null;
    if (raw.uri && raw.mimeType) return { kind: 'media', media: { uri: raw.uri, mimeType: raw.mimeType } };
    const { url, rest } = splitSharedLink({ url: raw.url, text: raw.text });
    if (!url && !rest) return null;
    return { kind: 'link', url, text: rest };
  } catch (e) {
    console.warn('[share-intake] could not read the share:', e);
    return null;
  }
}

export function isSharedVideo(media: SharedMedia): boolean {
  return media.mimeType.startsWith('video/');
}

const IMPORT_ROUTES = ['/agora/import', '/share-intake'];

/** The params agora/compose reads to open on a shared link, text, photo or clip. */
export type ComposeShareParams = {
  source: 'share';
  sharedUrl?: string;
  sharedText?: string;
  sharedUri?: string;
  sharedMime?: string;
  /** Open the campfire / forest picker straight away. */
  pick?: 'campfire' | 'forest';
};

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
