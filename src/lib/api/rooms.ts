import type { PostgrestError } from '@supabase/supabase-js';

import { isMissingOnServer } from '@/lib/api/chat';
import { supabase } from '@/lib/supabase';

// ROOMS (ShareSpot ss1, migration 0297). A Room IS a `groups` row — the campfire, renamed in the app
// only. This module is the one typed surface every agent should call; never call the RPCs raw.
//
// "Moderator" in the app is the stored role 'admin' (0094). 0297 kept the stored value so installed
// builds — which test role === 'admin' — keep treating mods as mods. The RPCs take 'moderator' and
// return 'moderator'; the label mapping lives server-side in room_role_label().

export type RoomRole = 'owner' | 'moderator' | 'member';
export type RoomJoinPolicy = 'open' | 'code';
export type RoomPrivacy = 'open' | 'gated' | 'private';

export type RoomPerson = {
  user_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  role: RoomRole;
};

export type RoomGate = {
  room: {
    id: string;
    name: string;
    emoji: string;
    course_code: string | null;
    school: string | null;
    banner_item_id: string | null;
    privacy: RoomPrivacy;
    join_policy: RoomJoinPolicy;
    channels: string[];
    standings_enabled: boolean;
    member_count: number;
  };
  my_role: RoomRole | null;
  is_member: boolean;
  owner: RoomPerson | null;
  moderators: RoomPerson[];
  /** Only ever non-null for the room's owner or a moderator — they're the ones who hand it out. */
  code: string | null;
  has_pending_request: boolean;
};

export type JoinRoomStatus =
  | 'joined'
  | 'already_member'
  | 'requested'
  | 'needs_code'
  | 'wrong_code'
  | 'rate_limited'
  | 'blocked'
  | 'not_found';

export type JoinRoomResult = { status: JoinRoomStatus; group_id: string; min_join_tier?: string | null };

/** Raised by the wrappers below when the server predates 0297, so a screen can say so plainly. */
export class RoomsNotLiveError extends Error {
  constructor() {
    super('Rooms are updating — try again in a bit.');
    this.name = 'RoomsNotLiveError';
  }
}

// 0297's RPCs and messages.channel aren't in the generated Database types until they're regenerated
// against a migrated schema, so this module types its own boundary instead of widening database.ts.
type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>;
const untyped = supabase as any;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error, status } = await (supabase.rpc as unknown as UntypedRpc).call(supabase, fn, args);
  if (error) {
    if (isMissingOnServer(error, status)) throw new RoomsNotLiveError();
    throw error;
  }
  return data as T;
}

/** The gate screen (384) and the room header's role line (375). Null = no such room, or one you can't see. */
export async function fetchRoomGate(roomId: string): Promise<RoomGate | null> {
  const res = await call<({ status: 'ok' } & RoomGate) | { status: 'not_found' }>('get_room_gate', {
    p_room_id: roomId,
  });
  return res.status === 'ok' ? res : null;
}

/**
 * One tap for an open room; for a code room call it once without a code (→ needs_code), route to
 * /room/[id]/code, then again with what they typed. Codes are case- and whitespace-insensitive.
 */
export function joinRoom(roomId: string, code?: string | null): Promise<JoinRoomResult> {
  return call<JoinRoomResult>('join_room', { p_room_id: roomId, p_code: code ?? null });
}

/** Owner/mods. Switching to 'code' rotates to a fresh code (the old one was publicly readable). */
export function setRoomPolicy(
  roomId: string,
  policy: RoomJoinPolicy
): Promise<{ join_policy: RoomJoinPolicy; privacy: RoomPrivacy; code: string }> {
  return call('set_room_policy', { p_room_id: roomId, p_policy: policy });
}

/** Owner/mods. Returns the new code; the old one stops working immediately. */
export function rotateRoomCode(roomId: string): Promise<string> {
  return call('rotate_room_code', { p_room_id: roomId });
}

/** Owner: anyone but themselves. Moderator: may promote a member; can't demote another mod. */
export function setRoomMemberRole(roomId: string, userId: string, role: 'moderator' | 'member'): Promise<RoomRole> {
  return call('set_room_member_role', { p_room_id: roomId, p_user_id: userId, p_role: role });
}

/** Owner removes anyone; a moderator removes members only. */
export async function removeRoomMember(roomId: string, userId: string): Promise<void> {
  await call('remove_room_member', { p_room_id: roomId, p_user_id: userId });
}

/** Owner/mods. 'general' is always kept and always first; names are slugged server-side. */
export function setRoomChannels(roomId: string, channels: string[]): Promise<string[]> {
  return call('set_room_channels', { p_room_id: roomId, p_channels: channels });
}

/** The copy a join result should produce, for the statuses that aren't a navigation. */
export function joinRoomMessage(r: JoinRoomResult): string | null {
  switch (r.status) {
    case 'wrong_code':
      return "That code didn't work. Check it with the owner or a moderator.";
    case 'rate_limited':
      return 'Too many tries. Wait a bit, or message the owner or a moderator for the code.';
    case 'blocked':
      return r.min_join_tier
        ? `This room takes ${r.min_join_tier[0].toUpperCase()}${r.min_join_tier.slice(1)} and above.`
        : "You can't join this room yet.";
    case 'requested':
      return 'Request sent. The owner or a moderator will let you in.';
    case 'not_found':
      return "This room doesn't exist any more.";
    default:
      return null;
  }
}

// ───────────────────────────── chat (mock 380) ─────────────────────────────

export type RoomMessage = {
  id: string;
  group_id: string;
  user_id: string;
  body: string | null;
  channel: string;
  created_at: string;
  attach_kind: string | null;
  attach_path: string | null;
  attach_paths: string[] | null;
  attach_ref_id: string | null;
  system_event: string | null;
  profiles: { display_name: string | null; avatar_url: string | null; handle: string | null } | null;
};

const MESSAGE_SELECT =
  'id, group_id, user_id, body, channel, created_at, attach_kind, attach_path, attach_paths, attach_ref_id, system_event, profiles!messages_user_id_fkey(display_name, avatar_url, handle)';

/** Newest `limit` messages in one channel, returned oldest → newest. RLS keeps it members-only. */
export async function fetchRoomMessages(roomId: string, channel: string, limit = 150): Promise<RoomMessage[]> {
  const { data, error } = await untyped
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('group_id', roomId)
    .eq('channel', channel)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    // 42703 = the `channel` column isn't there yet (pre-0297 server).
    if (error.code === '42703') throw new RoomsNotLiveError();
    throw error;
  }
  return ((data ?? []) as unknown as RoomMessage[]).reverse();
}

export async function sendRoomMessage(roomId: string, userId: string, channel: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await untyped.from('messages').insert({
    group_id: roomId,
    user_id: userId,
    body: trimmed,
    channel,
  });
  if (error) throw error;
}

/** Live inserts for the whole room; the caller filters by channel (one socket per room, not per pill). */
export function subscribeToRoom(roomId: string, onInsert: (row: { channel?: string }) => void): () => void {
  const ch = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${roomId}` },
      (payload) => onInsert((payload.new ?? {}) as { channel?: string })
    )
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/**
 * Discord-style grouping: consecutive messages from one author within 5 minutes share a header
 * (avatar + name + time). System lines never group and never start a group.
 */
export function groupRoomMessages(messages: RoomMessage[]): { head: RoomMessage; rest: RoomMessage[] }[] {
  const out: { head: RoomMessage; rest: RoomMessage[] }[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    const lastMsg = last ? (last.rest[last.rest.length - 1] ?? last.head) : null;
    if (
      last &&
      lastMsg &&
      !m.system_event &&
      !last.head.system_event &&
      lastMsg.user_id === m.user_id &&
      new Date(m.created_at).getTime() - new Date(lastMsg.created_at).getTime() < 5 * 60_000
    ) {
      last.rest.push(m);
    } else {
      out.push({ head: m, rest: [] });
    }
  }
  return out;
}

/** A stable per-person name colour (mock 380 colours each author). */
const NAME_COLORS = ['#FFB05A', '#4FD6E0', '#B98BFF', '#39D98A', '#FFD166', '#FF8FA3', '#8FB8FF'];
export function roomNameColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
}

/** philoi.app/{username} — never an @ in a URL (SHARED §1). */
export function campfireUrl(handle: string | null | undefined): string | null {
  const h = handle?.replace(/^@+/, '').trim();
  return h ? `philoi.app/${h}` : null;
}

/** "now" · "5m" · "3h" · "2d" · "Oct 27" — the room feed and chat's timestamps. */
export function roomTimeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
