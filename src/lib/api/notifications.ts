import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { NotificationEvent } from '@/types/database';

// The bell feed's read paths (§F1, migration 0086).
//
// Writes deliberately have no client entry point: notify_event is security definer with no grant
// to `authenticated`, so a notification can only ever be created by server-side code reacting to a
// real event. A client that could write its own feed rows could also write someone else's.

export async function fetchMyNotifications(limit = 50): Promise<NotificationEvent[]> {
  const { data, error } = await supabase.rpc('get_my_notifications', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_notification_count');
  if (error) throw error;
  return data ?? 0;
}

/** Marks the whole feed read — what opening the bell does. Returns how many rows changed, so a
 * caller can skip a refetch when nothing did. */
export async function markNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_notifications_read');
  if (error) throw error;
  const n = data ?? 0;
  if (n > 0) track('notifications_read', { count: n });
  return n;
}
