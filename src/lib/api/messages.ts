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
