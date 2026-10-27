import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { AgoraItem, LiftChallengeRow, SocialChallenge, VerifiedLiftRow } from '@/types/database';

// Challenge from the reel (mock 319, migration 0282). A PR clip IS its own verification: when a
// post carries a set whose clip is on file, consented to review, and shown by its owner, the reel
// wears "🏋️ 405 lb Deadlift ✓" and offers ⚔ — a head-to-head on the existing duel path whose target
// is that exact set, frozen at send.
//
// The server decides all of it — whether the badge shows (agora_verified_lifts, as the viewer, with
// the post's own visibility rule), what the target is, and who may be challenged (friends only).
// The client sends only which post and which window.

/** The verified lift a post shows, as the viewer may see it. */
export type VerifiedLift = VerifiedLiftRow;

export type ReelChallengeWindow = '7d' | '14d' | 'season';

/** "405 lb" — weights are pounds, as the logger enters them. */
export function formatLiftWeight(weight: number): string {
  return `${Number(weight.toFixed(2))} lb`;
}

/** "405 lb × 1" — the exact set, which is what the race has to beat. */
export function formatLiftSet(lift: { weight: number; reps: number }): string {
  return `${formatLiftWeight(lift.weight)} × ${lift.reps}`;
}

/**
 * Could this post carry a verified lift at all? A gym lock-in's frozen clips (0192) or a PR card.
 * Skips the round trip for the text, photo and reward posts that make up most of the feed — and a
 * post with its own video never gets the badge (its clip isn't the one that verifies the number).
 */
export function mayCarryLift(item: Pick<AgoraItem, 'item_type' | 'attachments'>): boolean {
  if (item.item_type !== 'post') return false;
  const atts = item.attachments ?? [];
  if (atts.some((a) => a?.kind === 'video')) return false;
  return atts.some((a) => a?.kind === 'pr' || (a?.kind === 'lockin' && (a.snapshot?.clips?.length ?? 0) > 0));
}

type CacheEntry = { lift: VerifiedLift | null; at: number };

// A badge can come or go (owner un-shows it, a dispute opens) — five minutes is fresh enough for
// a feed and still one call per page of scrolling, not one per swipe.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const waiting = new Map<string, ((lift: VerifiedLift | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The verified lift on one post, or null. BATCHED like getAgoraVideoUrls: every page that asks in
 * the same ~40ms shares one RPC.
 */
export function getVerifiedLift(postId: string): Promise<VerifiedLift | null> {
  const hit = cache.get(postId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.lift);

  return new Promise((resolve) => {
    const list = waiting.get(postId) ?? [];
    list.push(resolve);
    waiting.set(postId, list);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 40);
  });
}

/** Drop a post's cached lift — after sending a challenge, so the sheet reads "already sent". */
export function forgetVerifiedLift(postId: string): void {
  cache.delete(postId);
}

async function flush() {
  flushTimer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const ids = [...batch.keys()];

  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const byPost = new Map<string, VerifiedLift>();
    let ok = true;
    try {
      const { data, error } = await supabase.rpc('agora_verified_lifts', { p_post_ids: chunk });
      if (error) throw error;
      for (const row of data ?? []) {
        byPost.set(row.post_id, { ...row, weight: Number(row.weight), duration_s: row.duration_s == null ? null : Number(row.duration_s) });
      }
    } catch {
      // Pre-0282 server, or offline: no badge, no ⚔ — the post renders exactly as it did before.
      ok = false;
    }
    for (const id of chunk) {
      const lift = byPost.get(id) ?? null;
      // A failed call isn't cached, so the badge appears once the server answers.
      if (ok) cache.set(id, { lift, at: Date.now() });
      for (const resolve of batch.get(id) ?? []) resolve(lift);
    }
  }
}

/**
 * Signed URLs for a verified lift's clip, in the reel's {videoUrl, posterUrl} shape. Played through
 * gym-clip-playback-url — the set's own clip, never a copy — which since 0282 also signs for anyone
 * who can open a post its owner showed it on. Cached for the URLs' hour, less ten minutes.
 */
const clipCache = new Map<string, { urls: { videoUrl: string; posterUrl: string | null } | null; expiresAt: number }>();

export async function getLiftClipUrls(workoutSetId: string): Promise<{ videoUrl: string; posterUrl: string | null } | null> {
  const hit = clipCache.get(workoutSetId);
  if (hit && hit.expiresAt > Date.now()) return hit.urls;
  try {
    const { data, error } = await supabase.functions.invoke('gym-clip-playback-url', { body: { workoutSetId } });
    if (error) throw error;
    if (data?.error || !data?.videoUrl) throw new Error(data?.error ?? 'No clip.');
    const urls = { videoUrl: data.videoUrl as string, posterUrl: (data.thumbUrl as string | null) ?? null };
    clipCache.set(workoutSetId, { urls, expiresAt: Date.now() + 50 * 60 * 1000 });
    return urls;
  } catch {
    // Retried after a minute rather than cached for the hour.
    clipCache.set(workoutSetId, { urls: null, expiresAt: Date.now() + 60 * 1000 });
    return null;
  }
}

/** "720x1280" → portrait/landscape for the reel's fit. Unknown = null (treated as portrait). */
export function parseResolution(res: string | null): { width: number; height: number } | null {
  const m = res?.match(/(\d+)\s*[x×]\s*(\d+)/i);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** ⚔ — create the head-to-head on the existing duel path, pre-filled from the clip. */
export async function createReelChallenge(postId: string, window: ReelChallengeWindow): Promise<SocialChallenge> {
  const { data, error } = await supabase.rpc('create_reel_challenge', { p_post_id: postId, p_window: window });
  if (error) throw error;
  forgetVerifiedLift(postId);
  track('challenge_created', { mode: 'h2h', source: 'reel', window });
  return data;
}

/** A verified_lift race as its two racers see it: the target, and the challenger's best beat. */
export type LiftChallenge = LiftChallengeRow;

export async function getLiftChallenge(challengeId: string): Promise<LiftChallenge | null> {
  const { data, error } = await supabase.rpc('get_lift_challenge', { p_challenge_id: challengeId });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    ...row,
    target_weight: Number(row.target_weight),
    best_weight: row.best_weight == null ? null : Number(row.best_weight),
  };
}

/** Owner-only: let this set's clip play on your posts, to anyone who can open the post. */
export async function setWorkoutSetClipShown(workoutSetId: string, shown: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_workout_set_clip_shown', { p_workout_set_id: workoutSetId, p_shown: shown });
  if (error) throw error;
}
