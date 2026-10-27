import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { IconName } from '@/components/ui/icon';
import { track } from '@/lib/analytics';
import type { SocialChat } from '@/lib/api/social-chats';
import { fetchMyFeedChannels } from '@/lib/api/feed-channels';
import { supabase } from '@/lib/supabase';
import type { AgoraAttachKind } from '@/types/database';

// PERSISTENT CHAT, CLIENT HALF (migration 0284 — "a chat carries what a post carries").
//
// 0284 extends what exists rather than adding a second home for every DM: dm_messages gains
// `attachments` + a 'media' kind, forests gain a room chat (forest_messages), chat_reads holds the
// read pointer + mute for the rooms, and photos/files live in the PRIVATE `chat-media` bucket.
//
// ── THE SERVER MAY NOT HAVE IT ──
//
// 0284 is committed before it is applied, and OTA is closed — so this build ships able to run
// against a database with or without it. Everything new hangs off ONE question, `chatSupported()`,
// asked once per session. Without 0284 the answer is false and every caller falls straight back to
// what the app did before this file existed: text-only DMs through dm_send, the Chats list from
// fetchMySocialChats, no forest chat. A missing RPC is never an error a person sees — it is the
// signal that picks the old path.

/** The two scopes chat_send writes to. Campfire chat stays on `messages` (0284 only adds its read state). */
export type ChatScope = 'dm' | 'forest';
/** chat_mark_read / chat_set_muted also take the campfire, whose read pointer 0284 introduces. */
export type ChatRoomScope = ChatScope | 'campfire';

/**
 * What a chat row stores — the Agora's 0140 element shape, so a shared session or reward draws with
 * the SAME AttachmentRow the feed uses. Three kinds are chat-only: 'image' and 'file' (objects in
 * chat-media, `key` is the object name) and 'anthem' (frozen from profile_identity).
 *
 * `kind` is left open (`string`) on purpose: a later server adds 'video', and a build that typed
 * this closed would still receive it. Renderers skip what they don't know.
 */
export type ChatAttachment = {
  kind: ChatAttachKind | (string & {});
  ref_id: string | null;
  key: string | null;
  /** image/file: { mime, bytes, name?, width?, height? } · anthem: { title, artist?, url? } · else the Agora snapshot. */
  snapshot: Record<string, unknown> | null;
};

export type ChatAttachKind = 'image' | 'file' | 'anthem' | Exclude<AgoraAttachKind, 'video'>;

/** What the composer SENDS. chat_freeze_attachments re-reads everything it can and trusts only `meta`'s cosmetics. */
export type ChatAttachInput = {
  kind: ChatAttachKind;
  ref_id: string | null;
  key: string | null;
  /** image: width/height for the bubble's aspect · file: its display name. Never mime or size — storage owns those. */
  meta?: { name?: string; width?: number; height?: number };
};

/**
 * The chat-media bucket's own limits, mirrored from 0284 §2. A file over the cap or of another type
 * is refused by storage anyway; checking first is what turns that into a sentence instead of a
 * failed upload halfway through a send.
 */
export const CHAT_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_MAX_ATTACHMENTS = 10;
const CHAT_MEDIA_BUCKET = 'chat-media';

// ───────────────────────────── support detection ─────────────────────────────

/**
 * "This RPC / table does not exist on this server" — as opposed to every other failure.
 *
 * PGRST202 is PostgREST's "no function matches" (it answers 404), PGRST205 its "no such table" for
 * forest_messages, 42883 Postgres' own undefined-function when a cached schema lags. Anything else —
 * a raise from inside the function, an RLS refusal — PROVES the function is there.
 */
export function isMissingOnServer(error: Pick<PostgrestError, 'code'> | null | undefined, status?: number): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42883' || status === 404;
}

let support: boolean | null = null;
let probe: Promise<boolean> | null = null;
const listeners = new Set<(v: boolean) => void>();

function settle(value: boolean) {
  support = value;
  listeners.forEach((l) => l(value));
}

/** The cached answer, or null before the first probe lands. */
export function chatSupportSnapshot(): boolean | null {
  return support;
}

export function onChatSupport(listener: (v: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Does this server have 0284? Asked once per session.
 *
 * The probe is `chat_mark_read('none', <nil uuid>)`: for a scope it doesn't know it returns before
 * touching a row, so it is a write-free round trip that exists iff 0284 does. (Signed out, it
 * raises "Not signed in." — which is still not a MISSING function, so still a yes.)
 *
 * A network failure answers false for now WITHOUT caching it, so a cold start on a dead connection
 * doesn't pin the session to the old path once the radio wakes up.
 */
export function chatSupported(): Promise<boolean> {
  if (support !== null) return Promise.resolve(support);
  if (probe) return probe;
  probe = (async () => {
    try {
      const { error, status } = await supabase.rpc('chat_mark_read', {
        p_scope: 'none',
        p_room_id: '00000000-0000-0000-0000-000000000000',
      });
      if (isMissingOnServer(error, status)) {
        settle(false);
        return false;
      }
      // No code at all = the request never reached PostgREST (offline, DNS). Don't remember it.
      if (error && !error.code) return false;
      settle(true);
      return true;
    } catch {
      return false;
    } finally {
      probe = null;
    }
  })();
  return probe;
}

/** Any later call that finds the RPC gone (a rollback, say) flips the session back to the old path. */
function noteMissing(error: PostgrestError | null, status?: number): boolean {
  if (isMissingOnServer(error, status)) {
    if (support !== false) settle(false);
    return true;
  }
  return false;
}

/**
 * A client without the generated types for forest_messages. Tables are not added to the Database
 * type until 0284 is applied and the types regenerated — and a `from()` on a name the type doesn't
 * know is a compile error, not a runtime one. The read is still RLS-gated server-side.
 */
const untyped = supabase as unknown as SupabaseClient;

// ───────────────────────────── media ─────────────────────────────

/**
 * Upload one photo into chat-media and return its KEY.
 *
 * The key shape is load-bearing three times over: the bucket's insert policy checks segment 3 is
 * you and segments 1–2 are a room you're in; chat_freeze_attachments checks the whole key against
 * `<scope>/<room>/<you>/<uuid>.<ext>` with LOWERCASE hex; and chat_purge_media only ever deletes
 * under the sender's own segment. `.toLowerCase()` matters: iOS mints UUIDs upper-case, and the
 * server's `[0-9a-f-]{36}` would refuse every iPhone upload as "not yours to send".
 *
 * Always re-encoded to JPEG at ≤1600px: the bucket takes heic/png/webp too, but one known format
 * means the `.jpg` extension and the stored mimetype can never disagree, and a 12MP original has no
 * business in a chat bubble.
 */
export async function uploadChatImage(
  scope: ChatScope,
  roomId: string,
  userId: string,
  uri: string,
  width?: number
): Promise<{ key: string; width: number; height: number }> {
  const ctx = ImageManipulator.manipulate(uri);
  if (!width || width > 1600) ctx.resize({ width: 1600 });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });

  const file = new File(saved.uri);
  if (file.size > CHAT_MEDIA_MAX_BYTES) throw new Error('That photo is too large to send (20 MB max).');

  const key = `${scope}/${roomId.toLowerCase()}/${userId.toLowerCase()}/${Crypto.randomUUID().toLowerCase()}.jpg`;
  const base64 = await file.base64();
  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(key, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return { key, width: saved.width, height: saved.height };
}

/** Best-effort: the uploads of a send that then failed. The bucket's "delete own" policy allows it. */
export async function discardChatUploads(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await supabase.storage.from(CHAT_MEDIA_BUCKET).remove(keys).catch(() => {});
}

/**
 * Signed URLs for private chat media, cached per key.
 *
 * Signed for an hour and reused for fifty minutes, so a thread scrolled back and forth doesn't
 * re-sign every photo on every render — and a URL handed out is never within ten minutes of dying.
 * The bucket's read policy asks the room-membership question, so a non-member gets no URL at all.
 */
const SIGN_TTL_S = 60 * 60;
const signed = new Map<string, { url: string; until: number }>();
const signing = new Map<string, Promise<string | null>>();

export function cachedChatMediaUrl(key: string): string | null {
  const hit = signed.get(key);
  return hit && hit.until > Date.now() ? hit.url : null;
}

export function signChatMedia(key: string): Promise<string | null> {
  const hit = cachedChatMediaUrl(key);
  if (hit) return Promise.resolve(hit);
  const inflight = signing.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(key, SIGN_TTL_S);
      if (error || !data?.signedUrl) return null;
      signed.set(key, { url: data.signedUrl, until: Date.now() + (SIGN_TTL_S - 600) * 1000 });
      return data.signedUrl;
    } catch {
      return null;
    } finally {
      signing.delete(key);
    }
  })();
  signing.set(key, p);
  return p;
}

// ───────────────────────────── the RPCs ─────────────────────────────

/** Send into a DM thread or a forest room. Returns the new row's id. */
export async function chatSend(
  scope: ChatScope,
  roomId: string,
  body: string,
  attachments: ChatAttachInput[]
): Promise<string> {
  const trimmed = body.trim();
  const { data, error } = await supabase.rpc('chat_send', {
    p_scope: scope,
    p_room_id: roomId,
    p_body: trimmed || null,
    p_attachments: attachments,
  });
  if (error) throw error;
  // Only the DM has an analytics event name today; a forest-chat one is an AnalyticsEventName
  // addition for whoever next owns that union, not something to smuggle in from here.
  if (scope === 'dm') track('dm_sent', { thread_id: roomId, attachments: attachments.length });
  return data as string;
}

/** Fire-and-forget: a read pointer that failed to move is a stale badge, not something to interrupt anyone with. */
export async function chatMarkRead(scope: ChatRoomScope, roomId: string): Promise<void> {
  const { error, status } = await supabase.rpc('chat_mark_read', { p_scope: scope, p_room_id: roomId });
  if (error && !noteMissing(error, status)) throw error;
}

export async function chatSetMuted(scope: ChatRoomScope, roomId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('chat_set_muted', { p_scope: scope, p_room_id: roomId, p_muted: muted });
  if (error) throw error;
}

/** Soft-deletes the row; 0284's trigger hard-deletes its media from the bucket on the same write. */
export async function chatDeleteMyMessage(scope: ChatScope, messageId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_delete_my_message', { p_scope: scope, p_message_id: messageId });
  if (error) throw error;
}

/**
 * Report one message. The snapshot is taken server-side, membership-checked — then the same
 * report_alert mail the report screen fires, fire-and-forget for the same reason it is there: the
 * row is filed, and a mail outage must not read as a failed report.
 */
export async function reportChatMessage(scope: ChatScope, messageId: string, reason: string): Promise<void> {
  const { data, error } = await supabase.rpc('report_chat_message', {
    p_scope: scope,
    p_message_id: messageId,
    p_reason: reason,
  });
  if (error) throw error;
  if (data) {
    supabase.functions.invoke('report_alert', { body: { reportId: data } }).catch(() => {});
  }
}

// ───────────────────────────── the Chats list ─────────────────────────────

/** "Sent a photo" etc. are chat_attachments_phrase's words; the row draws the matching glyph beside them. */
const PHRASE_ICON: Record<string, IconName> = {
  'Sent a photo': 'photo',
  'Sent photos': 'photo',
  'Sent a file': 'notes',
  'Shared a session': 'session',
  'Shared their anthem': 'music',
  'Shared a win': 'reward',
  'Started a challenge': 'challenge',
};

/**
 * Social → Chats from get_my_chats, in the SocialChat shape the pane already draws. Null when the
 * server has no 0284 — the caller then builds the list the old way.
 *
 * get_my_chats carries everything but a room's emoji and member count, which come from
 * get_my_feed_channels (one more call, in parallel — fetchMySocialChats made one query PER
 * campfire). A failed channels call just costs the emoji, never the list.
 */
export async function fetchMyChats(userId: string): Promise<SocialChat[] | null> {
  if ((await chatSupported()) === false) return null;
  const [res, channels] = await Promise.all([
    supabase.rpc('get_my_chats'),
    fetchMyFeedChannels().catch(() => []),
  ]);
  if (res.error) {
    if (noteMissing(res.error, res.status)) return null;
    throw res.error;
  }
  const byId = new Map(channels.map((c) => [`${c.kind}:${c.id}`, c]));

  return (res.data ?? []).map((r): SocialChat => {
    const line = r.out_last_line?.trim() || null;
    const icon = line ? (PHRASE_ICON[line] ?? null) : null;
    if (r.out_scope === 'dm') {
      return {
        kind: 'dm',
        id: r.out_room_id,
        friendId: r.out_friend_id ?? '',
        name: r.out_name ?? 'Friend',
        avatarUrl: r.out_avatar_url,
        // get_my_dm_threads drops a thread nobody has spoken in, so a DM row always has a time.
        lastAt: r.out_last_at ?? new Date(0).toISOString(),
        lastLine: line ? `${r.out_last_sender_id === userId ? 'You: ' : ''}${line}` : null,
        unread: r.out_unread ?? 0,
        muted: r.out_muted ?? false,
      };
    }
    const channel = byId.get(`${r.out_scope}:${r.out_room_id}`);
    const who = r.out_last_sender_id === userId ? 'You' : (r.out_last_sender_name ?? 'Someone');
    const roomLine = line ? `${who}: ${line}` : null;
    if (r.out_scope === 'campfire') {
      return {
        kind: 'campfire',
        id: r.out_room_id,
        name: r.out_name ?? 'Campfire',
        emoji: channel?.emoji ?? '',
        lastAt: r.out_last_at,
        lastLine: roomLine,
        lastIcon: icon,
        unread: r.out_unread ?? 0,
        muted: r.out_muted ?? false,
      };
    }
    return {
      kind: 'forest',
      id: r.out_room_id,
      name: r.out_name ?? 'Forest',
      emoji: channel?.emoji ?? '',
      memberCount: channel?.member_count ?? 0,
      lastAt: r.out_last_at,
      lastLine: roomLine,
      lastIcon: icon,
      unread: r.out_unread ?? 0,
      muted: r.out_muted ?? false,
    };
  });
}

// ───────────────────────────── forest room chat ─────────────────────────────

export type ForestChatMessage = {
  id: string;
  forest_id: string;
  sender_id: string;
  body: string | null;
  attachments: ChatAttachment[];
  created_at: string;
  deleted_at: string | null;
  profiles: { display_name: string; avatar_url: string | null; handle: string | null } | null;
};

/**
 * A room's newest messages, returned oldest-first. "forest_messages: read if member" gates it (and
 * hides a blocked sender); deleted rows stay in the table for the report trail, so they're filtered
 * here. Capped at the newest 200 — a busy forest is a long scroll, and the thread is a chat, not an
 * archive browser.
 */
export async function fetchForestMessages(forestId: string): Promise<ForestChatMessage[]> {
  const { data, error, status } = await untyped
    .from('forest_messages')
    .select('*, profiles!forest_messages_sender_id_fkey(display_name, avatar_url, handle)')
    .eq('forest_id', forestId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    noteMissing(error, status);
    throw error;
  }
  return ((data ?? []) as ForestChatMessage[]).reverse();
}

/** Realtime, the DM contract: an INSERT or an UPDATE (a delete is a deleted_at write) refetches. */
export function subscribeToForestChat(forestId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`forest-chat:${forestId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'forest_messages', filter: `forest_id=eq.${forestId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
