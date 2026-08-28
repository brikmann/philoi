import { File } from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';

import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type {
  AgoraAchievement,
  AgoraAttachKind,
  AgoraComment,
  AgoraCursor,
  AgoraItem,
  AgoraLockIn,
  AgoraScope,
  AgoraVisibility,
} from '@/types/database';

// The Agora (AGORA_SPEC.md, mocks 160 + 162) — the town square.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔒 FIREWALL, same as milestones (0093 / lib/api/milestones.ts). Posting, cheering and commenting
// in the Agora grant ZERO XP, embers or rank. Nothing in this module may call into the economy.
// The Agora pays in ATTENTION — that is the entire product argument for it, and a payout here
// would turn the square into a farm on the first day somebody noticed.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// One design note that runs through the whole module: THE CLIENT NEVER SENDS WHAT AN ACHIEVEMENT
// SAYS, only which one. `create_agora_post` re-reads the fact from the table that owns it and
// freezes it server-side (see agora_attachment_snapshot, migration 0130). Anything else and a
// crafted RPC call could put "Mythic relic · 1,000 lb club" on a card in front of a whole campus.

const PHOTO_BUCKET = 'agora-photos';

/** The bucket is public (see 0128's note), so a path resolves without a signing round trip. */
export function agoraPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ───────────────────────────── the feed ─────────────────────────────

/**
 * One page of the square.
 *
 * The cursor is (created_at, id), not an offset. The feed is a union of two tables whose rows
 * interleave by time, and paging that by offset re-sorts everything above the cursor and starts
 * duplicating or dropping rows the moment somebody posts while you are scrolling.
 */
export async function fetchAgoraFeed(
  scope: AgoraScope,
  cursor: AgoraCursor | null = null,
  limit = 20
): Promise<AgoraItem[]> {
  const { data, error } = await supabase.rpc('get_agora_feed', {
    p_scope: scope,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AgoraItem[];
}

/**
 * One feed item, for the permalink a cheer/comment notification opens. Handles both row types —
 * a comment can hang off a milestone as easily as off a post, and both notifications route here.
 */
export async function fetchAgoraItem(
  id: string,
  itemType: AgoraItem['item_type'] = 'post'
): Promise<AgoraItem | null> {
  const { data, error } = await supabase.rpc('get_agora_item', { p_id: id, p_item_type: itemType });
  if (error) throw error;
  return (data as AgoraItem | null) ?? null;
}

// ───────────────────────────── posting ─────────────────────────────

/**
 * Upload a composer photo and return its storage PATH (not a URL).
 *
 * The path is prefixed with the uploader's own id because the bucket policy requires it — a write
 * anywhere else is rejected by storage, and `create_agora_post` re-checks the prefix so a crafted
 * RPC call can't point a post at someone else's image after the fact.
 */
export async function uploadAgoraPhoto(userId: string, photoUri: string): Promise<string> {
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const base64 = await new File(photoUri).base64();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export async function createAgoraPost(input: {
  body?: string | null;
  photoUri?: string | null;
  userId: string;
  visibility: AgoraVisibility;
  attach?: { kind: AgoraAttachKind; refId?: string | null; key?: string | null } | null;
}): Promise<string> {
  let photoPath: string | null = null;
  if (input.photoUri) photoPath = await uploadAgoraPhoto(input.userId, input.photoUri);

  const { data, error } = await supabase.rpc('create_agora_post', {
    p_body: input.body?.trim() || null,
    p_photo_path: photoPath,
    p_visibility: input.visibility,
    p_attach_kind: input.attach?.kind ?? null,
    p_attach_ref_id: input.attach?.refId ?? null,
    p_attach_key: input.attach?.key ?? null,
  });
  if (error) {
    // The upload succeeded and the post did not — same cleanup lock-ins.ts does, so a rejected
    // post doesn't leave an orphan in the bucket that nothing will ever reference or delete.
    if (photoPath) await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
    throw error;
  }

  track('agora_posted', {
    visibility: input.visibility,
    has_photo: Boolean(photoPath),
    attach_kind: input.attach?.kind ?? null,
  });
  return data;
}

export async function deleteAgoraPost(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_agora_post', { p_id: id });
  if (error) throw error;
  // The RPC hands back the path it just orphaned; storage has no cascade of its own.
  if (data) await supabase.storage.from(PHOTO_BUCKET).remove([data]);
}

// ───────────────────────────── cheers ─────────────────────────────

/**
 * Cheer a feed item.
 *
 * Two RPCs behind one call, because the feed is a union of two row types with two cheer tables
 * (milestone_cheers is FK'd to milestones, so posts needed their own). Every caller above this
 * line gets to keep treating the feed as one list of cards.
 *
 * Returns the new count so the card updates without a refetch.
 */
export async function cheerAgoraItem(item: Pick<AgoraItem, 'item_type' | 'id'>): Promise<number> {
  const { data, error } =
    item.item_type === 'post'
      ? await supabase.rpc('cheer_agora_post', { p_post_id: item.id })
      : await supabase.rpc('cheer_milestone', { p_milestone_id: item.id });
  if (error) throw error;
  track('agora_cheered', { item_type: item.item_type });
  return (data as number) ?? 0;
}

// ───────────────────────────── comments ─────────────────────────────

/** Which parent id a comment hangs off — the RPCs take one or the other, never both. */
function commentParent(item: Pick<AgoraItem, 'item_type' | 'id'>) {
  return item.item_type === 'post'
    ? { p_post_id: item.id, p_milestone_id: null }
    : { p_post_id: null, p_milestone_id: item.id };
}

export async function fetchAgoraComments(
  item: Pick<AgoraItem, 'item_type' | 'id'>,
  limit = 100
): Promise<AgoraComment[]> {
  const { data, error } = await supabase.rpc('get_agora_comments', {
    ...commentParent(item),
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AgoraComment[];
}

export async function addAgoraComment(
  item: Pick<AgoraItem, 'item_type' | 'id'>,
  body: string
): Promise<string> {
  const { data, error } = await supabase.rpc('add_agora_comment', {
    ...commentParent(item),
    p_body: body.trim(),
  });
  if (error) throw error;
  track('agora_commented', { item_type: item.item_type });
  return data as string;
}

/** Yours, or anything on an item you authored — the "hide" half of report/hide + block. */
export async function deleteAgoraComment(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_agora_comment', { p_id: id });
  if (error) throw error;
}

// ───────────────────────────── the composer's pickers ─────────────────────────────

/** Everything you've earned, in one round trip (mock 162 panel 4). */
export async function fetchAgoraAchievements(): Promise<AgoraAchievement[]> {
  const { data, error } = await supabase.rpc('get_agora_achievements');
  if (error) throw error;
  return (data ?? []) as AgoraAchievement[];
}

/** Your finished sessions (mock 162 panel 5). */
export async function fetchAgoraLockIns(limit = 40): Promise<AgoraLockIn[]> {
  const { data, error } = await supabase.rpc('get_agora_lockins', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AgoraLockIn[];
}

// ───────────────────────────── moderation ─────────────────────────────

/**
 * Report a post or a comment. Writes the reference columns 0128/0129 added to moderation_reports,
 * so a reviewer opens the content rather than a bare "someone reported this person".
 */
export async function reportAgora(input: {
  reporterId: string;
  reportedUserId: string;
  reason: string;
  postId?: string | null;
  commentId?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('moderation_reports').insert({
    reporter_id: input.reporterId,
    reported_user_id: input.reportedUserId,
    reason: input.reason,
    reported_agora_post_id: input.postId ?? null,
    reported_agora_comment_id: input.commentId ?? null,
  });
  if (error) throw error;
}

export async function blockAgoraUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
}

/** AGORA_SPEC "Privacy" — take one milestone out of the square without unpinning it. */
export async function setMilestoneInAgora(id: string, inAgora: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_milestone_in_agora', { p_id: id, p_in_agora: inAgora });
  if (error) throw error;
}

// ───────────────────────────── the reach dials ─────────────────────────────

/**
 * The filter chips (mock 162). Ordered narrowest → widest, which is also the order of how much
 * the average row will mean to you.
 *
 * `university` carries no school name here: the label is filled in from the viewer's own
 * `profiles.university` at render, so the chip reads "Waterloo" rather than "University".
 */
export const AGORA_SCOPES: { key: AgoraScope; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'campfires', label: 'Campfires' },
  { key: 'university', label: 'University' },
  { key: 'global', label: 'Global' },
];

/**
 * The composer's audience picker. Note this is the MILESTONE vocabulary (friends/campus/public),
 * not the feed's scope vocabulary — the two are different questions. A scope is "whose posts am I
 * looking at"; a visibility is "who may ever see mine", and it travels with the post forever.
 */
export const AGORA_VISIBILITIES: { key: AgoraVisibility; label: string; hint: string }[] = [
  { key: 'friends', label: 'Friends', hint: 'Just your people' },
  { key: 'campus', label: 'Campus', hint: 'Everyone at your school' },
  { key: 'public', label: 'Global', hint: 'Every campus on Philoi' },
];
