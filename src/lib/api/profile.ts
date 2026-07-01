import { decode } from 'base64-arraybuffer';
import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

const AVATAR_BUCKET = 'avatars';

function normalizeHandle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
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
