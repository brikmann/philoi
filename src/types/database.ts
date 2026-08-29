// social_media stays for historical rows' typing — the lock-in goal picker (PHILOI_UI_SPEC.md
// §12) doesn't offer it, only gym/run/study/job_applications/read/custom.
export type GoalType = 'gym' | 'run' | 'study' | 'social_media' | 'custom' | 'job_applications' | 'read';
// Campfire membership roles (migration 0094, CAMPFIRE_REDESIGN_SPEC.md §Phase 2). 'admin' is
// the CAPABILITY tier and 'owner' is a subset of it — every "may this person manage the campfire?"
// question is `role !== 'member'` (or is_campfire_admin() server-side), never `=== 'owner'`. The
// one thing still reserved to the owner alone is DELETE, plus handing out the role itself.
export type MemberRole = 'owner' | 'admin' | 'member';
export type CheckInStatus = 'on_time' | 'late';
// The 10-tier ladder (RANK_REWORK_SPEC.md, migration 0063, design-mocks/77): the mortal climb
// bronze→diamond, then the realm of legend hero→immortal, all with I/II/III divisions — topped
// by `primordial`, the singular apex with no divisions ("the first flame, older than the gods").
// Renamed twice on the way here: "legend" (migration 0030) then the fire-themed apex, now this.
//
// These strings come straight out of rank_thresholds.tier, which is plain text rather than an
// enum — so this union is the ONLY place the set is pinned down. Every Record<RankTierName, …>
// map is what makes TypeScript catch a tier nobody handled.
export type RankTierName =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'hero'
  | 'titan'
  | 'olympian'
  | 'immortal'
  | 'primordial';

// "Who can see my photos" (§19): Everyone · My campfires (default) · Just me (private journal).
export type PhotoVisibility = 'everyone' | 'campfires' | 'private';

// Per-category push notification toggles (§19). Partial on the wire — a missing key means
// "on" (see notify_push()'s coalesce). The client fills defaults via DEFAULT_NOTIFICATION_PREFS.
export type NotificationPrefs = {
  master?: boolean;
  campfire_lockins?: boolean;
  reactions?: boolean;
  messages?: boolean;
  campfire_cold?: boolean;
  streak_risk?: boolean;
  challenges?: boolean;
  /** Optional overnight quiet window (§19), enforced server-side in the recipient's timezone. */
  quiet_enabled?: boolean;
  quiet_start?: number; // 0–23, local hour
  quiet_end?: number; // 0–23, local hour (may be < start to wrap past midnight)
  /** IANA zone (e.g. 'America/Toronto') the client stows so quiet hours resolve to local time. */
  timezone?: string;

  // ── Agent 6 · Settings (additive) ──────────────────────────────────────────────
  // Keys the client has been writing into this blob since migration 0086 but that were never
  // typed here, so every reader had to cast through Record<string, unknown>. Same blob, same
  // column — just declared.
  /** The five spec categories gating the 0086 event pipeline (`cat_<category>`). */
  cat_friends_social?: boolean;
  cat_challenges?: boolean;
  cat_campfires?: boolean;
  cat_streak_reminders?: boolean;
  cat_season_rank?: boolean;
  /** The user-set daily reminder, hour-granular like quiet hours. */
  reminder_enabled?: boolean;
  reminder_hour?: number;
  // ── end Agent 6 block ─────────────────────────────────────────────────────────
};

export type Profile = {
  id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  /** IANA zone written by the client (migration 0084). Null = the daily goal rollover falls back
   * to UTC for this user, which is the pre-0084 behaviour rather than a failure. */
  timezone: string | null;
  /** One-line self-description under the identity block (§3). Owner-editable, publicly visible. */
  bio: string | null;
  university: string | null;
  /** Email domain for the chosen school (migration 0062) — from the shipped top-20 cache or
   * Hipolabs. Null means the school has no known domain, so it can't be verified; that never
   * blocks onboarding, it only leaves the two campus boards locked. */
  university_domain: string | null;
  /** The verified campus address. Verification-only — the user still signs in with Google/Apple,
   * and this is never an auth identity (see supabase/functions/send_uni_code). */
  university_email: string | null;
  /** Gates the My Uni + Vs Unis leaderboards, client-side AND in the RPCs themselves. Reset by
   * the profiles_reset_uni_verification trigger when someone changes school. */
  university_email_verified: boolean;
  /** Has an active paid Philoi membership. Unused for gating during free early access — see use-entitlement.ts. */
  is_pro: boolean;
  pro_until: string | null;
  /** 18+ attestation + ToS/Privacy consent. Null or false = must complete setup-age-consent screen. */
  has_consented: boolean;
  consented_at: string | null;
  consent_version: string | null;
  /** Whether chat push notifications show the message body on the lock screen. Off by default. */
  show_message_previews: boolean;
  /** Fake account created by scripts/seed-demo-circles.js — used by the dev-tools RPCs, never a real user. */
  is_demo: boolean;
  /** Set by admin_disable_account() after a confirmed moderation action (e.g. CSAE). Routes to account-disabled.tsx. */
  is_disabled: boolean;
  disabled_at: string | null;
  /** "Locked in at all that day" — per-user now (PHILOI_UI_SPEC.md §12), not per-goal. See recompute_user_streak() in schema.sql. */
  current_streak: number;
  longest_streak: number;
  /** Gates lock-in photo visibility beyond this user's own campfires (PHILOI_UI_SPEC.md §6/§16/§19). 'private' = a journal only the owner sees. */
  photo_visibility: PhotoVisibility;
  /** Per-category push toggles (§19). Empty/missing keys default to on — see NotificationPrefs. */
  notification_prefs: NotificationPrefs;
  /** Daily flame meter (§5) — auto-tunes to a rolling average, or a fixed manual target. */
  daily_goal_mode: 'auto' | 'manual';
  daily_goal_manual_target: number | null;
  /** Opt-in, default off — gates whether completing the meter can post to campfires (§5/§19). */
  publish_flame_completion: boolean;
  /** Soft-currency balance (MONETIZATION.md's phase-2 cosmetics shop) — earning-only for now. */
  embers: number;
  /** "Let friends watch my live challenges" (§16/§19) — default off; gates the profile-scoped Watch CTA. */
  watch_opt_in: boolean;
  created_at: string;
};

/** The five Settings toggles from NOTIFICATIONS_SPEC. Stored in notification_prefs under a
 * `cat_` prefix so they sit alongside 0026's finer-grained legacy keys without colliding. */
export type NotificationCategory =
  | "friends_social"
  | "challenges"
  | "campfires"
  | "streak_reminders"
  | "season_rank";

/** How the leading art is masked (spec: "circle = avatars, hexagon = ranks, rounded-square =
 * campfire/box, flame = streak"). */
export type NotificationImageShape = "circle" | "hexagon" | "rounded" | "square" | "flame";

/** One row of the bell feed — migration 0086. */
export type NotificationEvent = {
  id: string;
  user_id: string;
  type: string;
  category: NotificationCategory;
  actor_id: string | null;
  target_id: string | null;
  title: string;
  body: string | null;
  /** Stored, not derived, so an old row still navigates after a route rename. */
  route: string | null;
  route_params: Record<string, string>;
  /** Resolved when the event was written — a feed row keeps showing what it looked like then. */
  image_url: string | null;
  image_shape: NotificationImageShape;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

/** One row of the Journal (§5, migration 0091) — an achievement plus its optional human note. */
export type JournalEntry = {
  entry_key: string;
  /**
   * 'achievement' — the system recorded it, and it takes a note. 'milestone' — the user posted it
   * (§8), and it already carries its own note from the composer (migration 0093).
   */
  kind: 'achievement' | 'milestone';
  type: string;
  title: string;
  body: string | null;
  image_url: string | null;
  image_shape: NotificationImageShape;
  /** The owner’s comment. Null means the row still offers "+ add a note" on their own profile. */
  note: string | null;
  /** Hidden from visitors; still returned to the owner. */
  hidden: boolean;
  created_at: string;
};

/** §4 — one completed season's placement card in the Trophy Hall (migration 0092). */
export type HallSeason = {
  season_id: string;
  /** Final board position. Named `placement` rather than `rank` so it never reads as a rank TIER. */
  placement: number;
  board_size: number;
  /** Display name captured at grant time, so a re-themed title still says what was actually won. */
  title: string | null;
  medal_key: string | null;
  hidden: boolean;
};

/** A relic, medal or badge in the hall. `key` resolves against the client catalog / badge names. */
export type HallTrophy = {
  key: string;
  provenance: string | null;
  hidden: boolean;
};

export type HallRelic = HallTrophy & { acquired_at: string };
export type HallBadge = HallTrophy & { earned_at: string };

/** Head-to-head record. Draws are counted apart and excluded from the win rate (migration 0092). */
export type DuelRecord = {
  won: number;
  lost: number;
  drawn: number;
  hidden: boolean;
};

/**
 * The inputs behind the milestone-badge grid. Streak / lock-in / hours badges have no grant path
 * on purpose — they are a view over facts the profile already stores, so they can never disagree
 * with the streak shown on Home.
 */
export type HallStats = {
  current_streak: number;
  longest_streak: number;
  campus_verified: boolean;
  lockin_count: number;
  total_seconds: number;
};

export type TrophyHall = {
  is_owner: boolean;
  seasons: HallSeason[];
  relics: HallRelic[];
  badges: HallBadge[];
  /** Null when the owner has hidden the record from visitors. */
  record: DuelRecord | null;
  stats: HallStats;
  /** Owned cosmetics this viewer may see — the count on the profile's Collection entry. */
  collection_count: number;
  /** How many items a visitor is not being shown. Always 0 for the owner. */
  hidden_count: number;
};

/** §7 — one owned cosmetic in the read-only Collection browse (migration 0092). */
export type CollectionItem = {
  key: string;
  /** A placement grant's rarity beats the catalog's, same as in the inventory. */
  rarity_override: string | null;
  season_stamp: string | null;
  acquired_at: string;
  hidden: boolean;
};

export type PublicCollection = {
  is_owner: boolean;
  /** slot -> cosmetic_key. Marks which tile gets the "EQUIPPED" ring. */
  loadout: Record<string, string>;
  items: CollectionItem[];
  hidden_count: number;
};

/** What `set_profile_item_hidden` can be pointed at (migration 0092). */
export type HideableKind = 'cosmetic' | 'badge' | 'season' | 'record';

// ───────────────────────────── §8 · Milestones (migration 0093) ─────────────────────────────
//
// 🔒 A milestone grants ZERO XP, embers or rank. It is a content post, not an economy event — see
// the firewall note at the top of migration 0093 before adding anything to this path.

export type MilestoneKind = 'grade' | 'offer' | 'certification' | 'fitness_pr' | 'project' | 'custom';

/** Grades are sensitive: friends-only is the floor, anything wider is a per-post choice. */
export type MilestoneVisibility = 'friends' | 'campus' | 'public';

/**
 * The effort receipts, frozen at post time. Computed server-side and never sent by the client —
 * the user chooses which to KEEP, not what they say.
 */
export type MilestoneEffort = {
  hours?: number;
  streak?: number;
  lockins?: number;
};

/** Which receipts to keep, passed to create_milestone. */
export type EffortKey = keyof MilestoneEffort;

export type Milestone = {
  id: string;
  kind: MilestoneKind;
  headline: string;
  note: string | null;
  visibility: MilestoneVisibility;
  effort: MilestoneEffort;
  /** False = share card only; the post exists but is not on the profile for anyone but its author. */
  pinned: boolean;
  cheers: number;
  cheered: boolean;
  created_at: string;
};

/** get_milestone() — one post plus its author, for the permalink a cheer notification opens. */
export type MilestoneDetail = Milestone & {
  user_id: string;
  display_name: string;
  handle: string | null;
};

export type DailyFire = {
  day: string;
  goal_xp: number;
  progress_xp: number;
  completed: boolean;
  just_completed: boolean;
  bonus_xp: number;
  bonus_embers: number;
};

/**
 * A personal goal — belongs to the user, independent of any circle. At most one active
 * (non-archived) goal per built-in type per user; unlimited simultaneous `custom` goals
 * (see goals_one_active_per_type in schema.sql). Streak lives here now, not on group_members.
 */
export type Goal = {
  id: string;
  user_id: string;
  type: GoalType;
  label: string | null;
  cadence: string;
  current_streak: number;
  longest_streak: number;
  archived_at: string | null;
  created_at: string;
};

// A single 3-state enum (PHILOI_UI_SPEC.md §14): open (in the valley, instant-join), gated
// (in the valley, owner approves), private (hidden, code-only). Editable any time from
// campfire settings/Edit campfire, not locked at creation.
export type CampfirePrivacy = 'open' | 'gated' | 'private';

export type Group = {
  id: string;
  name: string;
  emoji: string;
  owner_id: string;
  join_code: string;
  /** Purely a discovery/branding "theme" tag now — no functional link to goals. */
  goal_type: GoalType;
  cadence: string;
  privacy: CampfirePrivacy;
  /** Set when this is a class-tagged campfire (PHILOI_UI_SPEC.md §14) — a course study-hall. */
  course_code: string | null;
  school: string | null;
  /** The join gate (design-mocks/94): the minimum rank tier a stranger needs to get in via
   * discovery. Null = anyone. Enforced in join_public_group/request_to_join_group, not just drawn. */
  min_join_tier: RankTierName | null;
  /** The owner's one-line house rule shown at the bottom of the member view. Null = no rule set. */
  house_rule: string | null;
  /**
   * The BANNER catalog key this campfire flies (0134). Null = never chosen, which renders as
   * `banner-base-hearth`.
   *
   * Per-campfire, deliberately: before 0134 the header read the OWNER's equipped banner, so an
   * owner with two fires flew the same art on both and setting one restyled their profile too.
   * Written only through set_campfire_banner, which checks ownership server-side.
   */
  banner_item_id: string | null;
  created_at: string;
};

/** One line of the season reward haul (mock 97, screen 2) — a row of the grant ledger, i.e. what
 * was actually paid, never re-derived from the band at read time. */
export type SeasonReward = {
  kind: 'title' | 'banner' | 'card' | 'particle' | 'medal' | 'box' | 'embers';
  key: string;
  name: string;
  rarity: string | null;
  /** Titles and banners are kept forever; boxes and embers are consumed. Permanent renders first. */
  permanent: boolean;
  amount: number | null;
};

/** Everything mock 97's two screens need — get_my_season_card(). Null until the season is closed. */
export type SeasonCard = {
  season_id: string;
  season_name: string | null;
  university: string;
  rank: number;
  board_size: number;
  percentile: number;
  /** 'rank_1'|'rank_2'|'rank_3'|'p1'|'p10'|'p25'|'p50', or null below the halfway line. */
  band: string | null;
  pass_xp: number;
  pass_level: number;
  hours_locked_in: number;
  /** The season title actually granted, with the rarity it was granted at (global reads hotter). */
  title: {
    key: string;
    name: string;
    rarity: string | null;
    scope: string;
    description: string;
    /** Global #1 — the animated 1-of-1, one person per season. */
    one_of_one: boolean;
  } | null;
  rewards: SeasonReward[];
};

/** design-mocks/94's stat strip — get_campfire_stats(). Members only; a non-member gets no row. */
export type CampfireStats = {
  member_count: number;
  locked_in_today: number;
  avg_streak: number;
  avg_hours_per_day: number;
  live_challenges: number;
};

export type DiscoverableGroup = {
  id: string;
  name: string;
  emoji: string;
  goal_type: GoalType;
  cadence: string;
  member_count: number;
  owner_university: string | null;
  course_code: string | null;
  school: string | null;
  privacy: CampfirePrivacy;
  campfire_level: number;
  has_pending_request: boolean;
};

export type CampfirePreview = {
  group_id: string;
  name: string;
  emoji: string;
  privacy: CampfirePrivacy;
  is_member: boolean;
  member_count: number;
  active_lock_in_count: number;
  campfire_level: number;
  member_names: string[];
  recent_photo_urls: string[];
  has_pending_request: boolean;
};

// The owner's requests screen (design-mocks/22) — shared_circle_name is a real, queryable
// signal (one other circle both the requester and the viewing owner belong to); there's no
// friend-graph in this schema, so the mock's "mutual friends" count isn't represented here.
export type JoinRequest = {
  id: string;
  user_id: string;
  display_name: string;
  handle: string | null;
  university: string | null;
  shared_circle_name: string | null;
  created_at: string;
};

/** One row of the campfire roster with its role (list_campfire_members, migration 0094). */
export type CampfireMember = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  role: MemberRole;
  joined_at: string;
};

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  /** Chat push notifications (mentions + batched general messages) muted for this circle. */
  chat_muted: boolean;
  /** "I can help with this class" (PHILOI_UI_SPEC.md §14) — self-declared, surfaced as a badge. */
  is_helper: boolean;
  /** Auto-post a synced workout (Strava/HealthKit/etc.) to this campfire (§17b) — opt-in,
   * default off; publishing on the user's behalf, so never on without this. */
  auto_post_synced: boolean;
};

export type CheckIn = {
  id: string;
  /** Null for every check-in created after the core lock-in loop rebuild (PHILOI_UI_SPEC.md
   * §12) — goals stopped being persisted per-user. Still set on old, pre-rebuild rows. */
  goal_id: string | null;
  user_id: string;
  created_at: string;
  /** Null for a lock-in-session completion with no photo attached — see duration_seconds. */
  photo_url: string | null;
  caption: string | null;
  status: CheckInStatus;
  /** goal_type/goal_detail are what a check-in is "for" going forward — chosen at lock-in
   * time, never derived from a goals join. goal_label stays populated only on old rows that
   * still have a goal_id. */
  goal_type: GoalType;
  goal_label: string | null;
  goal_detail: string | null;
  removed_at: string | null;
  /** Set for a lock-in-session completion (stop_lock_in_session()); null for a photo check-in. */
  duration_seconds: number | null;
  /** Computed once at insert time by handle_check_in_insert() — see domain_score() in schema.sql. */
  xp_earned: number;
  /** A lock-in's posted campfire, chosen explicitly on the done screen (PHILOI_UI_SPEC.md §13)
   * via post_check_in_to_circle — null until then (or forever, if kept private). Always null
   * on old photo check-ins (those fan out via check_in_circles directly, see schema.sql). */
  circle_id: string | null;
  /** Where this lock-in came from (migration 0038, §17b) — 'manual' for everything before this
   * and every ordinary Stop-button lock-in; a device source means it was auto-created from a
   * synced activity, which drives the Strava-branded cross-integration UI. */
  source: 'manual' | 'strava' | 'healthkit' | 'health_connect';
  /** The source's own activity id (Strava activity id today) — the dedup key alongside
   * (user_id, source) and the deep-link target for "View on Strava." Null for manual lock-ins. */
  external_id: string | null;
  /** Device-verified distance in meters — null unless source is a distance-tracking one. */
  distance_m: number | null;
};

/** One per-kilometre split off a synced activity (migration 0043) — trimmed at write time to the
 * fields the activity-detail screen actually renders. */
export type SyncedActivitySplit = {
  split: number;
  distance: number;
  moving_time: number;
  elevation_difference: number | null;
};

/** The Strava-derived route/splits/device data behind the profile-activity-detail screen
 * (migration 0043). Owner-only by RLS, and purged on disconnect per Strava's API Agreement. */
export type SyncedActivityDetailRow = {
  check_in_id: string;
  user_id: string;
  route_polyline: string | null;
  splits: SyncedActivitySplit[] | null;
  calories: number | null;
  elevation_gain_m: number | null;
  device_name: string | null;
  created_at: string;
};

/** One photo in a lock-in session's gallery — see migration 0008. Rows are only ever
 * written server-side by stop_lock_in_session(); the client only ever reads this table. */
export type CheckInPhoto = {
  id: string;
  check_in_id: string;
  photo_url: string;
  position: number;
  created_at: string;
};

/** A logged set from a gym lock-in (migration 0033) — gym's proof-of-effort for the
 * anti-farming quality floor (check_in_qualifies_for_challenge in schema.sql): a gym lock-in
 * only counts toward a challenge if it has a photo OR at least one of these. Weight is
 * optional (bodyweight work). Submitted as a batch to stop_lock_in_session, same pattern as
 * photos — never edited after the fact. */
export type WorkoutSetEntry = {
  exercise: string;
  sets: number;
  reps: number;
  weight?: number | null;
  /** Set by the live gym tracker's roll-up (migration 0037) — true if any set banked under
   * this exercise was a personal best. Always false on legacy batch-logged rows. */
  is_pr?: boolean;
};

// ───────────────────────────── gym tracker (migration 0037, §23) ─────────────────────────────

/** Pre-workout energy state, picked once in the routine picker. Rule 1 of §23: this only ever
 * nudges the SUGGESTED numbers by ~±5% — it never constrains what can actually be logged. */
export type WorkoutEnergy = 'light' | 'same' | 'dialed';

/** A lift in the library. `created_by` null = built-in (seeded, visible to everyone); set = a
 * user's own custom lift, private to them. */
export type Exercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  created_by: string | null;
  created_at: string;
};

/** A saved routine — just an ordered list of lifts. Targets are deliberately NOT stored here:
 * they come from what you actually lifted last time (see ActiveWorkoutExercise.suggested). */
export type Routine = {
  id: string;
  user_id: string;
  name: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A routine with its lifts resolved — what the picker's "Today's routine" list renders. */
export type RoutineWithExercises = Routine & {
  exercises: { id: string; exercise_id: string; name: string; position: number }[];
};

export type Workout = {
  id: string;
  user_id: string;
  lock_in_session_id: string | null;
  /** Null until Finish — set by stop_lock_in_session(), which is what makes the workout part
   * of the lock-in data on the done screen (§13). */
  check_in_id: string | null;
  routine_id: string | null;
  routine_name: string | null;
  energy: WorkoutEnergy;
  /** Rule 2 of §23 ("honest brag") — true only when the mood was `dialed` AND the session
   * actually produced a PR. Decided server-side at Finish; the client never sets it. */
  brag_earned: boolean;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export type WorkoutSet = {
  id: string;
  workout_id: string;
  workout_exercise_id: string;
  set_index: number;
  /** Null for bodyweight work — reps alone are the record there. */
  weight: number | null;
  reps: number;
  /** Historical: this set was a personal best at the moment it was banked. Never rewritten. */
  is_pr: boolean;
  created_at: string;
  /** Phase-2 video clip (PHILOI_UI_SPEC.md §23) — all nullable, a clip is optional per set.
   * Bytes live in R2; these are only references (see lib/api/gym-clips.ts). */
  video_key: string | null;
  thumb_key: string | null;
  duration_s: number | null;
  resolution: string | null;
  uploaded_at: string | null;
};

/** Just the clip pointers on a set — what the capture control hands back after attaching or
 * removing one, and all the live logger needs to redraw that row's camera affordance. */
export type WorkoutSetClipRefs = Pick<WorkoutSet, 'id' | 'video_key' | 'thumb_key'>;

export type PersonalRecord = {
  id: string;
  user_id: string;
  exercise_id: string;
  weight: number;
  reps: number;
  /** Epley estimated 1RM — the ranking metric, so "same weight, one more rep" counts. */
  e1rm: number;
  workout_set_id: string | null;
  achieved_at: string;
};

/** One exercise card in the live session logger, as returned by get_active_workout(). */
export type ActiveWorkoutExercise = {
  /** The workout_exercises row id — what every mid-session mutation is keyed on. */
  id: string;
  exercise_id: string;
  name: string;
  position: number;
  /** The user's stored best for this lift, or null if they've never logged it. */
  best: { weight: number | null; reps: number } | null;
  /** Energy-nudged starting point derived from the top set of the last workout containing this
   * lift — prefilled into a new set row, always editable, never enforced. */
  suggested: { weight: number | null; reps: number | null } | null;
  /** video_key/thumb_key added by migration 0057 — the live logger needs them to know a set is
   * already filmed (a re-record would burn another clip off the monthly quota). */
  sets: Pick<WorkoutSet, 'id' | 'set_index' | 'weight' | 'reps' | 'is_pr' | 'video_key' | 'thumb_key'>[];
};

/** The whole in-session state in one round trip — get_active_workout()'s jsonb payload. */
export type ActiveWorkout = {
  id: string;
  lock_in_session_id: string | null;
  routine_id: string | null;
  routine_name: string | null;
  energy: WorkoutEnergy;
  started_at: string;
  exercises: ActiveWorkoutExercise[];
};

/** The finished-workout recap — get_workout_recap()'s jsonb payload. Drives both the done
 * screen's summary and the lifts/PRs on the posted campfire card. */
export type WorkoutRecap = {
  workout_id: string;
  routine_name: string | null;
  energy: WorkoutEnergy;
  brag_earned: boolean;
  exercises: Required<WorkoutSetEntry>[];
};

/** The in-progress phase of a lock-in session — see stop_lock_in_session() for how it
 * becomes a CheckIn once stopped. */
export type LockInSession = {
  id: string;
  user_id: string;
  /** Null going forward — chosen per-session via goal_type/goal_detail, not a persisted goal. */
  goal_id: string | null;
  goal_type: GoalType;
  goal_detail: string | null;
  /** Null = solo lock-in (PHILOI_UI_SPEC.md §12's "solo campfire"); set = attached to that campfire. */
  circle_id: string | null;
  started_at: string;
  last_confirmed_at: string;
  reminder_sent_at: string | null;
  status: 'active' | 'completed' | 'abandoned';
  ended_check_in_id: string | null;
  created_at: string;
};

export type Reaction = {
  id: string;
  check_in_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type Invite = {
  code: string;
  inviter_id: string;
  group_id: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  group_id: string;
  user_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

export type AnalyticsEventName =
  // Reward economy (Step 21). Deliberately no event carries an ember BALANCE — only what was
  // done and to which item — so analytics can measure the economy without becoming a second,
  // untrusted ledger of how much anyone has.
  | 'loot_box_opened'
  | 'loot_box_bought'
  | 'cosmetic_bought'
  | 'cosmetic_equipped'
  | 'cosmetic_unequipped'
  | 'cosmetic_salvaged'
  | 'pass_tier_claimed'
  | 'pass_level_claimed'
  | 'iap_purchase_completed'
  | 'iap_purchase_cancelled'
  | 'iap_purchase_failed'
  | 'iap_restore'
  | 'iap_reconciled'
  | 'signed_up'
  | 'circle_created'
  | 'circle_joined'
  | 'circle_join_requested'
  | 'invite_sent'
  | 'invite_accepted'
  | 'check_in_completed'
  | 'first_check_in'
  | 'challenge_created'
  | 'challenge_completed'
  | 'challenge_members_invited'
  | 'challenge_invite_answered'
  | 'challenge_started'
  | 'goal_day_awarded'
  | 'notifications_read'
  | 'journal_note_set'
  | 'journal_entry_hidden'
  | 'bio_updated'
  | 'trophy_hall_viewed'
  | 'trophy_hall_see_all'
  | 'trophy_item_hidden'
  | 'collection_viewed'
  | 'milestone_composer_opened'
  | 'milestone_posted'
  | 'milestone_cheered'
  | 'milestone_shared'
  // The Agora (AGORA_SPEC) — appended block. No event carries a cheer or comment COUNT, only that
  // the action happened, for the same reason the economy events carry no balance.
  | 'agora_viewed'
  | 'agora_scope_changed'
  | 'agora_composer_opened'
  | 'agora_posted'
  | 'agora_cheered'
  | 'agora_commented'
  | 'challenge_logged'
  | 'challenge_accepted'
  | 'challenge_declined'
  | 'goal_created'
  | 'goal_archived'
  | 'leaderboard_viewed'
  | 'rank_viewed'
  | 'reaction_added'
  | 'chat_opened'
  | 'lock_in_started'
  | 'lock_in_completed'
  | 'lock_in_posted_to_circle'
  | 'first_lock_in_tutorial_shown'
  | 'first_lock_in_tutorial_completed'
  | 'daily_fire_completed'
  | 'flame_completion_published'
  | 'friend_nudged'
  | 'friend_request_sent'
  | 'friend_request_accepted'
  | 'friend_request_declined'
  | 'friend_request_cancelled'
  | 'gym_workout_started'
  | 'workout_set_logged'
  | 'workout_pr_hit'
  | 'routine_saved'
  | 'leaderboard_search_used'
  | 'friend_profile_viewed'
  | 'watch_opt_in_changed'
  | 'challenge_watch_opened'
  | 'challenge_watch_cheered'
  | 'challenge_cancelled'
  // Change/cancel consent (migration 0058, mocks 70/71). Worth measuring separately from
  // challenge_cancelled: a REQUEST is the start of a negotiation, and the gap between requested
  // and agreed/declined is the signal for whether consent is working or just adding friction.
  | 'challenge_change_requested'
  | 'challenge_change_agreed'
  | 'challenge_change_declined'
  | 'challenge_forfeited'
  | 'challenge_terms_updated'
  // Separate from challenge_cancelled: cancelling ENDS a race people are running, deleting
  // removes one that never got going. Conflating them would hide how many challenges are being
  // set up and then abandoned before anyone accepts.
  | 'challenge_deleted'
  // The reward reveal (0116). The pair is the funnel that matters: `seen` counts settled races
  // where the payout was actually announced, `shared` how many of those were worth advertising.
  // A gap between them and the standings-block Share is doing nothing.
  | 'challenge_reward_seen'
  | 'challenge_result_shared'
  // ─── Agent 2 / challenge v2 (0124-0127) ───
  // The third leg of that funnel: how many announced boxes were actually opened from the reveal.
  // Before 0125 this was unmeasurable because the CTA could not be rendered at all.
  | 'challenge_reward_box_opened'
  // Campus verification (UNI_VERIFICATION_SPEC.md). The gap between sent and verified is the
  // number that matters: it's how many students hit a school inbox they couldn't actually reach.
  | 'campus_code_sent'
  | 'campus_verified'
  // Cindy (CINDY_SPEC.md). Deliberately NO event carries message text, transcripts, or any
  // context she read — what a person says to their coach is not analytics. These measure only
  // that a conversation happened and whether her actions land.
  | 'cindy_consent'
  | 'cindy_message_sent'
  | 'cindy_voice_turn'
  | 'cindy_action'
  // The lock-in entry points (mock 117 §C). `cue` is the milestone that triggered her
  // ('min:30', 'pr:1'), `action` the quick-sheet row taken — no session detail, no line text.
  | 'cindy_lockin_line'
  | 'cindy_lockin_quick_action'
  // Focus Nudge (APP_BLOCKER_SPEC.md). Setup funnel plus which tone the coach chose, and that is
  // deliberately ALL: no line text, no app identities (Apple's selection tokens are opaque and we
  // never resolve one), and — the important omission — nothing at all about the nudge FIRING.
  //
  // A retreat-to-social event would be the single most sensitive thing this app could log: §C-safety
  // reads repeated retreat as possible avoidance or distress, and a person in that state is not a
  // funnel to measure. `focus_nudge_apps_picked` carries a count only; `focus_nudge_line_fetched`
  // carries the intent, which is a fact about the copy we generated, not about their behaviour.
  // Same principle as the support screen, which logs nothing whatsoever.
  //
  // ANDROID adds one, and only because Google asks for it: the AccessibilityService declaration
  // commits Philoi to a prominent disclosure shown BEFORE the permission is requested, and this is
  // how we can answer "is it actually being seen" without guessing. It carries no properties.
  // Android also reuses `focus_nudge_apps_picked` with a count — the native side knows the package
  // names there (Android has no opaque-token picker) and deliberately does not pass them up, so the
  // event is identical on both platforms.
  | 'focus_nudge_permission'
  | 'focus_nudge_apps_picked'
  | 'focus_nudge_disclosure_accepted'
  | 'focus_nudge_auto_toggled'
  | 'focus_nudge_line_fetched';

export type AnalyticsEvent = {
  id: string;
  user_id: string | null;
  name: AnalyticsEventName;
  properties: Record<string, unknown>;
  created_at: string;
};

export type LeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  score: number;
  tier: RankTierName;
  division: number;
  check_ins_this_week: number;
};

export type UniversityLeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  score: number;
  tier: RankTierName;
  division: number;
  check_ins_this_week: number;
  /** True rank on the FULL board, not just this row's position within the fetched slice — lets
   * the caller's own row pin at the bottom with its real rank even outside the top p_limit. */
  rank: number;
  is_me: boolean;
};

/** The Leaderboard tab's "Global" scope (§15's 4th tab) — get_global_leaderboard(). Same
 * true-rank-pinning shape as UniversityLeaderboardRow, no per-week check-in count (that's a
 * my-uni-specific metric), plus each row's university for display. */
export type GlobalLeaderboardRow = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  score: number;
  tier: RankTierName;
  division: number;
  university: string | null;
  check_ins_this_week: number;
  rank: number;
  is_me: boolean;
};

/** search_leaderboard() — the Leaderboard tab's magnifier search (§15). */
export type LeaderboardSearchResult = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  tier: RankTierName;
  division: number;
  score: number;
  board: 'My uni' | 'Global';
  board_rank: number | null;
  is_friend: boolean;
};

/** get_relationship_with() — mirrors PersonSearchResult's Relationship union plus 'self'. */
export type ProfileRelationship = 'self' | 'friends' | 'requested' | 'incoming' | 'none';

/** get_profile_stats() — the friend-profile's stat row + "Works on" chips (mock 43). */
export type ProfileStats = {
  current_streak: number;
  lock_in_count: number;
  hours_locked_in: number;
  goal_types: string[];
};

/** get_active_challenge_marker() — the pulsing chip (mock 37) on a fire/friend row/profile. */
export type ActiveChallengeMarker = {
  challenge_id: string;
  mode: SocialChallengeMode;
  circle_id: string | null;
  opponent_id: string | null;
  opponent_name: string | null;
  race_metric: SocialChallengeRaceMetric;
  target_count: number | null;
  ends_at: string | null;
  can_watch: boolean;
};

/**
 * get_challenge_cheer_notes() — the notes spectators left with their cheers (0110).
 *
 * Read separately from ChallengeWatch rather than folded into it: the watch RPC is polled, and
 * widening its RETURNS TABLE is what broke it once already (0081 -> 0099).
 */
export type CheerNote = {
  spectator_id: string;
  spectator_name: string;
  /** Which competitor this spectator backed. */
  backed_user_id: string;
  note: string;
  noted_at: string;
};

/** get_challenge_watch() — the H2H live spectator read (§16). */
export type ChallengeWatch = {
  challenge_id: string;
  mode: SocialChallengeMode;
  race_metric: SocialChallengeRaceMetric;
  target_count: number | null;
  window_hours: number;
  starts_at: string;
  ends_at: string | null;
  /** 'active' | 'completed' | … — the watch screen renders read-only once this leaves 'active'. */
  status: string;
  created_by: string;
  created_by_name: string;
  created_by_score: number;
  created_by_live_status: string;
  created_by_cheers: number;
  opponent_id: string | null;
  opponent_name: string | null;
  opponent_score: number | null;
  opponent_live_status: string | null;
  opponent_cheers: number | null;
  /** One cheer per spectator per challenge — true once this viewer has spent theirs. */
  has_cheered: boolean;
  /** Which competitor they backed, so the cheered side can be marked. */
  cheered_for: string | null;
};

/**
 * get_group_challenge_watch() — one row per RACER (0112), not per campfire member.
 *
 * Since 0096 a group challenge is an invited subset, so "every member of the campfire" is the
 * wrong field: a four-person race in a thirty-person campfire used to draw thirty meters while
 * settlement scored it out of four.
 */
export type GroupChallengeWatchRow = {
  challenge_id: string;
  /** Null on a placement race, which has no per-member target (0126's constraint). */
  target_count: number | null;
  window_hours: number;
  starts_at: string;
  ends_at: string | null;
  /** 'active' | 'completed' | 'expired' — settled group races are readable now (0112). */
  status: string;
  circle_id: string;
  circle_name: string;
  public_name: string | null;
  // ─── Agent 2 / challenge v2 (0126) ───
  /** 'collective' | 'placement'. Both ride mode = 'group', so this is the only thing that
   *  separates "N of 5 lock-ins done" from a ranked board. */
  shape: ChallengeShape | null;
  /** What a placement race ranks on — the units member_progress is in. Null for a collective
   *  goal, whose progress is a count of lock-ins and needs no unit. */
  race_metric: SocialChallengeRaceMetric | null;
  member_id: string;
  member_name: string;
  /**
   * A count of qualifying lock-ins for a collective goal; the racer's metric score net of their
   * baseline for a placement race (0126). Two meanings behind one name because the screen renders
   * one list either way — `shape` is what says which.
   */
  member_progress: number;
  member_live_status: string;
  /** Cheers backing this racer — the count the spec wants under each meter. */
  member_cheers: number;
  /** Whether this viewer's one cheer is the one behind this racer. */
  cheered_by_me: boolean;
};

export type WeeklyRecap = {
  group_id: string;
  group_name: string;
  check_ins_this_week: number;
};

/** The Leaderboard tab's "Campfires" scope (PHILOI_UI_SPEC.md §15) — get_my_cross_circle_people(). */
export type CrossCirclePerson = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  is_pro: boolean;
  score: number;
  tier: RankTierName;
  division: number;
  current_streak: number;
};

/** The Leaderboard tab's "Vs. unis" scope — get_university_totals(). */
export type UniversityTotal = {
  university: string;
  total_xp: number;
  member_count: number;
};

// run_distance/ride_distance added by migration 0035 (Strava, §17) — first-class rather than
// folded into 'custom' since Strava sync needs to know which activity type (Run vs Ride) and
// unit (km) to reduce to. workout_minutes/strain/sleep_hours added by 0036 (Whoop, §17) for the
// same reason — each maps to exactly one Whoop collection and one scope. Whoop has NO step
// count, which is why steps is deliberately absent from its side of the metric-fit map.
export type ChallengeType =
  | 'steps'
  | 'gym_visits'
  | 'study_hours'
  | 'custom'
  | 'run_distance'
  | 'ride_distance'
  | 'workout_minutes'
  | 'strain'
  | 'sleep_hours';
export type ChallengePeriod = 'day' | 'week';
export type ChallengeVisibility = 'circle' | 'private';

// An individual goal. NOT bound to a campfire (migration 0059) — a goal is the user's own, and
// sharing the work behind it is chosen per lock-in on the done screen, which can post to several
// circles at once. `visibility` survives only for rows written before that change.
/** How a custom goal is measured (migration 0061, design-mocks/74). Built-in metrics are always
 * 'manual' here — each has its own real source, or none at all. */
export type ChallengeCountMode = 'manual' | 'lockin_time';

export type Challenge = {
  id: string;
  user_id: string;
  type: ChallengeType;
  count_mode: ChallengeCountMode;
  label: string | null;
  target: number;
  unit: string;
  period: ChallengePeriod;
  progress: number;
  visibility: ChallengeVisibility;
  period_start: string;
  completed_at: string | null;
  created_at: string;
};

// Solo (announced) mode was removed — a solo goal the campfire can see is already covered by
// the lock-in flow's own "with the campfire" toggle (PHILOI_UI_SPEC.md §12). Only h2h and
// group remain.
export type SocialChallengeMode = 'h2h' | 'group';

/**
 * The lifecycle. v2 adds exactly ONE state — 'draft' (created, nobody invited yet).
 *
 * Everything else reuses the existing vocabulary rather than adding synonyms: 'pending' already
 * means invite-sent-awaiting-answer, 'active' already means racing, 'completed' already means
 * settled. Adding 'invited'/'live'/'settled' alongside them forked the vocabulary and silently
 * broke five readers — including the settle sweep, which would have left v2 races running forever.
 */
export type SocialChallengeStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'completed'
  | 'declined'
  | 'expired';

/** The three v2 shapes. A collective goal must never render as a 1v1 VS — which is why shape is
 * explicit rather than inferred from whether opponent_id happens to be set. */
export type ChallengeShape = 'duel' | 'collective' | 'placement';

/** v2 metric set. 'xp' is no longer OFFERED at creation (it correlates with lock-in time) but
 * stays in the union because in-flight races still carry it. */
export type SocialChallengeRaceMetric = 'lockin_time' | 'volume' | 'distance' | 'ai' | 'xp';

export type ChallengeParticipantState = 'invited' | 'accepted' | 'declined';

/** One racer. Progress is always (current − baseline), which is what stops a challenge crediting
 * work done before it started. */
export type ChallengeParticipant = {
  challenge_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  state: ChallengeParticipantState;
  baseline: number;
  /** Live progress for the race so far, already net of the baseline. */
  progress: number;
  final_value: number | null;
  final_rank: number | null;
  final_percentile: number | null;
};

// get_my_social_challenges() row — the Challenges tab's feed (PHILOI_UI_SPEC.md,
// design-mocks/12 & 13). my_score/opponent_score/member_count/completed_count are live-scored
// off real check_ins data, not a stored/potentially-stale number.
export type SocialChallenge = {
  id: string;
  // Nullable — an h2h challenge is friend-to-friend and doesn't require a shared campfire; null
  // means nobody's watching. Group challenges always have one.
  circle_id: string | null;
  circle_name: string | null;
  circle_emoji: string | null;
  created_by: string;
  created_by_name: string;
  mode: SocialChallengeMode;
  opponent_id: string | null;
  opponent_name: string | null;
  race_metric: SocialChallengeRaceMetric | null;
  my_score: number | null;
  opponent_score: number | null;
  target_count: number | null;
  member_count: number | null;
  completed_count: number | null;
  window_hours: number;
  starts_at: string | null;
  ends_at: string | null;
  status: SocialChallengeStatus;
  winner_id: string | null;
  payout_xp: number;
  created_at: string;
  /** The user-set public name (0096). Null falls back to the metric naming the challenge. */
  public_name: string | null;
  /** Null only for rows created before 0096's backfill; every live row has one. */
  shape: ChallengeShape | null;
  /** Roster counts (0112) — how the tab says "waiting on 3" without a second round trip. */
  invited_count: number;
  accepted_count: number;
  /** This viewer's own row on the roster, or null if they are not on it. */
  my_state: ChallengeParticipantState | null;
};

/** One row of get_challenge_results() (0111) — the settled standings, read rather than
 * re-derived, so a result page cannot drift as later sessions land. */
export type ChallengeResultRow = {
  member_id: string;
  member_name: string;
  score_value: number | null;
  place: number | null;
  percentile: number | null;
  awarded_xp: number;
  is_winner: boolean;
};

/**
 * grant_reward's return value, captured at settlement by 0116 — the payout that actually landed.
 *
 * Every field is nullable because the completion band pays no box and no badge, and because a
 * challenge settled before 0114 has no payload at all (grant_reward raised before it could
 * return). The reveal renders placement and XP in that case rather than nothing.
 */
export type ChallengeRewardPayload = {
  embers: number | null;
  /** A `BoxKey` — resolved against the local catalog for its name and rarity. */
  box: string | null;
  /**
   * The `loot_boxes` ROW id of the box this challenge minted (0125) — what /shop/open needs, and
   * the only unambiguous way to know which of several identical boxes in the inventory was this
   * one. Null on every payload written before 0125 deployed, and on the completion band, which
   * mints no box; the reveal then renders the box row without an Open CTA.
   */
  box_id: string | null;
  /** The badge KEY ('challenge-elite'); its label is rebuilt from `band`. */
  badge: string | null;
  band: string | null;
  significance: number | null;
};

/**
 * get_challenge_reward() (0116) — this viewer's own result on a settled challenge. `{}` for a
 * non-participant and for a challenge that has not settled, which lands here as every field null.
 */
export type ChallengeReward = {
  placement: number | null;
  /** Stored orientation, as in get_challenge_results: 1.0 is the TOP of the board. */
  percentile: number | null;
  field_size: number;
  xp: number;
  /** Non-null once the reveal has been shown — the server-side fire-once flag. */
  seen_at: string | null;
  payload: ChallengeRewardPayload | null;
};

// ───────────── challenge change/cancel consent (migration 0058, design-mocks/70 + 71) ─────────────

export type ChallengeChangeKind = 'edit' | 'cancel';
export type ChallengeChangeStatus = 'pending' | 'agreed' | 'declined' | 'expired';

/** The raw row, as returned by request/respond. */
export type ChallengeChangeRequest = {
  id: string;
  challenge_id: string;
  requested_by: string;
  kind: ChallengeChangeKind;
  proposed: ChallengeChangeProposal | null;
  status: ChallengeChangeStatus;
  created_at: string;
  responded_at: string | null;
};

/** Only the two terms mock 70 marks editable — metric and stakes are fixed for the life of the
 * challenge (server-enforced in request_challenge_change). */
export type ChallengeChangeProposal = {
  window_hours?: number;
  target_count?: number;
};

/** get_challenge_change_request()'s payload — the proposal plus the current terms it would
 * replace, which is what lets the consent screen render before → after. */
export type ChallengeChangeRequestDetail = {
  id: string;
  challenge_id: string;
  requested_by: string;
  requested_by_name: string;
  /** True when the VIEWER opened their own request — they may not answer it. */
  is_mine: boolean;
  kind: ChallengeChangeKind;
  status: ChallengeChangeStatus;
  proposed: ChallengeChangeProposal | null;
  created_at: string;
  mode: SocialChallengeMode;
  race_metric: SocialChallengeRaceMetric | null;
  payout_xp: number;
  challenge_status: SocialChallengeStatus;
  current: {
    window_hours: number;
    target_count: number | null;
    ends_at: string | null;
  };
};

export type ChallengeLog = {
  id: string;
  challenge_id: string;
  user_id: string;
  amount: number;
  note: string | null;
  created_at: string;
};

export type ChallengeFeedEvent = {
  id: string;
  group_id: string;
  user_id: string;
  challenge_id: string;
  challenge_type: ChallengeType;
  challenge_label: string | null;
  target: number;
  unit: string;
  /** Amount logged in this specific event — null for rows written before this column existed. */
  amount: number | null;
  /** challenges.progress right after this log. */
  progress: number | null;
  /** True only for the log that crossed the target; false for every incremental log before it. */
  is_completion: boolean;
  created_at: string;
};

/** Snapshot of which circles a check-in's poster belonged to at post time — scopes a
 * circle's feed to point-in-time history instead of live membership overlap. See
 * snapshot_check_in_circles() in schema.sql. */
export type CheckInCircle = {
  check_in_id: string;
  circle_id: string;
  posted_at: string;
};

export type ChallengeLeaderboardRow = {
  user_id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  progress: number;
  target: number;
  unit: string;
  completed_at: string | null;
};

export type MyCircleRank = {
  group_id: string;
  group_name: string;
  group_emoji: string;
  my_rank: number;
  member_count: number;
  score: number;
  tier: RankTierName;
  division: number;
  check_ins_this_week: number;
};

/** get_my_ranks() row — one 'universal' row plus one 'domain' row per active goal type. */
export type MyRank = {
  scope: 'universal' | 'domain';
  goal_type: GoalType | null;
  score: number;
  tier: RankTierName;
  division: number;
  /** XP earned since entering this tier — score minus the current tier's threshold. */
  xp_into_tier: number;
  /** XP needed to reach the next tier from this one; 0 at max rank (Diamond I). */
  xp_for_next_tier: number;
};

// ── Cindy, the AI coach (migration 0101, CINDY_SPEC.md) ──────────────────────────────────────

/** Consent + per-surface toggles. No row at all = never consented, which fails closed. */
export type CoachSettingsRow = {
  user_id: string;
  enabled: boolean;
  consented_at: string | null;
  home_bubble_enabled: boolean;
  voice_enabled: boolean;
  updated_at: string;
};

/** Which channel produced a message — the routing split (CINDY_SPEC), stored so it is auditable. */
export type CoachSurface = 'chat' | 'home' | 'intercept' | 'reengagement';

export type CoachMessageRow = {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  surface: CoachSurface;
  /** A proposed action or the receipt of a performed one; null for plain talk. */
  action: Record<string, unknown> | null;
  modality: 'text' | 'voice';
  created_at: string;
};

export type CoachHomeBubbleRow = {
  user_id: string;
  message: string;
  /** Warm intents only — the protective ones cannot be generated on this surface. */
  intent: string;
  context_digest: string | null;
  dismissed_at: string | null;
  generated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      universities: {
        Row: { id: string; name: string; short_name: string | null };
        Insert: { id?: string; name: string; short_name?: string | null };
        Update: { id?: string; name?: string; short_name?: string | null };
        Relationships: [];
      };
      goals: {
        Row: Goal;
        Insert: Partial<Goal> & { user_id: string; type: GoalType };
        Update: Partial<Goal>;
        Relationships: [];
      };
      groups: {
        Row: Group;
        Insert: Partial<Group> & { name: string; owner_id: string };
        Update: Partial<Group>;
        Relationships: [];
      };
      group_members: {
        Row: GroupMember;
        Insert: Partial<GroupMember> & { group_id: string; user_id: string };
        Update: Partial<GroupMember>;
        Relationships: [
          {
            foreignKeyName: 'group_members_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      check_ins: {
        Row: CheckIn;
        Insert: Partial<CheckIn> & { goal_id: string; user_id: string; photo_url: string };
        Update: Partial<CheckIn>;
        Relationships: [
          {
            foreignKeyName: 'check_ins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'check_ins_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id'];
          },
        ];
      };
      check_in_photos: {
        Row: CheckInPhoto;
        Insert: Partial<CheckInPhoto> & { check_in_id: string; photo_url: string };
        Update: Partial<CheckInPhoto>;
        Relationships: [
          {
            foreignKeyName: 'check_in_photos_check_in_id_fkey';
            columns: ['check_in_id'];
            isOneToOne: false;
            referencedRelation: 'check_ins';
            referencedColumns: ['id'];
          },
        ];
      };
      synced_activity_details: {
        Row: SyncedActivityDetailRow;
        // Read-only from the client: rows are written by the strava-webhook / strava-backfill
        // Edge Functions under the service role, and there's no insert/update RLS policy.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'synced_activity_details_check_in_id_fkey';
            columns: ['check_in_id'];
            isOneToOne: true;
            referencedRelation: 'check_ins';
            referencedColumns: ['id'];
          },
        ];
      };
      reactions: {
        Row: Reaction;
        Insert: Partial<Reaction> & { check_in_id: string; user_id: string; emoji: string };
        Update: Partial<Reaction>;
        Relationships: [
          {
            foreignKeyName: 'reactions_check_in_id_fkey';
            columns: ['check_in_id'];
            isOneToOne: false;
            referencedRelation: 'check_ins';
            referencedColumns: ['id'];
          },
        ];
      };
      invites: {
        Row: Invite;
        Insert: Partial<Invite> & { code: string; inviter_id: string };
        Update: Partial<Invite>;
        Relationships: [];
      };
      events: {
        Row: AnalyticsEvent;
        Insert: Partial<AnalyticsEvent> & { user_id: string; name: AnalyticsEventName };
        Update: Partial<AnalyticsEvent>;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: Partial<Message> & { group_id: string; user_id: string; body: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'messages_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      moderation_reports: {
        Row: {
          id: string;
          reporter_id: string | null;
          reported_check_in_id: string | null;
          reported_message_id: string | null;
          reported_user_id: string | null;
          reported_group_id: string | null;
          // The Agora (migrations 0128/0129) — so a report arrives pointing at the CONTENT, not
          // just at a person.
          reported_agora_post_id: string | null;
          reported_agora_comment_id: string | null;
          circle_id: string | null;
          note: string | null;
          reason: string;
          status: string;
          created_at: string;
        };
        Insert: {
          reporter_id?: string | null;
          reported_check_in_id?: string | null;
          reported_message_id?: string | null;
          reported_user_id?: string | null;
          reported_group_id?: string | null;
          reported_agora_post_id?: string | null;
          reported_agora_comment_id?: string | null;
          circle_id?: string | null;
          note?: string | null;
          reason: string;
        };
        Update: { status?: string };
        Relationships: [];
      };
      blocked_users: {
        Row: { blocker_id: string; blocked_id: string; created_at: string };
        Insert: { blocker_id: string; blocked_id: string };
        Update: never;
        Relationships: [];
      };
      push_tokens: {
        Row: { user_id: string; token: string; created_at: string };
        Insert: { user_id: string; token: string };
        Update: never;
        Relationships: [];
      };
      challenges: {
        Row: Challenge;
        Insert: Partial<Challenge> & { user_id: string; type: ChallengeType; target: number; unit: string };
        Update: Partial<Challenge>;
        Relationships: [
          {
            foreignKeyName: 'challenges_circle_id_fkey';
            columns: ['circle_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      challenge_logs: {
        Row: ChallengeLog;
        Insert: Partial<ChallengeLog> & { challenge_id: string; user_id: string; amount: number };
        Update: never;
        Relationships: [];
      };
      challenge_feed_events: {
        Row: ChallengeFeedEvent;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'challenge_feed_events_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      check_in_circles: {
        Row: CheckInCircle;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'check_in_circles_check_in_id_fkey';
            columns: ['check_in_id'];
            isOneToOne: false;
            referencedRelation: 'check_ins';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'check_in_circles_circle_id_fkey';
            columns: ['circle_id'];
            isOneToOne: false;
            referencedRelation: 'groups';
            referencedColumns: ['id'];
          },
        ];
      };
      lock_in_sessions: {
        Row: LockInSession;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'lock_in_sessions_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'goals';
            referencedColumns: ['id'];
          },
        ];
      };
      exercises: {
        Row: Exercise;
        // The one gym table users write to directly (RLS: "insert own") — a custom lift is
        // theirs alone, so there's no trust reason to route it through an RPC.
        Insert: { name: string; muscle_group?: string | null; created_by: string };
        Update: never;
        Relationships: [];
      };
      routines: {
        Row: Routine;
        // Written via save_routine() so the routine + its ordered lifts land atomically.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      routine_exercises: {
        Row: { id: string; routine_id: string; exercise_id: string; position: number; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'routine_exercises_exercise_id_fkey';
            columns: ['exercise_id'];
            isOneToOne: false;
            referencedRelation: 'exercises';
            referencedColumns: ['id'];
          },
        ];
      };
      // The live log's three tables are read-only to clients — every write goes through a
      // security-definer RPC, because a client that could INSERT a workout_set could also hand
      // itself a PR.
      workouts: {
        Row: Workout;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workout_exercises: {
        Row: { id: string; workout_id: string; exercise_id: string; name: string; position: number; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workout_sets: {
        Row: WorkoutSet;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      personal_records: {
        Row: PersonalRecord;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      check_in_workout_sets: {
        Row: WorkoutSetEntry & { id: string; check_in_id: string; position: number; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      // ── Cindy, the AI coach (migration 0101) ──
      // Insert is `never` on the two content tables: every message and every bubble is written
      // by the ai-coach edge function under the service role, after the model has actually
      // produced it. A client that could insert an assistant row could forge things Cindy never
      // said and then have them replayed back to her as history.
      coach_settings: {
        Row: CoachSettingsRow;
        Insert: Partial<CoachSettingsRow> & { user_id: string };
        Update: Partial<CoachSettingsRow>;
        Relationships: [];
      };
      coach_messages: {
        Row: CoachMessageRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      coach_home_bubble: {
        Row: CoachHomeBubbleRow;
        Insert: never;
        /** Dismissal only — the message text is service-role. */
        Update: { dismissed_at?: string | null };
        Relationships: [];
      };
      coach_usage: {
        Row: { user_id: string; day: string; text_calls: number; bubble_calls: number; voice_seconds: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_group_leaderboard: { Args: { p_group_id: string }; Returns: LeaderboardRow[] };
      get_weekly_recap: { Args: { p_user_id: string }; Returns: WeeklyRecap[] };
      create_group_with_owner: {
        Args: {
          p_name: string;
          p_emoji: string;
          p_goal_type: GoalType;
          p_cadence: string;
          p_course_code?: string | null;
          p_school?: string | null;
          p_privacy?: CampfirePrivacy;
        };
        Returns: Group;
      };
      join_group_with_code: { Args: { p_code: string }; Returns: Group };
      join_public_group: { Args: { p_group_id: string }; Returns: Group };
      request_to_join_group: { Args: { p_group_id: string }; Returns: undefined };
      update_campfire_privacy: { Args: { p_group_id: string; p_privacy: CampfirePrivacy }; Returns: Group };
      update_campfire_details: { Args: { p_group_id: string; p_name: string; p_emoji: string }; Returns: Group };
      // Campfire roles (migration 0094). my_campfire_role returns null for a non-member.
      my_campfire_role: { Args: { p_group_id: string }; Returns: MemberRole | null };
      list_campfire_members: { Args: { p_group_id: string }; Returns: CampfireMember[] };
      set_campfire_member_role: {
        Args: { p_group_id: string; p_user_id: string; p_role: Exclude<MemberRole, 'owner'> };
        Returns: undefined;
      };
      update_campfire_house_rules: {
        Args: { p_group_id: string; p_min_join_tier: RankTierName | null; p_house_rule: string | null };
        Returns: Group;
      };
      get_campfire_stats: { Args: { p_group_id: string }; Returns: CampfireStats[] };
      get_my_season_card: { Args: { p_season: string | null }; Returns: SeasonCard | null };
      list_join_requests: { Args: { p_group_id: string }; Returns: JoinRequest[] };
      approve_join_request: { Args: { p_request_id: string }; Returns: undefined };
      deny_join_request: { Args: { p_request_id: string }; Returns: undefined };
      approve_all_join_requests: { Args: { p_group_id: string }; Returns: undefined };
      get_discoverable_groups: {
        Args: { p_goal_type?: GoalType | null; p_limit?: number; p_search?: string | null };
        Returns: DiscoverableGroup[];
      };
      get_campfire_preview: { Args: { p_group_id: string }; Returns: CampfirePreview[] };
      set_my_helper_flag: { Args: { p_group_id: string; p_is_helper: boolean }; Returns: undefined };
      /** Owner-only; null clears back to the base hearth. Ownership of the key is checked server-side. */
      set_campfire_banner: { Args: { p_group_id: string; p_item_key: string | null }; Returns: undefined };
      set_my_auto_post_synced: { Args: { p_group_id: string; p_enabled: boolean }; Returns: undefined };
      set_my_check_in_caption: { Args: { p_check_in_id: string; p_caption: string }; Returns: undefined };
      ensure_personal_invite: { Args: Record<string, never>; Returns: string };
      delete_group: { Args: { p_group_id: string }; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      delete_my_message: { Args: { p_message_id: string }; Returns: undefined };
      get_university_leaderboard: {
        Args: { p_university: string; p_limit?: number };
        Returns: UniversityLeaderboardRow[];
      };
      get_global_leaderboard: { Args: { p_limit?: number }; Returns: GlobalLeaderboardRow[] };
      search_leaderboard: { Args: { p_query: string; p_limit?: number }; Returns: LeaderboardSearchResult[] };
      get_relationship_with: { Args: { p_user_id: string }; Returns: ProfileRelationship };
      get_profile_stats: { Args: { p_user_id: string }; Returns: ProfileStats[] };
      get_user_board_position: { Args: { p_user_id: string }; Returns: { board: 'My uni' | 'Global'; rank: number }[] };
      get_active_challenge_marker: { Args: { p_user_id: string }; Returns: ActiveChallengeMarker[] };
      get_challenge_watch: { Args: { p_challenge_id: string }; Returns: ChallengeWatch[] };
      get_challenge_cheer_notes: { Args: { p_challenge_id: string }; Returns: CheerNote[] };
      can_watch_challenge: { Args: { p_challenge_id: string }; Returns: boolean };
      get_group_challenge_watch: { Args: { p_challenge_id: string }; Returns: GroupChallengeWatchRow[] };
      set_my_watch_opt_in: { Args: { p_enabled: boolean }; Returns: undefined };
      cheer_challenge: {
        // p_note is optional (0110). Returns int, not void: 0081 changed it to hand back the
        // authoritative count for the cheered side, and this signature was never updated —
        // which is why cheerChallenge() still guards with `typeof data === 'number'`.
        Args: { p_challenge_id: string; p_for_user_id: string; p_note?: string | null };
        Returns: number;
      };
      set_chat_muted: { Args: { p_group_id: string; p_muted: boolean }; Returns: undefined };
      set_my_photo_visibility: { Args: { p_visibility: PhotoVisibility }; Returns: undefined };
      set_my_notification_prefs: { Args: { p_prefs: NotificationPrefs }; Returns: undefined };
      set_daily_goal_mode: { Args: { p_mode: 'auto' | 'manual'; p_manual_target?: number | null }; Returns: undefined };
      set_publish_flame_completion: { Args: { p_enabled: boolean }; Returns: undefined };
      get_or_create_daily_fire: {
        Args: { p_day: string; p_day_start: string; p_day_end: string };
        Returns: DailyFire[];
      };
      publish_flame_completion: { Args: { p_day: string }; Returns: undefined };
      get_my_lockin_stats: {
        Args: Record<string, never>;
        Returns: { lockin_count: number; total_seconds: number }[];
      };
      get_user_lockin_stats: {
        Args: { p_user_id: string };
        Returns: { lockin_count: number; total_seconds: number }[];
      };
      get_user_rank: {
        Args: { p_user_id: string };
        Returns: { score: number; tier: RankTierName; division: number; xp_into_tier: number; xp_for_next_tier: number }[];
      };
      get_user_lock_in_photos: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: { id: string; goal_type: GoalType; goal_detail: string | null; duration_seconds: number | null; photo_url: string | null }[];
      };
      get_my_social_challenges: { Args: Record<string, never>; Returns: SocialChallenge[] };
      // p_public_name landed in 0098 and the client has been sending it since; the entry here
      // still described the pre-v2 signature.
      // ─── Agent 2 / challenge v2 (0124-0127) ───
      // p_starts_on / p_ends_on landed in 0124 — the columns have existed since 0096 and
      // start_challenge has always preferred them; nothing could set them until now.
      create_h2h_challenge: {
        Args: {
          p_opponent_id: string;
          p_race_metric: SocialChallengeRaceMetric;
          p_window_hours: number;
          p_circle_id?: string | null;
          p_payout_xp?: number;
          p_public_name?: string | null;
          p_starts_on?: string | null;
          p_ends_on?: string | null;
        };
        Returns: SocialChallenge;
      };
      create_group_challenge: {
        Args: {
          p_circle_id: string;
          p_target_count: number;
          p_window_hours: number;
          p_payout_xp?: number;
          p_public_name?: string | null;
          p_starts_on?: string | null;
          p_ends_on?: string | null;
        };
        Returns: SocialChallenge;
      };
      /** The third shape (0126) — the whole campfire ranked 1..N on one metric, paid by band. */
      create_placement_challenge: {
        Args: {
          p_circle_id: string;
          p_race_metric: SocialChallengeRaceMetric;
          p_window_hours: number;
          p_payout_xp?: number;
          p_public_name?: string | null;
          p_starts_on?: string | null;
          p_ends_on?: string | null;
        };
        Returns: SocialChallenge;
      };
      respond_to_h2h_challenge: { Args: { p_challenge_id: string; p_accept: boolean }; Returns: SocialChallenge };
      cancel_social_challenge: { Args: { p_challenge_id: string }; Returns: undefined };
      /** The settled standings (0111) — every racer's final figure, rank and what they were paid. */
      get_challenge_results: { Args: { p_challenge_id: string }; Returns: ChallengeResultRow[] };
      /** This viewer's own payout on a settled challenge (0116) — reads what grant_reward paid. */
      get_challenge_reward: { Args: { p_challenge_id: string }; Returns: ChallengeReward };
      /** Stamps the fire-once flag so the reveal never plays twice (0116). */
      mark_challenge_reward_seen: { Args: { p_challenge_id: string }; Returns: undefined };
      /** Pre-start or finished only; a live race is left to cancel/forfeit's consent path (0112). */
      delete_social_challenge: { Args: { p_challenge_id: string }; Returns: undefined };
      get_my_friends: {
        Args: Record<string, never>;
        Returns: {
          friend_id: string;
          display_name: string;
          avatar_url: string | null;
          tier: RankTierName;
          division: number;
          current_streak: number;
          last_lockin_at: string | null;
          shared_circle_id: string | null;
          shared_circle_name: string | null;
        }[];
      };
      nudge_to_lock_in: { Args: { p_user_id: string }; Returns: undefined };
      // The real friend graph (migration 0031_real_friend_graph.sql, PHILOI_UI_SPEC.md §4b/§16).
      search_people: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          user_id: string;
          display_name: string;
          handle: string | null;
          university: string | null;
          avatar_url: string | null;
          relationship: 'none' | 'requested' | 'incoming' | 'friends';
          mutual_circle_name: string | null;
        }[];
      };
      suggested_people: {
        Args: { p_limit?: number };
        Returns: {
          user_id: string;
          display_name: string;
          handle: string | null;
          avatar_url: string | null;
          mutual_circle_name: string | null;
        }[];
      };
      get_pending_friend_requests: {
        Args: Record<string, never>;
        Returns: {
          request_user_id: string;
          display_name: string;
          handle: string | null;
          avatar_url: string | null;
          direction: 'incoming' | 'sent';
          mutual_count: number;
          mutual_circle_name: string | null;
        }[];
      };
      send_friend_request: { Args: { p_user_id: string }; Returns: undefined };
      respond_friend_request: { Args: { p_user_id: string; p_accept: boolean }; Returns: undefined };
      cancel_friend_request: { Args: { p_user_id: string }; Returns: undefined };
      send_test_notification: { Args: Record<string, never>; Returns: undefined };
      dev_seed_my_demo_circle: { Args: Record<string, never>; Returns: Group };
      dev_simulate_friend_checkin: { Args: { p_group_id: string; p_fake_user_id: string }; Returns: undefined };
      dev_reset_my_checkins: { Args: { p_goal_type?: string | null }; Returns: undefined };
      log_challenge_progress: {
        Args: { p_challenge_id: string; p_amount: number; p_note?: string | null };
        Returns: (Challenge & { just_completed: boolean })[];
      };
      // get_challenge_leaderboard was dropped in 0059 — it ranked one campfire's members by
      // their goals of a type, and its only entry point was the goal↔campfire binding.
      request_challenge_change: {
        Args: { p_challenge_id: string; p_kind: ChallengeChangeKind; p_proposed?: ChallengeChangeProposal | null };
        Returns: ChallengeChangeRequest;
      };
      respond_to_challenge_change: {
        Args: { p_request_id: string; p_agree: boolean };
        Returns: ChallengeChangeRequest;
      };
      get_challenge_change_request: {
        Args: { p_request_id: string };
        Returns: ChallengeChangeRequestDetail | null;
      };
      get_open_challenge_change_request: {
        Args: { p_challenge_id: string };
        Returns: ChallengeChangeRequestDetail | null;
      };
      forfeit_social_challenge: { Args: { p_challenge_id: string }; Returns: undefined };
      credit_lockin_time_goals: { Args: { p_check_in_id: string }; Returns: number };
      // Handoff B — challenge v2 lifecycle (migration 0095). is_campfire_admin is A’s (0094).
      invite_challenge_members: { Args: { p_challenge: string; p_user_ids: string[] }; Returns: number };
      respond_to_challenge_invite: { Args: { p_challenge: string; p_accept: boolean }; Returns: undefined };
      start_challenge: { Args: { p_challenge: string }; Returns: undefined };
      is_campfire_admin: { Args: { p_group_id: string; p_user_id?: string }; Returns: boolean };
      get_my_notifications: { Args: { p_limit?: number }; Returns: NotificationEvent[] };
      get_journal: { Args: { p_user: string; p_limit?: number }; Returns: JournalEntry[] };
      set_journal_note: { Args: { p_entry_key: string; p_note: string | null }; Returns: undefined };
      set_journal_hidden: { Args: { p_entry_key: string; p_hidden: boolean }; Returns: undefined };
      set_my_bio: { Args: { p_bio: string | null }; Returns: string | null };
      get_trophy_hall: { Args: { p_user: string }; Returns: TrophyHall };
      get_my_milestone_effort: { Args: Record<string, never>; Returns: MilestoneEffort };
      /** 🔒 Content insert only — grants no XP, embers or rank (migration 0093). */
      create_milestone: {
        Args: {
          p_kind: MilestoneKind;
          p_headline: string;
          p_note?: string | null;
          p_visibility?: MilestoneVisibility;
          p_effort_keys?: EffortKey[];
          p_pinned?: boolean;
        };
        Returns: string;
      };
      delete_milestone: { Args: { p_id: string }; Returns: undefined };
      get_milestones: { Args: { p_user: string; p_limit?: number }; Returns: Milestone[] };
      get_milestone: { Args: { p_id: string }; Returns: MilestoneDetail | null };
      cheer_milestone: { Args: { p_milestone_id: string }; Returns: number };
      get_public_collection: { Args: { p_user: string }; Returns: PublicCollection };
      set_profile_item_hidden: {
        Args: { p_kind: HideableKind; p_key: string; p_hidden: boolean };
        Returns: undefined;
      };
      get_unread_notification_count: { Args: Record<string, never>; Returns: number };
      mark_notifications_read: { Args: Record<string, never>; Returns: number };
      /** Banks a completed personal goal's embers for one LOCAL day (migration 0085). Difficulty
       * and streak are derived server-side; only the goal and the device's calendar date go in. */
      economy_award_goal_day: {
        Args: { p_goal_id: string; p_local_day: string };
        Returns: {
          already_awarded: boolean;
          embers: number;
          milestone: number;
          box: string | null;
          streak: number;
          difficulty: string;
          capped: boolean;
        };
      };
      update_group_challenge_terms: {
        Args: { p_challenge_id: string; p_target_count?: number | null; p_window_hours?: number | null };
        Returns: SocialChallenge;
      };
      get_my_circle_ranks: { Args: Record<string, never>; Returns: MyCircleRank[] };
      get_my_cross_circle_people: { Args: Record<string, never>; Returns: CrossCirclePerson[] };
      get_university_totals: { Args: { p_limit?: number }; Returns: UniversityTotal[] };
      get_my_ranks: { Args: Record<string, never>; Returns: MyRank[] };
      start_lock_in_session: {
        Args: { p_goal_type: string; p_goal_detail?: string | null; p_circle_id?: string | null };
        Returns: LockInSession;
      };
      confirm_lock_in_session: { Args: { p_session_id: string }; Returns: undefined };
      stop_lock_in_session: {
        Args: {
          p_session_id: string;
          p_photo_urls?: string[] | null;
          p_caption?: string | null;
          p_workout_sets?: WorkoutSetEntry[] | null;
        };
        Returns: CheckIn;
      };
      post_check_in_to_circle: { Args: { p_check_in_id: string; p_circle_id: string }; Returns: undefined };
      // Gym tracker (migration 0037, PHILOI_UI_SPEC.md §23).
      save_routine: { Args: { p_name: string; p_exercise_ids: string[]; p_routine_id?: string | null }; Returns: Routine };
      save_workout_as_routine: { Args: { p_workout_id: string; p_name: string }; Returns: Routine };
      start_workout: {
        Args: { p_session_id: string; p_routine_id?: string | null; p_energy?: WorkoutEnergy };
        Returns: Workout;
      };
      add_workout_exercise: {
        Args: { p_workout_id: string; p_exercise_id: string };
        Returns: { id: string; workout_id: string; exercise_id: string; name: string; position: number; created_at: string };
      };
      replace_workout_exercise: {
        Args: { p_workout_exercise_id: string; p_exercise_id: string };
        Returns: { id: string; workout_id: string; exercise_id: string; name: string; position: number; created_at: string };
      };
      remove_workout_exercise: { Args: { p_workout_exercise_id: string }; Returns: undefined };
      reorder_workout_exercises: { Args: { p_workout_id: string; p_ordered_ids: string[] }; Returns: undefined };
      log_workout_set: {
        Args: { p_workout_exercise_id: string; p_weight: number | null; p_reps: number };
        Returns: WorkoutSet;
      };
      delete_workout_set: { Args: { p_set_id: string }; Returns: undefined };
      /** Null when nothing is in progress. */
      get_active_workout: { Args: Record<string, never>; Returns: ActiveWorkout | null };
      /** Null when that check-in wasn't a tracked gym session. */
      get_workout_recap: { Args: { p_check_in_id: string }; Returns: WorkoutRecap | null };
      // Gym tracker phase-2 — video clips (migration 0047, PHILOI_UI_SPEC.md §23).
      get_gym_clip_quota: {
        Args: { p_user_id?: string | null };
        Returns: { tier: 'free' | 'paid'; used_this_month: number; clip_limit: number | null; remaining: number | null }[];
      };
      attach_workout_set_clip: {
        Args: { p_workout_set_id: string; p_video_key: string; p_thumb_key: string; p_duration_s: number; p_resolution: string };
        Returns: WorkoutSet;
      };
      remove_workout_set_clip: { Args: { p_workout_set_id: string }; Returns: undefined };
      get_check_in_clips: { Args: { p_check_in_id: string }; Returns: WorkoutSet[] };
      get_my_campfire_heat: { Args: Record<string, never>; Returns: { group_id: string; heat: number }[] };
      get_campfire_level: {
        Args: { p_group_id: string };
        Returns: { group_id: string; xp: number; level: number; xp_into_level: number; xp_for_next_level: number }[];
      };
      get_my_strava_connection_status: {
        Args: Record<string, never>;
        Returns: { connected: boolean; athlete_id: number | null }[];
      };
      disconnect_my_strava: { Args: Record<string, never>; Returns: undefined };
      get_my_whoop_connection_status: {
        Args: Record<string, never>;
        Returns: { connected: boolean; granted_scopes: string }[];
      };
      disconnect_my_whoop: { Args: Record<string, never>; Returns: undefined };
      /** Read-only Google Calendar grant (migration 0105). Never returns the token — the app
       * only ever learns THAT a calendar is linked and which Google account it is. */
      get_my_google_calendar_status: {
        Args: Record<string, never>;
        Returns: { connected: boolean; account_email: string | null; linked_at: string | null }[];
      };
      /** Local-only disconnect. The app's normal path is the gcal-disconnect Edge Function, which
       * also revokes at Google; this is its fallback (see src/lib/google-calendar.ts). */
      disconnect_my_google_calendar: { Args: Record<string, never>; Returns: undefined };
      /** Credits study_hours / gym_visits from qualifying lock-ins (migration 0068). */
      sync_challenge_from_lock_ins: { Args: { p_challenge_id: string }; Returns: number };

      // ── Cindy (migration 0101) ──
      // The one read the coach makes. auth.uid()-scoped with no user parameter, so it is not
      // possible to ask it for anybody else's context. Returns one jsonb document rather than a
      // row set — a RETURNS TABLE column list would shadow same-named columns in the body.
      get_coach_context: { Args: Record<string, never>; Returns: Record<string, unknown> };
      get_my_coach_usage: {
        Args: Record<string, never>;
        Returns: { text_calls: number; bubble_calls: number; voice_seconds: number };
      };

      // ── Reward economy / inventory (migration 0064, Step 21) ──
      // Every mutation below is a security-definer RPC because the client is never allowed to
      // write inventory or compute a reward (REWARD_ECONOMY §0.4). There is no matching Tables
      // entry for ember_wallet et al on purpose: the only supported read is get_inventory().
      get_inventory: { Args: Record<string, never>; Returns: EconomyInventory };
      /**
       * p_pool is a rarity -> candidate-item-ids MAP, not a flat list (migration 0069). The server
       * rolls the rarity and picks from that bucket; a flat array let it pick across every tier and
       * label the result with a rarity the item didn't have.
       */
      open_loot_box: {
        Args: { p_box_id: string; p_pool: Record<string, string[]> };
        Returns: EconomyOpenResult;
      };
      buy_loot_box: { Args: { p_box_key: string }; Returns: string };
      buy_cosmetic: {
        Args: { p_key: string; p_slot: string | null; p_rarity: string };
        Returns: { cosmetic_key: string; spent: number };
      };
      equip_cosmetic: { Args: { p_key: string; p_slot: string | null }; Returns: undefined };
      /** Keyed by SLOT since migration 0070 — one item can occupy several slots, so a key alone
       * no longer identifies what to clear. */
      unequip_cosmetic: { Args: { p_slot: string }; Returns: undefined };
      salvage_cosmetic: { Args: { p_key: string; p_rarity: string }; Returns: { embers: number } };
      credit_pass_xp: { Args: { p_achievement: string; p_xp: number; p_period: string }; Returns: number };
      /** Live counters for the progress-style achievements (migration 0065). */
      get_pass_achievement_progress: { Args: Record<string, never>; Returns: Record<string, number> };
      /** Equipped cosmetics for OTHER users — keys only, nothing sellable or private. */
      get_public_loadouts: {
        Args: { p_user_ids: string[] };
        Returns: {
          user_id: string;
          slot: string;
          cosmetic_key: string;
          rarity_override: string | null;
          season_stamp: string | null;
        }[];
      };
      claim_pass_tier: {
        Args: {
          p_tier: number;
          p_lane: 'free' | 'premium';
          p_kind: string;
          p_embers: number | null;
          p_box_key: string | null;
          p_item_key: string | null;
          p_item_rarity: string | null;
          p_item_slot: string | null;
        };
        Returns: { tier: number; lane: string; kind: string };
      };
      /**
       * Bundle claim (migration 0074). Supersedes claim_pass_tier, which stays declared above only
       * for the rollout window — a level can carry more than one reward and the old single-reward
       * signature could not grant both without tripping the unique claim index.
       */
      claim_pass_level: {
        Args: {
          p_level: number;
          p_lane: 'free' | 'premium';
          p_rewards: {
            kind: string;
            embers: number | null;
            box_key: string | null;
            item_key: string | null;
            item_rarity: string | null;
            item_slot: string | null;
          }[];
        };
        Returns: { level: number; lane: string; granted: number };
      };
      season_phase: {
        Args: Record<string, never>;
        Returns: string;
      };
      grant_season_placement_rewards: {
        Args: { p_season: string | null; p_dry_run: boolean };
        Returns: { university: string; ranked: number; granted: number }[];
      };
      reconcile_my_forge_pass: {
        Args: Record<string, never>;
        Returns: { changed: boolean; owns_premium: boolean; reason?: string };
      };
      get_my_season_standing: {
        Args: { p_season: string | null };
        Returns: {
          season_id: string;
          university: string;
          rank: number;
          board_size: number;
          pass_xp: number;
          pass_level: number;
          percentile: number;
        } | null;
      };

      // ── AGENT 1 · LOGIC — relic feeder RPCs (migration 0119). Appended; nothing above moved. ──
      get_my_relic_progress: {
        Args: Record<string, never>;
        Returns: {
          relic_key: string;
          family: string;
          unit: string;
          value: number;
          tier: number;
          max_tier: number;
          rarity: string | null;
          next_threshold: number | null;
        }[];
      };
      set_my_height_cm: {
        Args: { p_height_cm: number };
        Returns: void;
      };
      record_step_days: {
        /** [{ day: 'YYYY-MM-DD', steps, source? }] — one TOTAL per local day. See StepDayInput. */
        Args: { p_days: { day: string; steps: number; source?: string }[] };
        Returns: number;
      };

      // ── THE AGORA (AGORA_SPEC.md, migrations 0128-0130) — appended block ──
      //
      // Note what these signatures do NOT accept: no title, subtitle or rarity anywhere. The
      // composer sends WHICH achievement (kind + ref id or catalog key) and the server looks up
      // what it says. That asymmetry is the feature — see agora_attachment_snapshot in 0130.
      get_agora_feed: {
        Args: {
          p_scope: AgoraScope;
          p_before_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number;
        };
        Returns: AgoraItem[];
      };
      get_agora_item: {
        Args: { p_id: string; p_item_type?: AgoraItem['item_type'] };
        Returns: AgoraItem | null;
      };
      create_agora_post: {
        Args: {
          p_body?: string | null;
          p_photo_path?: string | null;
          p_visibility?: AgoraVisibility;
          p_attach_kind?: AgoraAttachKind | null;
          p_attach_ref_id?: string | null;
          p_attach_key?: string | null;
        };
        Returns: string;
      };
      /**
       * Returns the deleted post's photo path. Informational only — 0131's after-delete trigger
       * has already dropped the storage object by the time this returns, on this path and on the
       * two that never call this function (moderation, account cascade).
       */
      delete_agora_post: { Args: { p_id: string }; Returns: string | null };
      cheer_agora_post: { Args: { p_post_id: string }; Returns: number };
      add_agora_comment: {
        Args: { p_post_id: string | null; p_milestone_id: string | null; p_body: string };
        Returns: string;
      };
      get_agora_comments: {
        Args: { p_post_id: string | null; p_milestone_id: string | null; p_limit?: number };
        Returns: AgoraComment[];
      };
      delete_agora_comment: { Args: { p_id: string }; Returns: undefined };
      get_agora_achievements: { Args: Record<string, never>; Returns: AgoraAchievement[] };
      get_agora_lockins: { Args: { p_limit?: number }; Returns: AgoraLockIn[] };
      set_milestone_in_agora: { Args: { p_id: string; p_in_agora: boolean }; Returns: undefined };
    };
  };
};

/** Shape of get_inventory()'s single jsonb payload — see migration 0064. */
export type EconomyInventory = {
  embers: number;
  cosmetics: {
    id: string;
    cosmetic_key: string;
    slot: string | null;
    source: 'earned' | 'paid' | 'box' | 'forge_pass';
    provenance: string | null;
    equipped: boolean;
    acquired_at: string;
    /** 21j placement grants override the catalog rarity — a Global Top 1% outranks a campus one. */
    rarity_override: string | null;
    /** "🌍 GLOBAL #1 · S1" — rendered beside the title name. */
    season_stamp: string | null;
  }[];
  badges: {
    id: string;
    badge_key: string;
    source: 'earned' | 'paid' | 'box' | 'forge_pass';
    provenance: string | null;
    equipped: boolean;
    earned_at: string;
  }[];
  boxes: {
    id: string;
    box_key: string;
    obtained_via: 'challenge' | 'season' | 'forge_pass' | 'purchase' | 'promo';
    provenance: string | null;
  }[];
  pass: {
    season_id: string;
    pass_xp: number;
    owns_premium: boolean;
    claims: { tier: number; lane: 'free' | 'premium' }[];
    achievements: { key: string; period_key: string; xp: number }[];
  };
};

/** A box result the SERVER already decided — the animation only visualizes it (§8.5). */
export type EconomyOpenResult = {
  cosmetic_key: string;
  rarity: string;
  dupe: boolean;
  embers: number;
  box_key: string;
  rolled_rarity: string;
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// AGENT 1 · LOGIC — relic progress feeder (migrations 0119–0123).
// Appended block. Nothing above this line is touched; the integrator unions this with the other
// agents' blocks.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The four discipline-relic ladders (ITEM_CATALOG §4a-2). Matches `relic_ladders.family`. */
export type RelicFamilyKey = 'volume' | 'distance' | 'study' | 'deep_work' | 'meditate';

/**
 * One row of get_my_relic_progress() — where a discipline relic stands and what the next rung
 * costs. Returned for every ladder, including ones the user has not started (tier 0, value 0).
 */
export type RelicProgressRow = {
  relic_key: string;
  family: RelicFamilyKey;
  /** Suffix for the threshold: 'lb' | 'km' | 'h'. */
  unit: string;
  /** Lifetime total in `unit`. The numerator of "43 / 50 km". */
  value: number;
  /** Rung held, 1-based. 0 = not yet earned, so no relic and no Greek glyph. */
  tier: number;
  /** How many rungs this ladder has — 5 for Gym, 4 for the rest. */
  max_tier: number;
  /** The rarity of the rung currently held; null at tier 0. */
  rarity: string | null;
  /** The next rung's threshold, or null when the top rung is already held. */
  next_threshold: number | null;
};

/**
 * One day of steps for record_step_days(). `day` is the DEVICE's local calendar date as
 * 'YYYY-MM-DD' — not a UTC instant, for the same reason migration 0084 rolls daily goals at local
 * midnight. `steps` is the day's TOTAL, never a delta: the server keeps the larger of what it has
 * and what arrives, which is what makes a re-sync safe.
 */
export type StepDayInput = {
  day: string;
  steps: number;
  source?: 'device' | 'healthkit' | 'health_connect' | 'manual';
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE AGORA (AGORA_SPEC.md, migrations 0128-0130, mocks 160 + 162) — appended block.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The feed's reach dials. Narrowest → widest, the order the chips render in. */
export type AgoraScope = 'friends' | 'campfires' | 'university' | 'global';

/**
 * A post's audience — the MILESTONE vocabulary (0093), deliberately reused rather than invented.
 * `can_see_agora` is a thin wrapper over `can_see_milestone_for` for exactly this reason: one
 * friends/campus/public rule, in one place, for both row types.
 *
 * Not the same axis as AgoraScope. A scope is "whose posts am I looking at right now"; a
 * visibility is "who may ever see mine", and it travels with the post forever.
 */
export type AgoraVisibility = 'friends' | 'campus' | 'public';

/** What a post can carry (mock 162 panels 4-5), plus the milestone rows the feed folds in. */
export type AgoraAttachKind = 'milestone' | 'lockin' | 'rank' | 'streak' | 'pass' | 'cosmetic' | 'pr';

/**
 * The frozen attachment, as `agora_attachment_snapshot` wrote it at post time.
 *
 * FACTS, NOT DISPLAY STRINGS — `rank_index` rather than "Hero II", `pass_xp` rather than
 * "Level 42", `cosmetic_key` rather than "Atlas' Burden". The names live client-side in the
 * catalog / rank-tiers / forge-pass modules that already own them, so there is exactly one
 * spelling of every item; the server owns the number, which is the half that could be faked.
 *
 * A partial rather than a discriminated union keyed off `attach_kind`: the shape genuinely varies
 * per kind, but the renderer switches on `attach_kind` anyway and a union here would force a cast
 * at every one of those branches for no extra safety.
 */
export type AgoraAttachSnapshot = {
  // milestone
  milestone_id?: string;
  kind?: MilestoneKind;
  headline?: string;
  note?: string | null;
  effort?: MilestoneEffort;
  // lockin
  check_in_id?: string;
  goal_type?: string | null;
  goal_label?: string | null;
  goal_detail?: string | null;
  duration_seconds?: number | null;
  distance_m?: number | null;
  completed_at?: string;
  // rank
  rank_index?: number;
  tier?: string;
  division?: number;
  // streak
  days?: number;
  longest?: number;
  // pass
  season_id?: string;
  pass_xp?: number;
  owns_premium?: boolean;
  // cosmetic
  cosmetic_key?: string;
  slot?: string | null;
  source?: string;
  provenance?: string | null;
  rarity_override?: string | null;
  season_stamp?: string | null;
  acquired_at?: string;
  // pr
  exercise?: string;
  weight?: number;
  reps?: number;
  e1rm?: number;
  achieved_at?: string;
};

/** One card in the square — a freeform post, or a milestone that auto-surfaced into it. */
export type AgoraItem = {
  item_type: 'post' | 'milestone';
  id: string;
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  university: string | null;
  /**
   * The author's standing, resolved server-side against rank_thresholds. Both null until they
   * have ranked at all, and the card's "· Hero II" line simply drops.
   */
  rank_tier: RankTierName | null;
  rank_division: number | null;
  visibility: AgoraVisibility;
  body: string | null;
  /** Storage path in the public `agora-photos` bucket. Resolve with agoraPhotoUrl(). */
  photo_path: string | null;
  attach_kind: AgoraAttachKind | null;
  attach_snapshot: AgoraAttachSnapshot;
  cheers: number;
  cheered: boolean;
  comments: number;
  created_at: string;
};

/** The keyset cursor. Both halves, because two posts can share a millisecond. */
export type AgoraCursor = { created_at: string; id: string };

export type AgoraComment = {
  id: string;
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  body: string;
  is_mine: boolean;
  created_at: string;
};

/** A row in the achievement picker. `facts` is the same jsonb the post would freeze. */
export type AgoraAchievement = {
  kind: AgoraAttachKind;
  ref_id: string | null;
  item_key: string | null;
  section: 'standing' | 'collectibles' | 'milestones' | 'fitness';
  facts: AgoraAttachSnapshot;
  sort_at: string | null;
};

export type AgoraLockIn = {
  id: string;
  goal_type: string | null;
  goal_label: string | null;
  goal_detail: string | null;
  duration_seconds: number | null;
  distance_m: number | null;
  completed_at: string;
};
