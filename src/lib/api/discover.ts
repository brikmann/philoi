import type { PostgrestError } from '@supabase/supabase-js';
import type { useRouter } from 'expo-router';

import { isMissingOnServer } from '@/lib/api/chat';
import { joinForest } from '@/lib/api/forests';
import { fetchSuggestedPeople } from '@/lib/api/friend-requests';
import { fetchDiscoverableGroups } from '@/lib/api/groups';
import { fetchGrindAlikes } from '@/lib/api/matchmaking';
import { joinRoom, joinRoomMessage, RoomsNotLiveError, type RoomJoinPolicy, type RoomPrivacy } from '@/lib/api/rooms';
import { supabase } from '@/lib/supabase';
import type { AgoraItem } from '@/types/database';

// DISCOVER (ShareSpot ss2 — mocks 345/349/354–357/383). Search is a discovery board: people, rooms,
// clubs and posts, all findable by one word. Server side:
//   • 0299 — search_people_by_interest, search_agora_posts, get_trending_topics, get_match_summary
//     (read-only, all over existing matchers and the feed's own visibility gate);
//   • 0297 (ss1) — get_discoverable_rooms, which includes code-gated rooms without ever their code.
// Every wrapper here degrades to an empty answer (or the pre-0297 list) on a server without those
// migrations, so the board renders on today's prod and fills in when they land.
//
// Naming: a ROOM is a `groups` row (ss1's rooms.ts). A CLUB is a forest — the interest club with an
// about-line (purpose), a "matches {your tag}" reason and a live count, which is exactly mock 356's
// card. Joining a club is join_forest; joining a room is ss1's join_room.

type Router = ReturnType<typeof useRouter>;

// 0297/0299's RPCs aren't in the generated Database types until they're regenerated against a
// migrated schema, so this module types its own boundary (same as rooms.ts) instead of widening
// database.ts.
type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null; status: number }>;

function rpc(fn: string, args: Record<string, unknown>) {
  return (supabase.rpc as unknown as UntypedRpc).call(supabase, fn, args);
}

async function rpcOrEmpty<T>(fn: string, args: Record<string, unknown>, empty: T): Promise<T> {
  const { data, error, status } = await rpc(fn, args);
  if (error) {
    if (isMissingOnServer(error, status)) return empty;
    throw error;
  }
  return (data as T | null) ?? empty;
}

// ── people ──────────────────────────────────────────────────────────────────────────────────────

export type PersonByInterest = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  university: string | null;
  program_abbrev: string | null;
  patron_name: string | null;
  /** The vocab label that matched the query ("Running"). */
  matched_label: string;
  is_friend: boolean;
};

/** One person card, whichever matcher produced it. */
export type PersonCard = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  /** Why — the top match reasons ("Running · Gym"), or the shared campfire. */
  sub: string | null;
  live: boolean;
  is_friend: boolean;
  /** The engine's reasons, for the chips; empty from the suggested-people fallback. */
  reason_keys: string[];
};

/**
 * People like you: the grind-alike engine (0275/0285) when you're discoverable; otherwise the
 * friends-of-friends suggestions, so the row is never blank for someone who hasn't opted in yet.
 * `matched` says which one answered — the screens offer "Turn on matching" when it's false.
 */
export async function fetchPeopleForYou(limit = 12): Promise<{ matched: boolean; people: PersonCard[] }> {
  const alikes = await fetchGrindAlikes(undefined, limit).catch(() => []);
  if (alikes.length > 0) {
    return {
      matched: true,
      people: alikes.map((a) => ({
        user_id: a.user_id,
        display_name: a.display_name,
        handle: a.handle,
        avatar_url: a.avatar_url,
        sub: a.reasons.slice(0, 2).map((r) => r.label).join(' · ') || null,
        live: a.live,
        is_friend: a.is_friend,
        reason_keys: a.reasons.map((r) => r.key),
      })),
    };
  }
  const suggested = await fetchSuggestedPeople(limit).catch(() => []);
  return {
    matched: false,
    people: suggested.map((s) => ({
      user_id: s.user_id,
      display_name: s.display_name,
      handle: s.handle,
      avatar_url: s.avatar_url,
      sub: s.mutual_circle_name ? `In ${s.mutual_circle_name}` : null,
      live: false,
      is_friend: false,
      reason_keys: [],
    })),
  };
}

/** People tagged with an interest matching `query`. Empty unless you're discoverable (0275's rule). */
export function searchPeopleByInterest(query: string, limit = 12): Promise<PersonByInterest[]> {
  return rpcOrEmpty<PersonByInterest[]>('search_people_by_interest', { p_query: query, p_limit: limit }, []);
}

// ── posts ───────────────────────────────────────────────────────────────────────────────────────

/** Posts mentioning `query` (with or without the #), newest first, keyset-paged like the feed. */
export function searchAgoraPosts(query: string, before: Pick<AgoraItem, 'created_at' | 'id'> | null = null, limit = 24): Promise<AgoraItem[]> {
  return rpcOrEmpty<AgoraItem[]>(
    'search_agora_posts',
    { p_query: query, p_before_at: before?.created_at ?? null, p_before_id: before?.id ?? null, p_limit: limit },
    [],
  );
}

export type TrendingTopic = {
  key: string;
  label: string;
  icon: string;
  /** One of your own interests — these lead. */
  is_mine: boolean;
  /** Public square posts mentioning it in the last 30 days. */
  post_count: number;
};

export function fetchTrendingTopics(limit = 8): Promise<TrendingTopic[]> {
  return rpcOrEmpty<TrendingTopic[]>('get_trending_topics', { p_limit: limit }, []);
}

/** "#running" — the label as a hashtag, lowercased, spaces and punctuation dropped. */
export function topicTag(label: string): string {
  return '#' + label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ── matchmaking ─────────────────────────────────────────────────────────────────────────────────

export type MatchSignal = { count: number; label: string | null };

export type MatchSummary =
  | { discoverable: false }
  | {
      discoverable: true;
      total: number;
      live: number;
      interests: { count: number; labels: string[] };
      program: MatchSignal;
      campus: MatchSignal;
      patron: MatchSignal;
    };

/** Null on a server without 0299 — the screen falls back to counting get_grind_alikes itself. */
export async function fetchMatchSummary(): Promise<MatchSummary | null> {
  return rpcOrEmpty<MatchSummary | null>('get_match_summary', { p_scope: null }, null);
}

// ── rooms ───────────────────────────────────────────────────────────────────────────────────────

export type DiscoverRoom = {
  id: string;
  name: string;
  emoji: string;
  member_count: number;
  /** Active lock-ins right now. */
  online_count: number;
  join_policy: RoomJoinPolicy;
  privacy: RoomPrivacy;
  course_code: string | null;
  school: string | null;
  is_member: boolean;
  last_activity_at: string | null;
};

/** 0297's list (code rooms included, never their code); before 0297, the old discoverable list. */
export async function fetchDiscoverRooms(query?: string, limit = 30): Promise<DiscoverRoom[]> {
  const { data, error, status } = await rpc('get_discoverable_rooms', {
    p_query: query?.trim() || null,
    p_limit: limit,
  });
  if (!error) return (data as DiscoverRoom[] | null) ?? [];
  if (!isMissingOnServer(error, status)) throw error;
  const legacy = await fetchDiscoverableGroups(undefined, query, limit);
  return legacy.map((g) => ({
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    member_count: Number(g.member_count),
    online_count: 0,
    join_policy: 'open',
    privacy: g.privacy,
    course_code: g.course_code,
    school: g.school,
    is_member: false,
    last_activity_at: null,
  }));
}

export type JoinOutcome =
  | { kind: 'joined' }
  | { kind: 'requested' }
  | { kind: 'needs_code' }
  | { kind: 'error'; message: string };

/**
 * One tap on a room card. A code room routes to ss1's gate (/room/[id]/code, mock 384) — the screen
 * that lists the owner and mods to message. Returns what the card should show afterwards.
 */
export async function joinRoomFromCard(router: Router, roomId: string): Promise<JoinOutcome> {
  try {
    const r = await joinRoom(roomId);
    if (r.status === 'joined' || r.status === 'already_member') return { kind: 'joined' };
    if (r.status === 'needs_code') {
      router.push({ pathname: '/room/[id]/code', params: { id: roomId } } as never);
      return { kind: 'needs_code' };
    }
    if (r.status === 'requested') return { kind: 'requested' };
    return { kind: 'error', message: joinRoomMessage(r) ?? "Couldn't join this room." };
  } catch (e) {
    if (e instanceof RoomsNotLiveError) return { kind: 'error', message: e.message };
    return { kind: 'error', message: e instanceof Error ? e.message : "Couldn't join this room." };
  }
}

/** A club is a forest: open → in, request-only → requested. */
export async function joinClub(forestId: string): Promise<JoinOutcome> {
  try {
    const s = await joinForest(forestId);
    return s === 'active' ? { kind: 'joined' } : { kind: 'requested' };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : "Couldn't join this club." };
  }
}

/** Open a room: ss1's room screen. */
export function openRoom(router: Router, roomId: string) {
  router.push({ pathname: '/room/[id]', params: { id: roomId } } as never);
}

export function openClub(router: Router, forestId: string) {
  router.push({ pathname: '/forest/[id]', params: { id: forestId } } as never);
}

/**
 * Open someone's Campfire (mock 358). ONE switch point: ss5 owns the Campfire screen and its public
 * URL (philoi.app/{username} — never an @). Until its route lands this is the existing profile view.
 */
export function openCampfire(router: Router, person: { userId: string; handle?: string | null }) {
  router.push({ pathname: '/friend-profile', params: { userId: person.userId } });
}

/** philoi.app/{username} — the public URL. No @ in a URL, ever. */
export function campfireUrl(handle: string): string {
  return `philoi.app/${handle.replace(/^@/, '')}`;
}
