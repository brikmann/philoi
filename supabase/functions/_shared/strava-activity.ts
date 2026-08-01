// Shared "turn one Strava activity into a lock-in" logic (PHILOI_UI_SPEC.md §17b) — used by both
// strava-webhook (real-time, primary trigger) and strava-backfill (poll-on-app-open safety net),
// so the floor/mapping/dedup/auto-post rules live in exactly one place regardless of which path
// discovered the activity. Service-role only: every function here takes a Supabase client
// already configured with the service-role key (bypasses RLS) and never touches a user's raw
// access/refresh token outside of refreshTokenIfNeeded.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Device-metric equivalent of the 30s manual anti-farming floor (migration 0033) — below this,
// ignore the activity entirely rather than create a trivial lock-in from it.
const MIN_MOVING_TIME_SECONDS = 600; // 10 min
const MIN_DISTANCE_METERS = 1000; // 1 km

// Locked scope (§17b) — only these three Strava activity types ever become a lock-in. Ride maps
// to 'run' (not a dedicated cycling goal type) because this app's goal taxonomy has no separate
// "ride" bucket and isn't getting one just for this — same "keep it lean" call as everywhere else
// in this feature.
const GOAL_TYPE_BY_ACTIVITY_TYPE: Record<string, string> = {
  Run: 'run',
  TrailRun: 'run',
  Ride: 'run',
  VirtualRide: 'run',
  GravelRide: 'run',
  Workout: 'gym',
  WeightTraining: 'gym',
};

export type StravaActivity = {
  id: number;
  type: string;
  name: string;
  moving_time: number;
  distance: number;
  start_date: string;
  // Detail-endpoint-only fields (all optional — a summary payload won't carry them), used by the
  // profile/activity detail screen (§17b's third surface). `device_name` is what the Garmin
  // attribution the brand guidelines require keys off.
  calories?: number | null;
  total_elevation_gain?: number | null;
  device_name?: string | null;
  map?: { summary_polyline?: string | null } | null;
  splits_metric?: StravaSplit[] | null;
};

type StravaSplit = {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  elevation_difference?: number | null;
};

/** Null if this activity is out of scope (wrong type) or under the floor — the caller should
 * just skip it, not treat either case as an error. */
export function qualifyingGoalType(activity: StravaActivity): string | null {
  const goalType = GOAL_TYPE_BY_ACTIVITY_TYPE[activity.type];
  if (!goalType) return null;
  if (activity.moving_time >= MIN_MOVING_TIME_SECONDS || activity.distance >= MIN_DISTANCE_METERS) return goalType;
  return null;
}

type StravaConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

/** Refreshes and persists a new access token if the current one is expired/near-expiry — the
 * one place besides the initial OAuth exchange that ever touches the client secret. */
export async function accessTokenFor(serviceClient: SupabaseClient, connection: StravaConnection): Promise<string> {
  if (new Date(connection.expires_at).getTime() > Date.now() + 60_000) {
    return connection.access_token;
  }
  const refreshRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
    }),
  });
  if (!refreshRes.ok) throw new Error('Could not refresh Strava token.');
  const refreshData = await refreshRes.json();
  await serviceClient
    .from('strava_connections')
    .update({
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: new Date(refreshData.expires_at * 1000).toISOString(),
    })
    .eq('user_id', connection.user_id);
  return refreshData.access_token;
}

export async function fetchActivity(accessToken: string, activityId: number): Promise<StravaActivity> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status}`);
  return res.json();
}

/** Dedup-safe: the (user_id, source, external_id) unique index (migration 0038) means
 * re-processing the same activity — a webhook event and a backfill poll both firing — never
 * creates a second row. Returns the check_in id either way (new or the one that already existed),
 * plus whether THIS call is the one that actually created it (so the caller only auto-posts
 * once, not on every redundant re-process). */
export async function upsertStravaLockIn(
  serviceClient: SupabaseClient,
  userId: string,
  activity: StravaActivity,
  goalType: string
): Promise<{ checkInId: string; created: boolean }> {
  const externalId = String(activity.id);

  const { data: existing } = await serviceClient
    .from('check_ins')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .eq('external_id', externalId)
    .maybeSingle();
  if (existing) return { checkInId: existing.id, created: false };

  // check_ins.xp_earned/streak are computed by the same handle_check_in_insert()/
  // recompute_user_streak() triggers every other check-in already goes through (migration
  // 0033's 60s floor, the daily flame-meter cap in get_or_create_daily_fire) — nothing
  // source-specific to enforce here, a plain insert already inherits all of it.
  const { data: inserted, error } = await serviceClient
    .from('check_ins')
    .insert({
      user_id: userId,
      goal_type: goalType,
      goal_detail: activity.name,
      duration_seconds: activity.moving_time,
      distance_m: activity.distance,
      source: 'strava',
      external_id: externalId,
      status: 'on_time',
      created_at: activity.start_date,
    })
    .select('id')
    .single();

  if (error) {
    // A concurrent insert (webhook + backfill racing) can lose the dedup check above to the
    // unique index itself — that's fine, it means the OTHER call already created it.
    if (error.code === '23505') {
      const { data: raced } = await serviceClient
        .from('check_ins')
        .select('id')
        .eq('user_id', userId)
        .eq('source', 'strava')
        .eq('external_id', externalId)
        .single();
      if (raced) return { checkInId: raced.id, created: false };
    }
    throw error;
  }

  return { checkInId: inserted.id, created: true };
}

/** The route/splits/calories behind the profile-activity-detail screen (§17b, migration 0043).
 * Upserted (not insert-only) so a Strava "update" event for an already-processed activity
 * refreshes it — that's the one thing an update event is actually good for here, since the
 * lock-in itself is already correct. Best-effort by design: the caller treats a failure as
 * non-fatal, because a missing detail row only costs the detail screen its map, while a thrown
 * error would cost the user their lock-in. */
export async function upsertActivityDetail(
  serviceClient: SupabaseClient,
  userId: string,
  checkInId: string,
  activity: StravaActivity
): Promise<void> {
  // Trimmed to the per-km fields the detail screen renders — storing Strava's full split objects
  // would be keeping more of their data than we have any use for (API Policy, §17b).
  const splits = (activity.splits_metric ?? []).map((s) => ({
    split: s.split,
    distance: s.distance,
    moving_time: s.moving_time,
    elevation_difference: s.elevation_difference ?? null,
  }));

  await serviceClient.from('synced_activity_details').upsert(
    {
      check_in_id: checkInId,
      user_id: userId,
      route_polyline: activity.map?.summary_polyline ?? null,
      splits: splits.length > 0 ? splits : null,
      calories: activity.calories ?? null,
      elevation_gain_m: activity.total_elevation_gain ?? null,
      device_name: activity.device_name ?? null,
    },
    { onConflict: 'check_in_id' }
  );
}

/** Auto-post consent is per-user-per-campfire (group_members.auto_post_synced, migration 0038)
 * — never post to a fire that hasn't opted in. A lock-in posts to at most one campfire (same
 * one-circle-per-check-in model post_check_in_to_circle already uses), so this picks the
 * earliest-joined opted-in campfire when more than one qualifies. Direct table writes (not the
 * user-gated post_check_in_to_circle RPC) since this runs as service role with no real user JWT
 * — the same on_check_in_circles_insert_accrue_xp trigger fires either way. */
export async function autoPostIfOptedIn(serviceClient: SupabaseClient, userId: string, checkInId: string): Promise<void> {
  const { data: membership } = await serviceClient
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
    .eq('auto_post_synced', true)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return;

  await serviceClient.from('check_ins').update({ circle_id: membership.group_id }).eq('id', checkInId).is('circle_id', null);
  await serviceClient
    .from('check_in_circles')
    .upsert({ check_in_id: checkInId, circle_id: membership.group_id }, { onConflict: 'check_in_id,circle_id', ignoreDuplicates: true });
}

/** The one entry point both strava-webhook and strava-backfill call per activity — fetch,
 * qualify, dedup-insert, auto-post. Returns null for an out-of-scope/under-floor activity. */
export async function processStravaActivity(
  serviceClient: SupabaseClient,
  connection: StravaConnection,
  activityId: number
): Promise<{ checkInId: string; created: boolean } | null> {
  const accessToken = await accessTokenFor(serviceClient, connection);
  const activity = await fetchActivity(accessToken, activityId);
  const goalType = qualifyingGoalType(activity);
  if (!goalType) return null;

  const result = await upsertStravaLockIn(serviceClient, connection.user_id, activity, goalType);
  // Non-fatal: the lock-in (the thing that actually matters) already exists by here, so a failed
  // detail write must not take the whole activity down with it — worst case the detail screen
  // shows stats without a map until the next update event re-upserts it.
  try {
    await upsertActivityDetail(serviceClient, connection.user_id, result.checkInId, activity);
  } catch (e) {
    console.error('[strava] detail upsert failed:', e instanceof Error ? e.message : e);
  }
  if (result.created) await autoPostIfOptedIn(serviceClient, connection.user_id, result.checkInId);
  return result;
}
