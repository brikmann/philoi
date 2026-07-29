import { supabase } from '@/lib/supabase';
import type { CheckIn, Reaction, WorkoutEnergy, WorkoutSetEntry } from '@/types/database';

export type FeedCheckIn = CheckIn & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
  reactions: Reaction[];
  signedPhotoUrl: string | null;
  signedPhotoUrls: string[];
  /** Gym lock-ins only (PHILOI_UI_SPEC.md §23) — the rolled-up lifts behind the card's
   * "Bench press 3×6 @ 155" line. Empty for every other goal type. */
  workoutSets: Required<WorkoutSetEntry>[];
  /** The session's energy + whether the "dialed" brag was actually earned. Null when the
   * check-in wasn't a tracked gym session. */
  workout: { energy: WorkoutEnergy; brag_earned: boolean; routine_name: string | null } | null;
};

const PHOTO_BUCKET = 'check-in-photos';

// A circle's feed is scoped to check-ins that were actually posted while the poster was a
// member of THIS circle — check_in_circles snapshots that at insert time (see
// snapshot_check_in_circles() in schema.sql), so joining a circle never retroactively
// surfaces a member's older history from before they joined. This is deliberately narrower
// than "every check-in by any current member" (the bug this replaced) — a circle's feed is
// its own point-in-time history, not a live view over its members' full activity.
export async function fetchFeed(groupId: string): Promise<FeedCheckIn[]> {
  const { data: session } = await supabase.auth.getSession();
  const viewerId = session.session?.user.id;

  const [{ data: links, error: linksError }, { data: blocked }] = await Promise.all([
    supabase.from('check_in_circles').select('check_in_id').eq('circle_id', groupId),
    viewerId
      ? supabase.from('blocked_users').select('blocked_id').eq('blocker_id', viewerId)
      : Promise.resolve({ data: null }),
  ]);
  if (linksError) throw linksError;

  const checkInIds = (links ?? []).map((l) => l.check_in_id);
  if (checkInIds.length === 0) return [];

  const blockedIds = new Set((blocked ?? []).map((b) => b.blocked_id));

  const { data, error } = await supabase
    .from('check_ins')
    .select('*, profiles(display_name, avatar_url, handle), reactions(*)')
    .in('id', checkInIds)
    .is('removed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = ((data ?? []) as unknown as FeedCheckIn[]).filter((row) => !blockedIds.has(row.user_id));
  if (rows.length === 0) return rows;

  // A lock-in session's gallery lives in check_in_photos (see migration 0008); check_ins.photo_url
  // is only the legacy single-photo column, still populated (with the first gallery photo, for
  // lock-in rows) for anything that reads it directly. Fetch both in the same pass so a check-in
  // that predates check_in_photos still renders via its lone photo_url.
  const rowIds = rows.map((r) => r.id);
  const { data: galleryRows, error: galleryError } = await supabase
    .from('check_in_photos')
    .select('check_in_id, photo_url')
    .in('check_in_id', rowIds)
    .order('position');
  if (galleryError) throw galleryError;

  const galleryPathsByCheckIn = new Map<string, string[]>();
  for (const g of galleryRows ?? []) {
    const list = galleryPathsByCheckIn.get(g.check_in_id) ?? [];
    list.push(g.photo_url);
    galleryPathsByCheckIn.set(g.check_in_id, list);
  }

  const legacyPaths = rows.map((r) => r.photo_url).filter((p): p is string => p !== null);
  const allPaths = [...new Set([...legacyPaths, ...(galleryRows ?? []).map((g) => g.photo_url)])];
  const { data: signed } = allPaths.length > 0
    ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(allPaths, 60 * 60)
    : { data: null };

  // Gym lifts + PRs for the card (§23). Batched over the visible gym rows only — a campfire
  // that never lifts pays nothing for this. RLS on both tables already scopes them to the
  // viewer's circle-mates, so no extra filtering is needed here.
  const gymRowIds = rows.filter((r) => r.goal_type === 'gym').map((r) => r.id);
  const [{ data: setRows }, { data: workoutRows }] =
    gymRowIds.length > 0
      ? await Promise.all([
          supabase
            .from('check_in_workout_sets')
            .select('check_in_id, exercise, sets, reps, weight, is_pr, position')
            .in('check_in_id', gymRowIds)
            .order('position'),
          supabase.from('workouts').select('check_in_id, energy, brag_earned, routine_name').in('check_in_id', gymRowIds),
        ])
      : [{ data: null }, { data: null }];

  const setsByCheckIn = new Map<string, Required<WorkoutSetEntry>[]>();
  for (const s of setRows ?? []) {
    const list = setsByCheckIn.get(s.check_in_id) ?? [];
    list.push({ exercise: s.exercise, sets: s.sets, reps: s.reps, weight: s.weight ?? null, is_pr: s.is_pr ?? false });
    setsByCheckIn.set(s.check_in_id, list);
  }
  const workoutByCheckIn = new Map(
    (workoutRows ?? [])
      .filter((w) => w.check_in_id !== null)
      .map((w) => [w.check_in_id!, { energy: w.energy, brag_earned: w.brag_earned, routine_name: w.routine_name }])
  );

  const urlByPath = new Map(signed?.map((s) => [s.path, s.signedUrl]));
  return rows.map((row) => {
    const galleryPaths = galleryPathsByCheckIn.get(row.id);
    const signedPhotoUrl = row.photo_url ? (urlByPath.get(row.photo_url) ?? null) : null;
    const signedPhotoUrls = galleryPaths
      ? galleryPaths.map((p) => urlByPath.get(p)).filter((u): u is string => Boolean(u))
      : signedPhotoUrl
        ? [signedPhotoUrl]
        : [];
    return {
      ...row,
      signedPhotoUrl,
      signedPhotoUrls,
      workoutSets: setsByCheckIn.get(row.id) ?? [],
      workout: workoutByCheckIn.get(row.id) ?? null,
    };
  });
}

export type MyRecentLockIn = {
  id: string;
  goal_type: CheckIn['goal_type'];
  goal_detail: string | null;
  duration_seconds: number | null;
  signedPhotoUrl: string | null;
};

// Profile screen's "recent lock-ins" grid (design-mocks/15) — the caller's own completed
// sessions only, newest first. photo_url is the legacy single-photo column, still populated
// with the first gallery photo for every lock-in row (see check_in_photos' own comment), so a
// one-photo-per-card grid doesn't need to join the gallery table at all.
export async function fetchMyRecentLockIns(userId: string, limit = 6): Promise<MyRecentLockIn[]> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('id, goal_type, goal_detail, duration_seconds, photo_url')
    .eq('user_id', userId)
    // `> 0`, not merely `is not null` — a 0-duration phantom (a start with no real elapsed time)
    // otherwise slips through as a "0m" recent. Purge it here so the journal only shows real sessions.
    .gt('duration_seconds', 0)
    .is('removed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  const paths = rows.map((r) => r.photo_url).filter((p): p is string => Boolean(p));
  const { data: signed } = paths.length > 0 ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60) : { data: null };
  const urlByPath = new Map(signed?.map((s) => [s.path, s.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    goal_type: row.goal_type,
    goal_detail: row.goal_detail,
    duration_seconds: row.duration_seconds,
    signedPhotoUrl: row.photo_url ? (urlByPath.get(row.photo_url) ?? null) : null,
  }));
}

// Same grid, for viewing someone ELSE's profile (design-mocks/15, PHILOI_UI_SPEC.md §19) —
// routes through get_user_lock_in_photos() instead of a direct table select, since that RPC
// is what actually enforces their photo_visibility setting (a raw check_ins select can't: its
// RLS policy has no path for a true stranger to read a row at all, regardless of visibility).
// Works for your own id too (the RPC's own-user branch just returns everything), so the
// profile screen can call this one function regardless of whose profile is showing.
export async function fetchUserLockInPhotos(userId: string, limit = 6): Promise<MyRecentLockIn[]> {
  const { data, error } = await supabase.rpc('get_user_lock_in_photos', { p_user_id: userId, p_limit: limit });
  if (error) throw error;

  const rows = data ?? [];
  const paths = rows.map((r) => r.photo_url).filter((p): p is string => Boolean(p));
  const { data: signed } = paths.length > 0 ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60) : { data: null };
  const urlByPath = new Map(signed?.map((s) => [s.path, s.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    goal_type: row.goal_type,
    goal_detail: row.goal_detail,
    duration_seconds: row.duration_seconds,
    signedPhotoUrl: row.photo_url ? (urlByPath.get(row.photo_url) ?? null) : null,
  }));
}

// Home's dynamic greeting (PHILOI_UI_SPEC.md §5) — "today" resets at LOCAL midnight, so this
// takes the device's own start-of-day timestamp rather than a server-side date function
// (the server doesn't know the caller's timezone). A plain count query, not worth an RPC.
export async function fetchMyTodayLockInCount(userId: string, localStartOfDayIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('check_ins')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    // `> 0` so a 0-duration phantom can't inflate today's count and push the greeting into a
    // higher bucket (e.g. the "Certified machine" line) without a real session behind it.
    .gt('duration_seconds', 0)
    .is('removed_at', null)
    .gte('created_at', localStartOfDayIso);
  if (error) throw error;
  return count ?? 0;
}

// The per-goal photo check-in path (postCheckIn) was retired with the core lock-in loop
// rebuild (migration 0012): all check-ins now flow through stop_lock_in_session(), which
// sets goal_type on the row itself. The old insert relied on the snapshot_check_in_goal()
// BEFORE trigger to denormalize goal_type from goals — that trigger is gone, so a direct
// insert without goal_type now violates check_ins.goal_type NOT NULL. See src/lib/api/lock-ins.ts.
