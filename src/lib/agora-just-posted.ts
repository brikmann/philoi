import type { AgoraItem } from '@/types/database';

// "Your post lands at the top of the feed immediately" (mock 306, frame 3).
//
// The composer is a modal route over the feed, so the feed is still mounted underneath it when the
// post succeeds. The composer announces the new id here; the feed fetches that one row and puts it
// on top, highlighted. Re-fetching page 1 instead would be a full round trip and a lost scroll, and
// a hand-built optimistic row would have to guess at every field the server freezes.
//
// A forest post never reaches the square (0274), so only square posts are announced.

export type JustPosted = { id: string; itemType: AgoraItem['item_type'] };

const listeners = new Set<(p: JustPosted) => void>();

export function announceAgoraPost(p: JustPosted) {
  listeners.forEach((l) => l(p));
}

export function onAgoraPost(listener: (p: JustPosted) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
