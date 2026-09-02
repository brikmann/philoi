import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { decode } from 'base64-arraybuffer';

import { supabase } from '@/lib/supabase';
import type { Message } from '@/types/database';

export type ChatMessage = Message & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
};

// Blocking is enforced server-side by the "messages: read if member" RLS policy (mutual —
// hides in both directions), not filtered here — a direct API or Realtime call bypassing this
// function would otherwise still see a blocked user's messages. See schema.sql's
// is_blocked_either_way().
export async function fetchMessages(groupId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*, profiles(display_name, avatar_url, handle)')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

/** The campfire photo bucket (migration 0158). Its own, not the Agora's — see that file. */
const PHOTO_BUCKET = 'campfire-photos';

/** Public URL for a stored campfire photo. */
export function campfirePhotoUrl(path: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Upload a photo for a campfire message.
 *
 * The path is prefixed with the uploader's own id because two separate rules require it: the
 * bucket policy rejects a write anywhere else, and messages_attachment_shape rejects a ROW whose
 * attach_path does not start with its own user_id. Same guarantee create_agora_post enforces in
 * its body, moved to the table so the ordinary insert path stays usable.
 */
export async function uploadCampfirePhoto(userId: string, photoUri: string): Promise<string> {
  const path = `${userId}/${Crypto.randomUUID()}.jpg`;
  const base64 = await new File(photoUri).base64();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

/**
 * What a message is carrying besides text (§7a/§7b).
 *
 * `photoUri` is a LOCAL file uri — sendMessage uploads it and stores the resulting path. `lockInId`
 * is a check_ins.id being re-posted into the chat.
 */
export type MessageAttachment =
  | { kind: 'photo'; photoUri: string }
  | { kind: 'lockin'; lockInId: string };

export async function sendMessage(
  groupId: string,
  userId: string,
  body: string,
  attachment?: MessageAttachment
): Promise<void> {
  const trimmed = body.trim();
  // A message with an attachment and no caption is the normal case for "post a photo", so the
  // empty-body bail only applies when there is genuinely nothing to send.
  if (!trimmed && !attachment) return;

  let attachKind: string | null = null;
  let attachPath: string | null = null;
  let attachRefId: string | null = null;

  if (attachment?.kind === 'photo') {
    attachKind = 'photo';
    attachPath = await uploadCampfirePhoto(userId, attachment.photoUri);
  } else if (attachment?.kind === 'lockin') {
    attachKind = 'lockin';
    attachRefId = attachment.lockInId;
  }

  const { error } = await supabase.from('messages').insert({
    group_id: groupId,
    user_id: userId,
    body: trimmed || null,
    attach_kind: attachKind,
    attach_path: attachPath,
    attach_ref_id: attachRefId,
  });
  if (error) {
    // The upload succeeded and the message did not — same cleanup createAgoraPost does, so a
    // rejected send doesn't leave an orphan in the bucket that nothing will ever reference.
    if (attachPath) await supabase.storage.from(PHOTO_BUCKET).remove([attachPath]);
    throw error;
  }
}

export async function deleteMyMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_my_message', { p_message_id: messageId });
  if (error) throw error;
}

// Realtime — new messages appear live instead of requiring a manual refresh. Returns an
// unsubscribe function; caller is responsible for calling it on unmount.
export function subscribeToMessages(groupId: string, onInsert: () => void): () => void {
  const channel = supabase
    .channel(`messages:${groupId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
      onInsert
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
