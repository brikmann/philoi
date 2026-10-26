import type { FeedKey } from '@/lib/api/feed-channels';
import type { AgoraItem } from '@/types/database';

// "Your post lands at the top of the feed immediately" (mock 306, frame 3).
//
// The composer is a modal route over the feed, so the feed is still mounted underneath it when the
// post succeeds. The composer announces the new id here; the feed fetches that one row and puts it
// on top, highlighted. Re-fetching page 1 instead would be a full round trip and a lost scroll, and
// a hand-built optimistic row would have to guess at every field the server freezes.
//
// A post lands where its lane put it: the square, or one campfire's channel (0277). `channel` says
// which, so the feed only puts it on top when that is what it is showing — a campfire post on top
// of Friends would be a post the next refresh takes away.

export type JustPosted = {
  id: string;
  itemType: AgoraItem['item_type'];
  /** The channel it was posted into. Omitted = the square. */
  channel?: FeedKey;
};

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
