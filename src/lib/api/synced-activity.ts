import { supabase } from '@/lib/supabase';
import type { CheckIn, SyncedActivitySplit } from '@/types/database';

const PHOTO_BUCKET = 'check-in-photos';

/** Everything the profile/activity detail screen (§17b, design-mocks/40 frame 3) renders for one
 * synced lock-in: the lock-in itself, the Strava-derived route/splits/calories (migration 0043),
 * and the IN-APP lock-in photos. The photos deliberately come from check_in_photos, not Strava —
 * current scope is `activity:read` (stats + route, NOT Strava's own photos), see §17b's photos
 * scope note. */
export type SyncedActivityDetail = {
  checkIn: CheckIn;
  routePolyline: string | null;
  splits: SyncedActivitySplit[];
  calories: number | null;
  elevationGainM: number | null;
  deviceName: string | null;
  signedPhotoUrls: string[];
};

export async function fetchSyncedActivityDetail(checkInId: string): Promise<SyncedActivityDetail | null> {
  const { data: checkIn, error } = await supabase.from('check_ins').select('*').eq('id', checkInId).maybeSingle();
  if (error) throw error;
  if (!checkIn) return null;

  // The detail row is owner-only by RLS (migration 0043) and best-effort at write time, so a
  // missing one is normal — the screen still has the lock-in's own distance/duration to show.
  const [{ data: detail }, { data: photoRows }] = await Promise.all([
    supabase
      .from('synced_activity_details')
      .select('route_polyline, splits, calories, elevation_gain_m, device_name')
      .eq('check_in_id', checkInId)
      .maybeSingle(),
    supabase.from('check_in_photos').select('photo_url').eq('check_in_id', checkInId).order('position'),
  ]);

  // Same legacy fallback the feed uses: check_ins.photo_url predates the check_in_photos gallery.
  const paths = [...new Set([...(photoRows ?? []).map((p) => p.photo_url), ...(checkIn.photo_url ? [checkIn.photo_url] : [])])];
  const { data: signed } =
    paths.length > 0 ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60) : { data: null };

  return {
    checkIn: checkIn as CheckIn,
    routePolyline: detail?.route_polyline ?? null,
    splits: (detail?.splits as SyncedActivitySplit[] | null) ?? [],
    calories: detail?.calories ?? null,
    elevationGainM: detail?.elevation_gain_m ?? null,
    deviceName: detail?.device_name ?? null,
    signedPhotoUrls: (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u)),
  };
}
