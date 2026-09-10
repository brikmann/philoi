import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { PingResult } from '@/types/database';

/**
 * A silent nudge to one campfire member (mock 101 frame 2 · "Ping a member · silent nudge").
 *
 * Posts NOTHING into the chat — this is a push and a bell row and nothing else. That is what
 * separates it from an @mention, which is a visible message that happens to notify someone.
 *
 * Its own RPC rather than a direct notify_event call, for two reasons that are both about the
 * function being security definer:
 *
 *   · notify_event is not granted to `authenticated` (checked: only postgres and service_role
 *     hold EXECUTE). It is the internal notifier and it takes an arbitrary user-id array, so
 *     exposing it to clients would let any account push arbitrary copy to any other account.
 *   · The membership check and the rate limit have to live somewhere the client cannot skip.
 *     Both are inside the RPC — you can only nudge someone you actually share the campfire with,
 *     and only so often. See migration 0152.
 */
export async function pingCampfireMember(
  groupId: string,
  userId: string,
  /**
   * D5 · the sender's own line, or nothing. Carries into BOTH the push body and the in-app bell
   * row — they are one notification_events row, so there is no way for the two to disagree.
   * Trimming, the 140-cap and the fall back to the generic line all happen SERVER-side (0181):
   * this string ends up on someone else's lock screen, so the client is the one place that cannot
   * be the one enforcing it.
   */
  message?: string
): Promise<PingResult> {
  const note = message?.trim();
  const { data, error } = await supabase.rpc('ping_campfire_member', {
    p_group_id: groupId,
    p_user_id: userId,
    // Omitted entirely when empty rather than sent as null, so this call still resolves against a
    // pre-0181 database — where the function has two parameters and an unknown third would make
    // the request fail outright rather than fall back.
    ...(note ? { p_message: note } : {}),
  });
  if (error) throw error;

  // 0172 · the RPC used to return void, so "no exception" was the only signal available and the
  // sheet read it as "delivered". It was not: the ten-minute rate limit returned silently, and a
  // recipient with no registered device was indistinguishable from a delivered push. A build
  // talking to a pre-0172 database gets undefined here, which falls back to 'sent' — the same
  // (optimistic) behaviour it has today, rather than a crash.
  const result = (data as PingResult | null) ?? 'sent';
  track('campfire_member_pinged', { group_id: groupId, result, custom: Boolean(note) });
  return result;
}
