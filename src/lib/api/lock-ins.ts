import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { CheckIn, GoalType, LockInSession, WorkoutSetEntry } from '@/types/database';

const PHOTO_BUCKET = 'check-in-photos';

export async function startLockInSession(
  goalType: GoalType,
  goalDetail?: string | null,
  circleId?: string | null
): Promise<LockInSession> {
  const { data, error } = await supabase.rpc('start_lock_in_session', {
    p_goal_type: goalType,
    p_goal_detail: goalDetail ?? null,
    p_circle_id: circleId ?? null,
  });
  if (error) throw error;
  track('lock_in_started', { goal_type: goalType, circle_id: circleId ?? null });
  return data;
}

// Resume-on-reopen: the timer is derived from started_at, not client state, so if the app
// was closed mid-session this is how the active-session screen figures out it should still
// be showing a running timer instead of a fresh "start" screen.
export async function fetchMyActiveLockInSession(userId: string): Promise<LockInSession | null> {
  const { data, error } = await supabase
    .from('lock_in_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function confirmLockInSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_lock_in_session', { p_session_id: sessionId });
  if (error) throw error;
}

export async function stopLockInSession(input: {
  sessionId: string;
  userId: string;
  goalType: GoalType;
  photoUris?: string[];
  caption?: string | null;
  /** Gym's proof-of-effort (migration 0033) — ignored server-side for any other goal type. */
  workoutSets?: WorkoutSetEntry[];
}): Promise<CheckIn> {
  const photoUris = input.photoUris ?? [];
  let photoPaths: string[] = [];

  if (photoUris.length > 0) {
    // One id for the whole batch's storage prefix — purely a path convention, unrelated to
    // the real check_ins.id the RPC generates server-side; the client never reconciles the two.
    const checkInId = Crypto.randomUUID();
    photoPaths = photoUris.map((_, index) => `${input.userId}/${checkInId}/${index}.jpg`);
    try {
      await Promise.all(
        photoUris.map(async (uri, index) => {
          const base64 = await new File(uri).base64();
          const { error: uploadError } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(photoPaths[index], decode(base64), { contentType: 'image/jpeg', upsert: false });
          if (uploadError) throw uploadError;
        })
      );
    } catch (e) {
      // Some uploads in the batch may have already succeeded before one failed — clean up
      // whatever made it to Storage rather than leaving orphaned files behind.
      await supabase.storage.from(PHOTO_BUCKET).remove(photoPaths);
      throw e;
    }
  }

  const { data, error } = await supabase.rpc('stop_lock_in_session', {
    p_session_id: input.sessionId,
    p_photo_urls: photoPaths.length > 0 ? photoPaths : null,
    p_caption: input.caption?.trim() || null,
    p_workout_sets: input.workoutSets && input.workoutSets.length > 0 ? input.workoutSets : null,
  });
  if (error) {
    if (photoPaths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(photoPaths);
    throw error;
  }

  track('lock_in_completed', {
    goal_type: input.goalType,
    duration_seconds: data.duration_seconds,
    xp_earned: data.xp_earned,
    has_photo: photoPaths.length > 0,
    photo_count: photoPaths.length,
  });
  return data;
}

// "Post to the campfire" on the done screen (PHILOI_UI_SPEC.md §13) — the lock-in event isn't
// posted to any circle until this is explicitly called; "Keep this one private" just never
// calls it.
/** The lock-in's caption, written from the done screen (§13 redesign — the running session no
 * longer has a caption field). RPC-gated because check_ins has no UPDATE policy: a direct client
 * update returns success with the row unchanged, so this would fail silently otherwise. */
export async function setCheckInCaption(checkInId: string, caption: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_check_in_caption', { p_check_in_id: checkInId, p_caption: caption });
  if (error) throw error;
}

export async function postCheckInToCircle(checkInId: string, circleId: string): Promise<void> {
  const { error } = await supabase.rpc('post_check_in_to_circle', {
    p_check_in_id: checkInId,
    p_circle_id: circleId,
  });
  if (error) throw error;
  track('lock_in_posted_to_circle', { circle_id: circleId });
}

export type ActiveCircleLockIn = {
  // goal_type/goal_detail live on the session itself now (no goals join needed — goal_id
  // can be null since the core lock-in loop rebuild, PHILOI_UI_SPEC.md §12).
  session: LockInSession;
  display_name: string;
  avatar_url: string | null;
};

type LockInSessionWithProfile = LockInSession & {
  profiles: { display_name: string; avatar_url: string | null };
};

// Simpler than fetchActiveCircleLockIns below — no circle scoping needed here because RLS
// on lock_in_sessions ("read if circle-mate") already restricts rows to yours + anyone
// sharing a circle with you, in any circle. This is what the active-session screen itself
// uses for the "who else is locked in with me right now" flame — ambient across all of the
// viewer's circles at once, matching the body-doubling framing (not scoped to one circle).
export async function fetchMyVisibleActiveLockIns(myUserId: string): Promise<ActiveCircleLockIn[]> {
  const { data, error } = await supabase
    .from('lock_in_sessions')
    .select('*, profiles(display_name, avatar_url)')
    .eq('status', 'active')
    .neq('user_id', myUserId);
  if (error) throw error;

  return ((data ?? []) as unknown as LockInSessionWithProfile[]).map((row) => ({
    session: row,
    display_name: row.profiles.display_name,
    avatar_url: row.profiles.avatar_url,
  }));
}

// Live "locked in now" presence for a specific campfire — the campfire interior's presence
// strip and circle-timeline's "started" live card. Scoped strictly to sessions whose OWN
// circle_id is THIS campfire (not "any active session belonging to a member of this
// campfire," which used to leak solo lock-ins and lock-ins scoped to a *different* campfire
// into every campfire the locker-in happens to belong to). RLS ("read if circle-mate") still
// gates who the caller is allowed to see rows for; this just adds the scope filter on top.
// v1: polled on a timer by callers (no Realtime Presence yet — see the lock-in build plan).
export async function fetchActiveCircleLockIns(circleId: string): Promise<ActiveCircleLockIn[]> {
  const { data, error } = await supabase
    .from('lock_in_sessions')
    .select('*, profiles(display_name, avatar_url)')
    .eq('status', 'active')
    .eq('circle_id', circleId);
  if (error) throw error;

  return ((data ?? []) as unknown as LockInSessionWithProfile[]).map((row) => ({
    session: row,
    display_name: row.profiles.display_name,
    avatar_url: row.profiles.avatar_url,
  }));
}
