import { supabase } from '@/lib/supabase';
import type { Message } from '@/types/database';

export type ChatMessage = Message & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
};

export async function fetchMessages(groupId: string): Promise<ChatMessage[]> {
  const { data: session } = await supabase.auth.getSession();
  const viewerId = session.session?.user.id;

  const { data: blocked } = viewerId
    ? await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', viewerId)
    : { data: null };
  const blockedIds = (blocked ?? []).map((b) => b.blocked_id);

  let query = supabase
    .from('messages')
    .select('*, profiles(display_name, avatar_url, handle)')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (blockedIds.length > 0) {
    query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

export async function sendMessage(groupId: string, userId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('messages').insert({ group_id: groupId, user_id: userId, body: trimmed });
  if (error) throw error;
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
