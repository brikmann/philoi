import { decode } from 'base64-arraybuffer';
import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';
import type { PhotoVisibility, Profile, RankTierName } from '@/types/database';

const AVATAR_BUCKET = 'avatars';

function normalizeHandle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export async function setMyPhotoVisibility(visibility: PhotoVisibility): Promise<void> {
  const { error } = await supabase.rpc('set_my_photo_visibility', { p_visibility: visibility });
  if (error) throw error;
}

export async function fetchMyLockInStats(): Promise<{ lockin_count: number; total_seconds: number }> {
  const { data, error } = await supabase.rpc('get_my_lockin_stats');
  if (error) throw error;
  return data[0];
}

// For viewing someone else's profile (design-mocks/15) — stats aren't privacy-gated, same
// as leaderboards already exposing XP/streak for everyone.
export async function fetchUserLockInStats(userId: string): Promise<{ lockin_count: number; total_seconds: number }> {
  const { data, error } = await supabase.rpc('get_user_lockin_stats', { p_user_id: userId });
  if (error) throw error;
  return data[0];
}

/**
 * Someone else's overall rank — or the fact that you are not allowed to see it.
 *
 * PRIVATE MODE (migration 0170) makes this a two-state answer. A user in Private mode is visible
 * only to their friends; to anyone else, every competitive figure below is null and `muted` is
 * true, and the profile renders "Rank muted" rather than a number.
 *
 * 🔴 `muted` IS NOT THE SAME AS `null` FROM fetchUserRank. Null means "no rank row came back at
 * all"; muted means "there is a rank and you may not see it". Rendering a muted user as a blank
 * hexagon would read as a bug in the app rather than as a boundary the other person set, which is
 * exactly why the RPC returns a row instead of an empty set. Branch on `muted` before reading any
 * other field — the rest are nullable precisely so a muted rank cannot be misread as a score of 0.
 */
// A DISCRIMINATED UNION rather than six nullable fields, so `if (rank.muted)` narrows and every
// caller is forced by the compiler to render the muted state before it can touch a figure. Six
// independently-nullable numbers would let a screen render `??  0` and quietly show a private user
// as Bronze I with 0 XP — a spoofed rank, which is the one outcome §2 rules out.
export type UserRank =
  | {
      muted: true;
      score: null;
      tier: null;
      division: null;
      xp_into_tier: null;
      xp_for_next_tier: null;
    }
  | {
      muted: false;
      score: number;
      tier: RankTierName;
      division: number;
      xp_into_tier: number;
      xp_for_next_tier: number;
    };

// The profile screen's single overall rank hexagon for someone else — mirrors useMyRanks()'s
// universal scope, which is what's shown on your own profile.
export async function fetchUserRank(userId: string): Promise<UserRank | null> {
  const { data, error } = await supabase.rpc('get_user_rank', { p_user_id: userId });
  if (error) throw error;
  const row = data[0];
  if (!row) return null;

  // FORWARD-COMPATIBLE BY OMISSION. A build that ships before migration 0170 reaches prod talks to
  // a get_user_rank with no `muted` column at all, and `undefined` is falsy — so it takes the
  // visible branch and behaves exactly as it does today. That matters more than usual here:
  // runtimeVersion is still sdkVersion-pinned, so OTA cannot reach older installs, and the client
  // and the migration will not land on every device on the same day.
  if (row.muted) {
    return { muted: true, score: null, tier: null, division: null, xp_into_tier: null, xp_for_next_tier: null };
  }
  return {
    muted: false,
    // Non-null by construction: the RPC fills every figure on the not-muted branch, and nulls them
    // together with muted = true on the other. The union above is what keeps the two in step.
    score: row.score!,
    tier: row.tier!,
    division: row.division!,
    xp_into_tier: row.xp_into_tier!,
    xp_for_next_tier: row.xp_for_next_tier!,
  };
}

// Any profile is readable ("profiles: read any" RLS) — used when viewing someone else's
// profile screen (own profile reads straight from useAuth() instead).
export async function fetchProfileById(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function fetchMyStreak(userId: string): Promise<{ current_streak: number; longest_streak: number }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('current_streak, longest_streak')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  userId: string,
  input: { handle: string; university: string }
): Promise<void> {
  const normalizedHandle = normalizeHandle(input.handle);
  if (normalizedHandle.length < 3) {
    throw new Error('Handles need at least 3 characters — letters, numbers, or _.');
  }

  const { error } = await supabase
    .from('profiles')
    .update({ handle: normalizedHandle, university: input.university.trim() || null })
    .eq('id', userId);

  if (error) {
    throw new Error(error.code === '23505' ? 'That handle is taken — try another.' : error.message);
  }
}

// Path is always {userId}.jpg (see the "avatars: write own" / "update own" RLS policies in
// schema.sql) — upsert:true means re-uploading just overwrites, no old-avatar cleanup needed.
export async function uploadAvatar(userId: string, photoUri: string): Promise<string> {
  const path = `${userId}.jpg`;
  const base64 = await new File(photoUri).base64();

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);

  // Cache-bust — the filename never changes on re-upload, so without this the app/CDN would
  // keep showing the old cached image after a user updates their avatar.
  const bustedUrl = `${publicUrl}?t=${Date.now()}`;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: bustedUrl })
    .eq('id', userId);
  if (profileError) throw profileError;

  return bustedUrl;
}
