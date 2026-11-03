import { track } from '@/lib/analytics';
import { createAgoraPost } from '@/lib/api/agora';
import { uploadAgoraVideo, type PreparedAgoraVideo } from '@/lib/api/agora-video';
import { channelKey, createCampfirePost } from '@/lib/api/feed-channels';
import { createForestPost } from '@/lib/api/forests';
import { attachWorkoutSetClip, pinPrClip, requestClipUploadUrls, uploadClipAsset } from '@/lib/api/gym-clips';
import { setWorkoutSetClipShown } from '@/lib/api/reel-challenge';
import { setWorkoutSetRanking } from '@/lib/api/stats';
import { announceAgoraPost } from '@/lib/agora-just-posted';
import { supabase } from '@/lib/supabase';
import type { AgoraAttachInput, AgoraVisibility } from '@/types/database';

// "Share → Philoi" (mock 324, 0286). A photo or clip shared in from the OS share sheet becomes one
// of two posts:
//
//   * PLAIN ("Just post it") — the ordinary post: a 0279 video or a photo, nothing else.
//   * ⚔ ("Post with ⚔") — the clip becomes a logged set's clip, and the post carries the set. 0282
//     then decides, as for any post, whether it wears the verified badge and offers ⚔ to friends.
//     The post has NO video of its own: the reel plays the set's clip, which is the clip that
//     verifies the number (agora_verified_lifts skips posts with their own video).
//
// Either way finish_shared_post stamps source = 'share_extension', which is the "↳ from your story"
// tag (isSharedPost below).

export const SHARED_LIFT_MAX_SECONDS = 30;

/** Where the post goes — the composer's WHO SEES IT, same three shapes as agora/compose. */
export type SharedPostAudience =
  | { kind: 'square'; visibility: Extract<AgoraVisibility, 'friends' | 'public'> }
  | { kind: 'campfire' | 'forest'; id: string };

export type SharedLiftInput = {
  exerciseId: string;
  /** Always lb — workout_sets stores lb; the composer converts a kg entry before it gets here. */
  weightLb: number;
  reps: number;
};

type Common = { userId: string; body: string; audience: SharedPostAudience };

async function createPost(input: Common & { photoUri?: string | null; attachments: AgoraAttachInput[] }): Promise<string> {
  const { audience, userId, body, photoUri = null, attachments } = input;
  if (audience.kind === 'square') {
    const id = await createAgoraPost({ body, photoUri, userId, visibility: audience.visibility, attachments });
    announceAgoraPost({ id, itemType: 'post' });
    return id;
  }
  if (audience.kind === 'campfire') {
    const id = await createCampfirePost({ campfireId: audience.id, userId, body, photoUri, attachments });
    announceAgoraPost({ id, itemType: 'post', channel: channelKey({ kind: 'campfire', id: audience.id }) });
    return id;
  }
  const id = await createForestPost({ forestId: audience.id, userId, body, photoUri, attachments });
  announceAgoraPost({ id, itemType: 'post', channel: channelKey({ kind: 'forest', id: audience.id }) });
  return id;
}

/** "Just post it": the shared photo or clip as an ordinary post. */
export async function postSharedPlain(
  input: Common & ({ photoUri: string; video?: never } | { video: PreparedAgoraVideo; photoUri?: never }),
  onUpload?: (fraction: number) => void
): Promise<string> {
  const attachments: AgoraAttachInput[] = [];
  if (input.video) {
    const key = await uploadAgoraVideo(input.video, onUpload ?? (() => {}));
    attachments.push({ kind: 'video', ref_id: null, key });
  }
  const id = await createPost({ ...input, photoUri: input.photoUri ?? null, attachments });
  await stampShared(id, null);
  track('shared_post_created', { challenge: false, media: input.video ? 'video' : 'photo', audience: input.audience.kind });
  return id;
}

/**
 * "Post with ⚔": log the set, file the clip as that set's clip (quota applies), consent it to review
 * and show it on posts, then post. If anything fails before the post exists the set is discarded,
 * so a clipless lift never sits on a board as an unverified PR.
 */
export async function postSharedLift(
  input: Common & { video: PreparedAgoraVideo; lift: SharedLiftInput },
  onUpload?: (fraction: number) => void
): Promise<{ postId: string; isPr: boolean }> {
  const { video, lift } = input;
  const { data: set, error } = await supabase.rpc('log_shared_lift', {
    p_exercise_id: lift.exerciseId,
    p_weight: lift.weightLb,
    p_reps: lift.reps,
  });
  if (error) throw error;

  let postId: string | null = null;
  try {
    const urls = await requestClipUploadUrls(set.id);
    onUpload?.(0.1);
    await Promise.all([
      uploadClipAsset(urls.videoUploadUrl, video.uri, 'video/mp4'),
      uploadClipAsset(urls.thumbUploadUrl, video.posterUri, 'image/jpeg'),
    ]);
    onUpload?.(0.8);
    await attachWorkoutSetClip({
      workoutSetId: set.id,
      videoKey: urls.videoKey,
      thumbKey: urls.thumbKey,
      durationS: video.durationS,
      // "WxH", which parseResolution reads to fit the reel; the recorder's "720p" reads as portrait.
      resolution: video.width && video.height ? `${video.width}x${video.height}` : '720p',
    });
    // Ranked + consented to review = verified (0265). Shown = plays on the post (0282).
    await setWorkoutSetRanking(set.id, { private: false, consent: true });
    await setWorkoutSetClipShown(set.id, true);

    // A PR travels as the 'pr' attachment, so the post reads as a PR card on every build — including
    // installed ones that don't know about shared posts. Not a PR: finish_shared_post links the set.
    const attachments: AgoraAttachInput[] = [];
    if (set.is_pr) {
      const { data: pr } = await supabase.from('personal_records').select('id').eq('workout_set_id', set.id).maybeSingle();
      if (pr?.id) attachments.push({ kind: 'pr', ref_id: pr.id, key: null });
    }
    postId = await createPost({ ...input, attachments });
    onUpload?.(1);
  } catch (e) {
    await supabase.rpc('discard_shared_lift', { p_workout_set_id: set.id });
    throw e;
  }

  await stampShared(postId, set.id);
  // A PR clip leaves the 90-day retention rule, so "✓ clip on file" never outlives the clip.
  if (set.is_pr) void pinPrClip(set.id).catch(() => {});
  track('shared_post_created', { challenge: true, media: 'video', audience: input.audience.kind, is_pr: set.is_pr });
  return { postId, isPr: set.is_pr };
}

/**
 * The post exists by now, so a failure here costs only the tag (and, for a non-PR ⚔, the badge) —
 * it's logged, never thrown over a post that did go up.
 */
async function stampShared(postId: string, workoutSetId: string | null): Promise<void> {
  const { error } = await supabase.rpc('finish_shared_post', { p_post_id: postId, p_workout_set_id: workoutSetId });
  if (error) console.warn('[shared-post] could not stamp the post:', error.message);
}

// ───────────────────────────── the "from your story" tag ─────────────────────────────

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { shared: boolean; at: number }>();
const waiting = new Map<string, ((shared: boolean) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Was this post shared in from another app? BATCHED like getVerifiedLift — one RPC per ~40ms. */
export function isSharedPost(postId: string): Promise<boolean> {
  const hit = cache.get(postId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.shared);
  return new Promise((resolve) => {
    const list = waiting.get(postId) ?? [];
    list.push(resolve);
    waiting.set(postId, list);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 40);
  });
}

async function flush() {
  flushTimer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    let shared = new Set<string>();
    let ok = true;
    try {
      const { data, error } = await supabase.rpc('agora_shared_posts', { p_post_ids: chunk });
      if (error) throw error;
      shared = new Set((data ?? []).map((r) => r.post_id));
    } catch {
      // Pre-0286 server, or offline: no tag — the post renders exactly as it did before.
      ok = false;
    }
    for (const id of chunk) {
      const value = shared.has(id);
      if (ok) cache.set(id, { shared: value, at: Date.now() });
      for (const resolve of batch.get(id) ?? []) resolve(value);
    }
  }
}
