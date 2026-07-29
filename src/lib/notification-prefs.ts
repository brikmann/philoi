import { supabase } from '@/lib/supabase';
import type { NotificationPrefs } from '@/types/database';

// The Settings → Notifications sub-screen (PHILOI_UI_SPEC.md §19). Each category maps 1:1 to a
// notification `type` handled server-side in notify_push() — muting a category here filters the
// matching pushes out of the fan-out. Everything defaults ON; a brand-new user has an empty
// '{}' prefs blob and receives everything until they change something.
//
// Quiet hours are enforced against the recipient's LOCAL time, so every save stows the device's
// IANA timezone alongside the window (see setMyNotificationPrefs). The window may wrap midnight.

export type NotificationPrefKey =
  | 'campfire_lockins'
  | 'reactions'
  | 'messages'
  | 'campfire_cold'
  | 'streak_risk'
  | 'challenges';

// Concrete shape the UI renders from — every field resolved to a real value.
export type ResolvedNotificationPrefs = {
  master: boolean;
  campfire_lockins: boolean;
  reactions: boolean;
  messages: boolean;
  campfire_cold: boolean;
  streak_risk: boolean;
  challenges: boolean;
  quiet_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
};

export const DEFAULT_NOTIFICATION_PREFS: ResolvedNotificationPrefs = {
  master: true,
  campfire_lockins: true,
  reactions: true,
  messages: true,
  campfire_cold: true,
  streak_risk: true,
  challenges: true,
  quiet_enabled: false,
  quiet_start: 22, // 10 PM
  quiet_end: 7, // 7 AM
};

export type NotificationPrefGroup = {
  title: string;
  items: { key: NotificationPrefKey; label: string; description: string }[];
};

// Grouped exactly as §19 lays them out: "Your campfires" (group activity) then "You" (personal).
export const NOTIFICATION_PREF_GROUPS: NotificationPrefGroup[] = [
  {
    title: 'Your campfires',
    items: [
      { key: 'campfire_lockins', label: 'Someone locks in', description: 'A campfire member starts a lock-in' },
      { key: 'reactions', label: 'Reactions', description: 'Someone reacts to your lock-in' },
      { key: 'messages', label: 'Messages', description: 'New messages in your campfires' },
      { key: 'campfire_cold', label: 'Campfire going cold', description: 'A quiet campfire needs a spark' },
    ],
  },
  {
    title: 'You',
    items: [
      { key: 'streak_risk', label: 'Streak about to lapse', description: 'A nightly nudge before your streak breaks' },
      { key: 'challenges', label: 'Challenges', description: 'Invites and results' },
    ],
  },
];

// Fill any missing keys with the on-by-default value so the UI always renders concrete values.
export function resolveNotificationPrefs(prefs: NotificationPrefs | null | undefined): ResolvedNotificationPrefs {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(prefs ?? {}),
    // Coalesce nullable numeric fields explicitly — a null from the DB would otherwise override
    // the default with null.
    quiet_start: prefs?.quiet_start ?? DEFAULT_NOTIFICATION_PREFS.quiet_start,
    quiet_end: prefs?.quiet_end ?? DEFAULT_NOTIFICATION_PREFS.quiet_end,
  };
}

// IANA zone from the JS engine (Hermes ships full ICU in SDK 56). Falls back to 'UTC' if the
// runtime can't resolve one — the server treats a missing/empty zone as UTC too.
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Persist the whole blob, always tagging the current device timezone so quiet hours resolve to
// the user's local time server-side.
export async function setMyNotificationPrefs(prefs: ResolvedNotificationPrefs): Promise<void> {
  const payload: NotificationPrefs = { ...prefs, timezone: getDeviceTimeZone() };
  const { error } = await supabase.rpc('set_my_notification_prefs', { p_prefs: payload });
  if (error) throw error;
}

// "22" → "10 PM", "0" → "12 AM", "7" → "7 AM". Hour-granular is enough for a quiet window.
export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}
