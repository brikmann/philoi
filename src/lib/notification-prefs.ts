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
// The category is the master switch, and flipping it ALSO writes every legacy key it subsumes
// (see categoryPatch) — so the two systems can never disagree. The legacy keys are still
// reachable, but only NESTED underneath their category (see CATEGORY_SUBTYPES), never as a
// second flat list beside it: side by side, "Campfires: on" next to "Messages: off" gives no way
// to tell which wins, whereas inside-the-category it plainly reads as detail under a master.

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
  /**
   * Events this category routes (notification_category, migration 0086) that have NO individual
   * switch of their own — so the disclosure spells them out rather than implying the switches
   * below are the whole list. Deliberately complementary to CATEGORY_SUBTYPES, never a repeat
   * of it.
   */
  covers: string[];
}[] = [
  {
    key: 'cat_friends_social',
    label: 'Friends & social',
    description: 'Requests, someone passing you on a board, friends joining',
    covers: ['Friend requests and accepts', 'A friend passing you on a board', 'Friends joining Philoi'],
  },
  {
    key: 'cat_challenges',
    label: 'Challenges',
    description: 'Invites, results and goals at risk',
    covers: ['Accepts, declines and challenges ending soon', 'A goal about to slip'],
  },
  {
    key: 'cat_campfires',
    label: 'Campfires',
    description: 'Joins, campfire challenges, messages and cold campfires',
    covers: ['Joins and join requests', 'Campfire challenges starting and settling'],
  },
  {
    key: 'cat_streak_reminders',
    label: 'Streak & reminders',
    description: 'Your nightly streak warning and daily reminder',
    covers: ['The daily reminder you set below', 'Streak milestones'],
  },
  {
    key: 'cat_season_rank',
    label: 'Season & rank',
    description: 'Season results and rewards to collect',
    covers: ['Season ending and season results', 'Rank-ups', 'Rewards waiting to be collected'],
  },
];

export type NotificationPrefItem = {
  key: NotificationPrefKey;
  label: string;
  description: string;
};

// Copy for the six legacy per-type keys, kept in one map so a label lives in exactly one place.
const PREF_ITEM_COPY: Record<NotificationPrefKey, { label: string; description: string }> = {
  campfire_lockins: { label: 'Someone locks in', description: 'A campfire member starts a session' },
  reactions: { label: 'Reactions', description: 'Someone reacts to your lock-in' },
  messages: { label: 'Messages and mentions', description: 'New messages in your campfires' },
  campfire_cold: { label: 'Campfire going cold', description: 'A quiet campfire needs a spark' },
  streak_risk: { label: 'Streak about to lapse', description: 'A nightly nudge before your streak breaks' },
  challenges: { label: 'Invites and results', description: 'Someone challenges you, or a challenge settles' },
};

/**
 * The per-type toggles that sit UNDER each category, derived from CATEGORY_LEGACY_KEYS so the two
 * can never drift.
 *
 * Why nested rather than a second flat list: the earlier version of this screen had exactly one
 * switch per subject, because two control sets side by side invites "Campfires: on" next to
 * "Messages: off" and no way to tell which wins. A nested disclosure answers that — the category
 * is the master, the types inside it are the detail, and flipping the category takes its types
 * with it (see categoryPatch).
 *
 * Only these six are listed because only these six are actually ENFORCED per type: notify_push
 * (migration 0027) maps its legacy push types onto them. The new event pipeline (0086) gates on
 * `cat_<category>` alone, so friends/social and season/rank have no per-type gate to expose and
 * deliberately show none — a switch that changes nothing is worse than no switch.
 */
export const CATEGORY_SUBTYPES: Record<NotificationCategoryKey, NotificationPrefItem[]> =
  Object.fromEntries(
    (Object.keys(CATEGORY_LEGACY_KEYS) as NotificationCategoryKey[]).map((category) => [
      category,
      CATEGORY_LEGACY_KEYS[category].map((key) => ({ key, ...PREF_ITEM_COPY[key] })),
    ])
  ) as Record<NotificationCategoryKey, NotificationPrefItem[]>;

/** Whether a legacy per-type key currently reads as on. Missing = on, matching the server's
 * coalesce in notify_push. */
export function isPrefKeyEnabled(prefs: Record<string, unknown>, key: NotificationPrefKey): boolean {
  const v = prefs[key];
  return typeof v === 'boolean' ? v : true;
}

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
 *
 * Turning a category ON REMOVES its key rather than writing `true`. That looks pedantic and
 * isn't: notify_event gates on `coalesce((prefs->>'cat_x')::boolean, notification_push_default(type))`,
 * so an explicit `true` overrides the per-type defaults and starts pushing the types the spec
 * deliberately keeps bell-only — campfire messages, friends locking in, rank drops. Absent means
 * "use the defaults", which is exactly what "on" should mean here. `set_my_notification_prefs`
 * replaces the whole blob, and JSON drops undefined, so an undefined value deletes the key.
 */
export function categoryPatch(
  key: NotificationCategoryKey,
  enabled: boolean
): Partial<ResolvedNotificationPrefs> & Record<string, boolean | undefined> {
  const patch: Record<string, boolean | undefined> = { [key]: enabled ? undefined : false };
  for (const legacy of CATEGORY_LEGACY_KEYS[key]) {
    // The legacy keys are safe to write explicitly — notify_push coalesces a missing one to true,
    // so `true` and absent mean the same thing there.
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
