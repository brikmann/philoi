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
  /** The spec's user-set daily reminder. Hour-granular, like quiet hours. */
  reminder_enabled: boolean;
  reminder_hour: number;
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
  // Default off: an unrequested daily push is exactly the kind of thing that trains people to
  // mute the app. 7 PM when switched on — late enough that the day is nearly spent, early
  // enough to still act on it.
  reminder_enabled: false,
  reminder_hour: 19,
};

// ── the five spec categories (NOTIFICATIONS_SPEC, §F) ──
//
// These gate the NEW event pipeline (migration 0086 reads `cat_<category>`), while the six keys
// above still gate the six legacy notify_push callers that predate it.
//
// Two overlapping control sets on one screen would be incoherent — "Campfires: on" next to
// "Messages: off" invites the question of which one wins — so the category toggle is the only
// thing the UI exposes, and flipping it ALSO writes every legacy key it subsumes. One switch,
// both systems, no way for them to disagree.

export type NotificationCategoryKey =
  | 'cat_friends_social'
  | 'cat_challenges'
  | 'cat_campfires'
  | 'cat_streak_reminders'
  | 'cat_season_rank';

/** Legacy keys each category owns, kept in lockstep with it. */
export const CATEGORY_LEGACY_KEYS: Record<NotificationCategoryKey, NotificationPrefKey[]> = {
  cat_friends_social: [],
  cat_challenges: ['challenges'],
  cat_campfires: ['campfire_lockins', 'reactions', 'messages', 'campfire_cold'],
  cat_streak_reminders: ['streak_risk'],
  cat_season_rank: [],
};

export const NOTIFICATION_CATEGORIES: {
  key: NotificationCategoryKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'cat_friends_social',
    label: 'Friends & social',
    description: 'Requests, someone passing you on a board, friends joining',
  },
  { key: 'cat_challenges', label: 'Challenges', description: 'Invites, results and goals at risk' },
  {
    key: 'cat_campfires',
    label: 'Campfires',
    description: 'Joins, campfire challenges, messages and cold campfires',
  },
  {
    key: 'cat_streak_reminders',
    label: 'Streak & reminders',
    // Session recaps map to this category (notification_category(), migration 0120), so this
    // toggle is the only way to mute them — it has to say so, or muting recaps looks impossible.
    description: 'Session recaps, your nightly streak warning and the daily reminder',
  },
  { key: 'cat_season_rank', label: 'Season & rank', description: 'Season results and rewards to collect' },
];

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

/**
 * Flip a category and every legacy key it owns, in one object.
 *
 * Returns the patch rather than writing it, so the caller can merge it into whatever else it is
 * saving and do a single round trip — and so this stays pure and testable.
 */
export function categoryPatch(
  key: NotificationCategoryKey,
  enabled: boolean
): Partial<ResolvedNotificationPrefs> & Record<string, boolean> {
  const patch: Record<string, boolean> = { [key]: enabled };
  for (const legacy of CATEGORY_LEGACY_KEYS[key]) {
    patch[legacy] = enabled;
  }
  return patch;
}

/** Whether a category currently reads as on. Missing = on, matching the server's coalesce — a
 * user who has never touched this screen sees every category enabled, which is what they get. */
export function isCategoryEnabled(
  prefs: Record<string, unknown>,
  key: NotificationCategoryKey
): boolean {
  const v = prefs[key];
  return typeof v === 'boolean' ? v : true;
}

// "22" → "10 PM", "0" → "12 AM", "7" → "7 AM". Hour-granular is enough for a quiet window.
export function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}
