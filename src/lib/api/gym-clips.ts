import { supabase } from '@/lib/supabase';
import type { WorkoutSet } from '@/types/database';

// Gym tracker phase-2 — per-set video clips (PHILOI_UI_SPEC.md §23). Bytes live in R2; these
// wrap the two Edge Functions (signed upload/playback URLs) plus the three Postgres RPCs
// (quota read, attach, remove) that hold the references.

export type GymClipQuota = {
  tier: 'free' | 'paid';
  used_this_month: number;
  clip_limit: number | null;
  remaining: number | null;
};

export async function fetchGymClipQuota(): Promise<GymClipQuota> {
  const { data, error } = await supabase.rpc('get_gym_clip_quota');
  if (error) throw error;
  return data[0];
}

export type ClipUploadUrls = {
  videoKey: string;
  thumbKey: string;
  videoUploadUrl: string;
  thumbUploadUrl: string;
  quota: GymClipQuota;
};

// Ownership + quota are checked server-side in the Edge Function itself — a free user already
// at their cap gets a 403 here rather than wasting a presign.
export async function requestClipUploadUrls(workoutSetId: string): Promise<ClipUploadUrls> {
  const { data, error } = await supabase.functions.invoke('gym-clip-upload-url', { body: { workoutSetId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

// PUTs a local file straight to R2 via the signed URL — never through the app server.
export async function uploadClipAsset(uploadUrl: string, uri: string, contentType: string): Promise<void> {
  const blob = await (await fetch(uri)).blob();
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
}

// The only writer of workout_sets' video columns — called once both PUTs above have succeeded.
export async function attachWorkoutSetClip(input: {
  workoutSetId: string;
  videoKey: string;
  thumbKey: string;
  durationS: number;
  resolution: string;
}): Promise<WorkoutSet> {
  const { data, error } = await supabase.rpc('attach_workout_set_clip', {
    p_workout_set_id: input.workoutSetId,
    p_video_key: input.videoKey,
    p_thumb_key: input.thumbKey,
    p_duration_s: input.durationS,
    p_resolution: input.resolution,
  });
  if (error) throw error;
  return data;
}

export async function removeWorkoutSetClip(workoutSetId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_workout_set_clip', { p_workout_set_id: workoutSetId });
  if (error) throw error;
}

// Every clipped set from a finished workout, keyed by check_in_id — the done-screen recap only
// has per-exercise rollups (no individual set ids), so clips need their own lookup.
export async function fetchCheckInClips(checkInId: string): Promise<WorkoutSet[]> {
  const { data, error } = await supabase.rpc('get_check_in_clips', { p_check_in_id: checkInId });
  if (error) throw error;
  return data ?? [];
}

export type ClipPlaybackUrls = {
  videoUrl: string;
  thumbUrl: string | null;
  durationS: number | null;
  resolution: string | null;
};

// Access (owner / circle-mate / friend) is re-checked server-side in the Edge Function —
// never trust a client-held key alone.
export async function requestClipPlaybackUrls(workoutSetId: string): Promise<ClipPlaybackUrls> {
  const { data, error } = await supabase.functions.invoke('gym-clip-playback-url', { body: { workoutSetId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
