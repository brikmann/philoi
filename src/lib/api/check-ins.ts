import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInStatus, Reaction } from '@/types/database';

export type FeedCheckIn = CheckIn & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
  reactions: Reaction[];
  signedPhotoUrl: string | null;
};

const PHOTO_BUCKET = 'check-in-photos';

export async function fetchFeed(groupId: string): Promise<FeedCheckIn[]> {
  const { data: session } = await supabase.auth.getSession();
  const viewerId = session.session?.user.id;

  const { data: blocked } = viewerId
    ? await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', viewerId)
    : { data: null };
  const blockedIds = (blocked ?? []).map((b) => b.blocked_id);

  let query = supabase
    .from('check_ins')
    .select('*, profiles(display_name, avatar_url, handle), reactions(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (blockedIds.length > 0) {
    query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as FeedCheckIn[];
  if (rows.length === 0) return rows;

  const { data: signed } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(rows.map((r) => r.photo_url), 60 * 60);

  const urlByPath = new Map(signed?.map((s) => [s.path, s.signedUrl]));
  return rows.map((row) => ({ ...row, signedPhotoUrl: urlByPath.get(row.photo_url) ?? null }));
}

function inferCadenceStatus(): CheckInStatus {
  // v1 heuristic: anything posted is "on_time" — per-cadence lateness windows
  // (e.g. "missed the gym slot you set") are a Pro/advanced-stats feature to layer in later.
  return 'on_time';
}

export async function postCheckIn(input: {
  groupId: string;
  userId: string;
  photoUri: string;
  caption: string;
}): Promise<CheckIn> {
  const checkInId = Crypto.randomUUID();
  const path = `${input.groupId}/${input.userId}/${checkInId}.jpg`;

  const base64 = await new File(input.photoUri).base64();

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('check_ins')
    .insert({
      id: checkInId,
      group_id: input.groupId,
      user_id: input.userId,
      photo_url: path,
      caption: input.caption || null,
      status: inferCadenceStatus(),
    })
    .select('*')
    .single();
  if (error) throw error;
  track('check_in_completed', { group_id: input.groupId, photo: true });
  return data;
}
