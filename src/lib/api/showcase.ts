import { supabase } from '@/lib/supabase';
import { fetchUserLockInPhotos } from '@/lib/api/check-ins';
import type { CheckIn } from '@/types/database';

// The profile's Showcase wall (mock 325) — the proudest lock-in and the heaviest lifts, read from
// tables that already exist. No new RPC: every read here is one RLS already answers.
//
// WHAT A VISITOR CAN SEE IS NARROWER, AND THAT IS THE POLICY, NOT A GAP. personal_records is
// owner-only (0037: "PRs are private for now"), so someone else's PR tiles come from their identity
// row's recent win (get_profile_identity, already dial-filtered) instead. Their longest session
// rides get_user_lock_in_photos, which is what enforces their photo_visibility — a raw check_ins
// select has no path for a stranger at all.

export type ShowcasePr = {
  id: string;
  exercise: string;
  weight: number;
  reps: number;
  /** A consented clip on file for a PR nobody has pulled (0265/0266) — "✓ clip on file". */
  verified: boolean;
};

export type ShowcaseSession = {
  id: string;
  goal_type: CheckIn['goal_type'];
  category: CheckIn['category'];
  goal_detail: string | null;
  duration_seconds: number;
};

type PrRow = {
  id: string;
  weight: number | string;
  reps: number;
  exercises: { name: string } | null;
  workout_sets: { video_key: string | null; clip_consent_at: string | null; pr_status: string | null; pr_private: boolean | null } | null;
};

/** Your own best lifts, heaviest estimated 1RM first. Private and pulled PRs never make the wall. */
export async function fetchMyShowcasePrs(userId: string, limit = 2): Promise<{ prs: ShowcasePr[]; count: number }> {
  const { data, error, count } = await supabase
    .from('personal_records')
    .select('id, weight, reps, exercises(name), workout_sets(video_key, clip_consent_at, pr_status, pr_private)', { count: 'exact' })
    .eq('user_id', userId)
    .order('e1rm', { ascending: false })
    // Over-fetch so a private or pulled PR at the top doesn't leave the wall a tile short.
    .limit(limit + 4);
  if (error) throw error;

  const prs = ((data ?? []) as unknown as PrRow[])
    .filter((r) => r.workout_sets?.pr_status !== 'pulled' && r.workout_sets?.pr_private !== true)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      exercise: r.exercises?.name ?? 'Lift',
      weight: Number(r.weight) || 0,
      reps: r.reps,
      verified: Boolean(r.workout_sets?.video_key && r.workout_sets.clip_consent_at && r.workout_sets.pr_status !== 'disputed'),
    }));
  return { prs, count: count ?? prs.length };
}

/** The longest session someone has logged. Own: every session. Anyone else: what they let you see. */
export async function fetchLongestLockIn(userId: string, isOwn: boolean): Promise<ShowcaseSession | null> {
  if (isOwn) {
    const { data, error } = await supabase
      .from('check_ins')
      .select('id, goal_type, category, goal_detail, duration_seconds')
      .eq('user_id', userId)
      .gt('duration_seconds', 0)
      .is('removed_at', null)
      .order('duration_seconds', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { ...data, duration_seconds: data.duration_seconds ?? 0 } : null;
  }

  const rows = await fetchUserLockInPhotos(userId, 30);
  const best = rows.reduce<(typeof rows)[number] | null>(
    (top, r) => ((r.duration_seconds ?? 0) > (top?.duration_seconds ?? 0) ? r : top),
    null
  );
  if (!best || !best.duration_seconds) return null;
  return {
    id: best.id,
    goal_type: best.goal_type,
    category: null,
    goal_detail: best.goal_detail,
    duration_seconds: best.duration_seconds,
  };
}
