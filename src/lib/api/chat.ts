import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { IconName } from '@/components/ui/icon';
import { track } from '@/lib/analytics';
import type { AgoraVideoSnapshot } from '@/lib/api/agora-video';
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

export type ChatAttachKind = 'image' | 'file' | 'anthem' | 'video' | Exclude<AgoraAttachKind, 'video'>;

/** What the composer SENDS. chat_freeze_attachments re-reads everything it can and trusts only `meta`'s cosmetics. */
export type ChatAttachInput = {
  kind: ChatAttachKind;
  ref_id: string | null;
  key: string | null;
  /**
   * image: width/height for the bubble's aspect · file: its display name. Never mime or size —
   * storage owns those. A video sends no meta at all: its snapshot is frozen from the upload ledger
   * agora-video-upload-url wrote, the same as an Agora clip's.
   */
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

/**
 * What the File button may send: chat-media's `allowed_mime_types`, keyed by the extension
 * chat_freeze_attachments' key pattern accepts (`\.(jpg|jpeg|png|webp|heic|pdf|txt|md|docx)$`).
 *
 * BOTH lists matter, and they have to agree. The bucket refuses a mimetype it doesn't list; the
 * freeze refuses a key whose extension it doesn't list. So the mime we upload with is derived HERE
 * from the extension, never taken from the picker — Android reports a .md as
 * application/octet-stream, which the bucket would refuse, for a file it is happy to hold as
 * text/markdown.
 */
const CHAT_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** The mimetypes the document picker is asked to show. The extension check below is still the rule. */
export const CHAT_FILE_PICKER_TYPES = [...new Set(Object.values(CHAT_FILE_TYPES)), 'text/x-markdown'];

/**
 * The extension + mime a picked document will be stored under, or null when chat-media won't take
 * it. The name's extension wins; a name with none (some Android providers hand back "document")
 * falls back to the picker's mimetype.
 */
export function chatFileType(name: string, pickerMime?: string | null): { ext: string; mime: string } | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  const ext = m?.[1]?.toLowerCase();
  if (ext && CHAT_FILE_TYPES[ext]) return { ext, mime: CHAT_FILE_TYPES[ext] };
  if (ext) return null;
  const mime = pickerMime === 'text/x-markdown' ? 'text/markdown' : pickerMime;
  const fromMime = Object.entries(CHAT_FILE_TYPES).find(([, v]) => v === mime);
  return fromMime ? { ext: fromMime[0], mime: fromMime[1] } : null;
}

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

/**
 * Upload one picked document into chat-media, byte for byte, and return its KEY.
 *
 * Same key shape (and the same `.toLowerCase()`, for the same iPhone reason) as uploadChatImage.
 * NOT re-encoded, even when it's an image: the File button is how you send the original — a
 * diagram or a photo of notes that a JPEG pass would smear. Photo is the button that compresses.
 */
export async function uploadChatFile(
  scope: ChatScope,
  roomId: string,
  userId: string,
  uri: string,
  type: { ext: string; mime: string }
): Promise<string> {
  const file = new File(uri);
  if (file.size > CHAT_MEDIA_MAX_BYTES) throw new Error('That file is too large to send (20 MB max).');
  const key = `${scope}/${roomId.toLowerCase()}/${userId.toLowerCase()}/${Crypto.randomUUID().toLowerCase()}.${type.ext}`;
  const base64 = await file.base64();
  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(key, decode(base64), { contentType: type.mime, upsert: false });
  if (error) throw error;
  return key;
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

/**
 * Is this room muted for me? chat_reads is RPC-only (no select policy), so the answer comes off
 * get_my_chats — the one read 0284 gives a client of its own mute bit. One call for a header
 * button is fine; it's the same call the Chats list makes on every focus.
 *
 * null = can't say (no 0284, or the call failed): the caller draws no toggle rather than a guess.
 * A room missing from the list (a DM nobody has spoken in yet — get_my_dm_threads drops those) has
 * never been muted, because muting writes the very chat_reads row the list would find.
 */
export async function fetchChatMuted(scope: ChatRoomScope, roomId: string): Promise<boolean | null> {
  if ((await chatSupported()) !== true) return null;
  const { data, error, status } = await supabase.rpc('get_my_chats');
  if (error) {
    noteMissing(error, status);
    return null;
  }
  const row = (data ?? []).find((r) => r.out_scope === scope && r.out_room_id === roomId);
  return row ? Boolean(row.out_muted) : false;
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
  'Sent a video': 'video',
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

// ───────────────────────────── video playback ─────────────────────────────

/** A chat clip's frozen snapshot — the Agora's shape, because it was uploaded the Agora's way. */
export type ChatVideoSnapshot = AgoraVideoSnapshot;

/** The snapshot of a 'video' attachment, or null when it isn't a playable one. */
export function chatVideoSnapshot(a: ChatAttachment): ChatVideoSnapshot | null {
  const s = a.snapshot ?? {};
  const videoKey = typeof s.video_key === 'string' ? s.video_key : null;
  const posterKey = typeof s.poster_key === 'string' ? s.poster_key : null;
  if (a.kind !== 'video' || !videoKey || !posterKey) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    video_key: videoKey,
    poster_key: posterKey,
    duration_s: n(s.duration_s) ?? 0,
    width: n(s.width),
    height: n(s.height),
  };
}

export type ChatVideoUrls = { videoUrl: string; posterUrl: string };

// The Agora's playback cache, keyed by scope + message instead of post. Signed URLs last an hour;
// refresh with ten minutes to spare so a clip never 403s mid-play.
const VIDEO_MARGIN_MS = 10 * 60 * 1000;
const videoCache = new Map<string, { urls: ChatVideoUrls | null; expiresAt: number }>();
const videoWaiting = new Map<string, ((urls: ChatVideoUrls | null) => void)[]>();
let videoFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Signed poster + video URLs for one chat message's clip, or null when this viewer can't open it
 * (not in the room, deleted, or chat-video-playback-url isn't deployed yet).
 *
 * BATCHED like getAgoraVideoUrls: every tile that asks within ~40ms shares one call per scope, ≤30
 * ids each — a thread scrolled into view is one round trip, not one per bubble. The edge function
 * re-checks room membership per id, so nothing here is trusted.
 */
export function getChatVideoUrls(scope: ChatScope, messageId: string): Promise<ChatVideoUrls | null> {
  const id = `${scope}:${messageId}`;
  const hit = videoCache.get(id);
  if (hit && hit.expiresAt - VIDEO_MARGIN_MS > Date.now()) return Promise.resolve(hit.urls);
  return new Promise((resolve) => {
    const list = videoWaiting.get(id) ?? [];
    list.push(resolve);
    videoWaiting.set(id, list);
    if (!videoFlushTimer) videoFlushTimer = setTimeout(() => void flushVideoAsks(), 40);
  });
}

async function flushVideoAsks() {
  videoFlushTimer = null;
  const batch = new Map(videoWaiting);
  videoWaiting.clear();

  const byScope = new Map<ChatScope, string[]>();
  for (const id of batch.keys()) {
    const [scope, messageId] = id.split(':') as [ChatScope, string];
    byScope.set(scope, [...(byScope.get(scope) ?? []), messageId]);
  }

  for (const [scope, ids] of byScope) {
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      let sources: Record<string, ChatVideoUrls> = {};
      // A failed call is retried after a minute, not cached for the hour — the likeliest failure
      // before launch is "not deployed yet", and that one fixes itself without a rebuild.
      let expiresAt = Date.now() + 60 * 1000;
      try {
        const { data, error } = await supabase.functions.invoke('chat-video-playback-url', {
          body: { scope, messageIds: chunk },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        sources = data?.sources ?? {};
        if (data?.expiresAt) expiresAt = new Date(data.expiresAt).getTime();
      } catch {
        // Every tile in the chunk falls back to "Video unavailable".
      }
      for (const messageId of chunk) {
        const id = `${scope}:${messageId}`;
        const urls = sources[messageId] ?? null;
        videoCache.set(id, { urls, expiresAt });
        for (const resolve of batch.get(id) ?? []) resolve(urls);
      }
    }
  }
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
