import { uploadAgoraPhoto } from '@/lib/api/agora';
import { supabase } from '@/lib/supabase';
import type { AgoraAttachInput, AgoraCursor, AgoraItem, Group } from '@/types/database';
import type { ForestDetail, ForestSort, ForestSummary, ForestVisibility } from '@/types/social';

// Forests (0274, CODE_PROMPT_agora_forests.md, mock 283 §02) — interest hubs inside the Agora that
// funnel into campfires. The tables are RPC-only; each call below applies the forest's own rules
// (open vs request-to-join, this-uni-only, owner tools) server-side.

export async function fetchForests(sort: ForestSort = 'active', query?: string): Promise<ForestSummary[]> {
  const { data, error } = await supabase.rpc('get_forests', { p_sort: sort, p_query: query?.trim() || null });
  if (error) throw error;
  return (data as ForestSummary[] | null) ?? [];
}

export async function fetchForest(forestId: string): Promise<ForestDetail | null> {
  const { data, error } = await supabase.rpc('get_forest', { p_forest_id: forestId });
  if (error) throw error;
  return (data as ForestDetail | null) ?? null;
}

/** Same row shape as the Agora feed, so the same card renders it. */
export async function fetchForestFeed(forestId: string, cursor: AgoraCursor | null = null, limit = 20): Promise<AgoraItem[]> {
  const { data, error } = await supabase.rpc('get_forest_feed', {
    p_forest_id: forestId,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as AgoraItem[];
}

export async function createForest(input: {
  name: string;
  purpose?: string | null;
  emoji?: string | null;
  tags?: string[];
  visibility: ForestVisibility;
  thisUniOnly: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_forest', {
    p_name: input.name.trim(),
    p_purpose: input.purpose?.trim() || null,
    p_emoji: input.emoji || null,
    p_tags: input.tags ?? [],
    p_visibility: input.visibility,
    p_this_uni_only: input.thisUniOnly,
  });
  if (error) throw error;
  return data as string;
}

/** 'active' for an open forest, 'pending' for a request-only one. */
export async function joinForest(forestId: string): Promise<'active' | 'pending'> {
  const { data, error } = await supabase.rpc('join_forest', { p_forest_id: forestId });
  if (error) throw error;
  return data as 'active' | 'pending';
}

export async function leaveForest(forestId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_forest', { p_forest_id: forestId });
  if (error) throw error;
}

export async function closeForest(forestId: string): Promise<void> {
  const { error } = await supabase.rpc('close_forest', { p_forest_id: forestId });
  if (error) throw error;
}

export async function respondForestRequest(forestId: string, userId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_forest_request', { p_forest_id: forestId, p_user_id: userId, p_approve: approve });
  if (error) throw error;
}

/** Owner tool. The member can't rejoin, and their posts in this forest are removed. */
export async function removeForestMember(forestId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_forest_member', { p_forest_id: forestId, p_user_id: userId });
  if (error) throw error;
}

/** Author or forest owner. */
export async function removeForestPost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_forest_post', { p_post_id: postId });
  if (error) throw error;
}

export async function createForestPost(input: {
  forestId: string;
  userId: string;
  body?: string | null;
  photoUri?: string | null;
  attachments?: AgoraAttachInput[];
}): Promise<string> {
  let photoPath: string | null = null;
  if (input.photoUri) photoPath = await uploadAgoraPhoto(input.userId, input.photoUri);
  const { data, error } = await supabase.rpc('create_forest_post', {
    p_forest_id: input.forestId,
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

/** An ordinary campfire (same owner row, same join code), pre-linked to the forest. */
export async function createCampfireInForest(input: {
  forestId: string;
  name: string;
  emoji: string;
  goalType: string;
  cadence: string;
  privacy?: 'open' | 'gated' | 'private';
}): Promise<Group> {
  const { data, error } = await supabase.rpc('create_campfire_in_forest', {
    p_forest_id: input.forestId,
    p_name: input.name.trim(),
    p_emoji: input.emoji,
    p_goal_type: input.goalType,
    p_cadence: input.cadence,
    p_privacy: input.privacy ?? 'open',
  });
  if (error) throw error;
  return data as Group;
}

/** Pin a campfire you own to a forest you're in; null unpins. */
export async function setCampfireForest(groupId: string, forestId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_campfire_forest', { p_group_id: groupId, p_forest_id: forestId });
  if (error) throw error;
}

export const FOREST_REPORT_REASONS = [
  'Spam or misleading',
  'Harassment or bullying',
  'Inappropriate or offensive content',
  'Child safety / CSAE',
  'Other',
] as const;

export async function reportForest(forestId: string, reason: (typeof FOREST_REPORT_REASONS)[number], note?: string): Promise<void> {
  const { error } = await supabase.rpc('report_forest', { p_forest_id: forestId, p_reason: reason, p_note: note ?? null });
  if (error) throw error;
}

export const FOREST_SORTS: { key: ForestSort; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'popular', label: 'Popular' },
  { key: 'new', label: 'New' },
  { key: 'mine', label: 'Mine' },
];
