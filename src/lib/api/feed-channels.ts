import { fetchAgoraFeed, uploadAgoraPhoto } from '@/lib/api/agora';
import { fetchForestFeed } from '@/lib/api/forests';
import { supabase } from '@/lib/supabase';
import type { AgoraAttachInput, AgoraCursor, AgoraItem, AgoraScope } from '@/types/database';
import type { FeedChannel } from '@/types/social';

export type { FeedChannel };

// FEED CHANNELS (0277, mock 315) — the Feed's chip row: the four scopes, then each of your
// campfires and forests as its own channel. A campfire channel is what was POSTED to that
// campfire (the composer's lane, the done screen's "where"), readable by its members only — the
// server's can_read_campfire is the gate, so nothing here can widen it.

/**
 * What the feed is showing: a scope, or one channel. A string, so it can be remembered, compared
 * and used as the page tag in useAgoraFeed without an object identity to keep stable.
 */
export type FeedKey = AgoraScope | `campfire:${string}` | `forest:${string}`;

export function channelKey(c: Pick<FeedChannel, 'kind' | 'id'>): FeedKey {
  return `${c.kind}:${c.id}`;
}

/** The channel a key names, or null for a scope. */
export function parseFeedKey(key: FeedKey): { kind: 'campfire' | 'forest'; id: string } | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  return kind === 'campfire' || kind === 'forest' ? { kind, id: key.slice(i + 1) } : null;
}

export async function fetchMyFeedChannels(): Promise<FeedChannel[]> {
  const { data, error } = await supabase.rpc('get_my_feed_channels');
  if (error) throw error;
  return (data as FeedChannel[] | null) ?? [];
}

/** Same row shape as the Agora feed, so the same card renders it. Empty for a non-member. */
export async function fetchCampfireFeed(campfireId: string, cursor: AgoraCursor | null = null, limit = 20): Promise<AgoraItem[]> {
  const { data, error } = await supabase.rpc('get_campfire_feed', {
    p_campfire_id: campfireId,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AgoraItem[];
}

/** One page of whatever the key names. */
export function fetchFeedPage(key: FeedKey, cursor: AgoraCursor | null, limit: number): Promise<AgoraItem[]> {
  const channel = parseFeedKey(key);
  if (!channel) return fetchAgoraFeed(key as AgoraScope, cursor, limit);
  return channel.kind === 'campfire' ? fetchCampfireFeed(channel.id, cursor, limit) : fetchForestFeed(channel.id, cursor, limit);
}

/** Post into a campfire's channel. Every create_agora_post rule applies server-side. */
export async function createCampfirePost(input: {
  campfireId: string;
  userId: string;
  body?: string | null;
  photoUri?: string | null;
  attachments?: AgoraAttachInput[];
}): Promise<string> {
  let photoPath: string | null = null;
  if (input.photoUri) photoPath = await uploadAgoraPhoto(input.userId, input.photoUri);
  const { data, error } = await supabase.rpc('create_campfire_post', {
    p_campfire_id: input.campfireId,
    p_body: input.body?.trim() || null,
    p_photo_path: photoPath,
    p_attachments: input.attachments ?? [],
  });
  if (error) {
    if (photoPath) await supabase.storage.from('agora-photos').remove([photoPath]);
    throw error;
  }
  return data as string;
}

/** Author, or the campfire's owner/admin. */
export async function removeCampfirePost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_campfire_post', { p_post_id: postId });
  if (error) throw error;
}
