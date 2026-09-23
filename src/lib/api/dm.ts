import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { DmMessage } from '@/types/database';

/**
 * 1:1 direct messages (migration 0206, MESSAGING_DM_SPEC.md).
 *
 * The campfire twin of this file is `messages.ts`, and the shape is deliberately the same —
 * fetch / send / subscribe — with one difference that runs through everything here: a campfire
 * message is keyed on a group_id the caller already has, and a DM is keyed on a THREAD the caller
 * has to ask the server to resolve first. `openDmThread()` is that resolve step, and the thread id
 * it returns is what both the query and the realtime filter hang off.
 *
 * Blocking and friends-only are NOT enforced here. Reads are filtered by the
 * "dm_messages: read if member" policy (which also governs the realtime subscription, since
 * postgres_changes re-evaluates SELECT per subscriber) and writes are refused by dm_send itself.
 * A patched client calling the REST endpoint directly hits exactly the same two rules.
 */

export type DmThreadMessage = DmMessage & {
  profiles: { display_name: string; avatar_url: string | null; handle: string | null };
};

/** One row of the inbox — the friend, the last thing said, and how much of it is unread. */
export type DmThreadSummary = {
  threadId: string;
  friendId: string;
  displayName: string;
  avatarUrl: string | null;
  handle: string | null;
  lastMessageAt: string;
  lastBody: string | null;
  /** Null when nobody has spoken yet; otherwise whether the last word was yours. */
  lastSenderId: string | null;
  unread: number;
};

/**
 * Resolve (creating if needed) the thread with one friend.
 *
 * Idempotent server-side, so the screen may call it on every mount. It throws for a non-friend, a
 * blocked pair, or yourself — those are the guardrails, not error states to paper over, so the
 * caller shows the message rather than an empty thread.
 */
export async function openDmThread(friendId: string): Promise<string> {
  const { data, error } = await supabase.rpc('dm_open_thread', { p_friend_id: friendId });
  if (error) throw error;
  return data as string;
}

/**
 * Every message in a thread, oldest first.
 *
 * `profiles!dm_messages_sender_id_fkey`, not a bare `profiles(...)`: the campfire feed went blank
 * once because `messages` had picked up a second relationship to `profiles` and an un-hinted embed
 * fails the WHOLE select rather than degrading. dm_messages has only the author FK today, so the
 * hint is not yet load-bearing — it is here so that adding a (message_id, user_id) reactions
 * junction later cannot silently empty this screen the way it emptied that one.
 */
export async function fetchDmMessages(threadId: string): Promise<DmThreadMessage[]> {
  const { data, error } = await supabase
    .from('dm_messages')
    .select('*, profiles!dm_messages_sender_id_fkey(display_name, avatar_url, handle)')
    .eq('thread_id', threadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as DmThreadMessage[];
}

/** Send one message. Returns the new row's id so a caller can reconcile an optimistic bubble. */
export async function sendDm(threadId: string, body: string): Promise<string | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase.rpc('dm_send', { p_thread_id: threadId, p_body: trimmed });
  if (error) throw error;
  track('dm_sent', { thread_id: threadId });
  return (data as string | null) ?? null;
}

/**
 * Mark my side of the thread read, up to now.
 *
 * Also what re-arms the other side's notification: dm_send rings the bell only when there is no
 * unread `dm_received` row for the thread already waiting, so until this is called a whole
 * conversation is one banner. Fire it on open AND on each new message received while the screen is
 * foreground — an unread badge that survives you reading the message is the more annoying bug.
 */
export async function markDmRead(threadId: string): Promise<void> {
  const { error } = await supabase.rpc('dm_mark_read', { p_thread_id: threadId });
  if (error) throw error;
}

/** Soft-delete one of my own messages. Somebody else's is a report, not a delete. */
export async function deleteMyDm(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('dm_delete_my_message', { p_message_id: messageId });
  if (error) throw error;
}

/** The inbox: every thread with at least one message, newest first. */
export async function fetchMyDmThreads(): Promise<DmThreadSummary[]> {
  const { data, error } = await supabase.rpc('get_my_dm_threads');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    threadId: r.out_thread_id,
    friendId: r.out_friend_id,
    displayName: r.out_display_name,
    avatarUrl: r.out_avatar_url,
    handle: r.out_handle,
    lastMessageAt: r.out_last_message_at,
    lastBody: r.out_last_body,
    lastSenderId: r.out_last_sender_id,
    unread: r.out_unread,
  }));
}

/**
 * Realtime — new messages appear live instead of requiring a refresh. Returns an unsubscribe
 * function; the caller must call it on unmount.
 *
 * Filtered on thread_id, which is why openDmThread has to resolve first: there is no "my DMs"
 * filter expressible here, and subscribing to the whole table would lean entirely on RLS to do
 * the fan-out. Mirrors subscribeToMessages' contract exactly — an INSERT fires the callback, and
 * the callback refetches, rather than the payload being trusted to carry the joined author.
 */
export function subscribeToDmThread(threadId: string, onInsert: () => void): () => void {
  const channel = supabase
    .channel(`dm:${threadId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `thread_id=eq.${threadId}` },
      onInsert
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
