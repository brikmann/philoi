// social_media stays for historical rows' typing — the lock-in goal picker (PHILOI_UI_SPEC.md
// §12) doesn't offer it, only gym/run/study/job_applications/read/custom.
export type GoalType = 'gym' | 'run' | 'study' | 'social_media' | 'custom' | 'job_applications' | 'read';
// Campfire membership roles (migration 0094, CAMPFIRE_REDESIGN_SPEC.md §Phase 2). 'admin' is
// the CAPABILITY tier and 'owner' is a subset of it — every "may this person manage the campfire?"
// question is `role !== 'member'` (or is_campfire_admin() server-side), never `=== 'owner'`. The
// one thing still reserved to the owner alone is DELETE, plus handing out the role itself.
export type MemberRole = 'owner' | 'admin' | 'member';
// What a silent nudge actually did (migration 0172). Before it, ping_campfire_member returned
// void and BOTH of its non-delivery paths were silent — the 10-minute rate limit returned having
// done nothing, and a recipient with no registered device looked identical to a delivered push —
// so the sheet showed "nudged" either way. That is the whole of "the ping does fuck all".
//   'sent'         — bell row written and a push dispatched to a real device.
//   'sent_no_push' — bell row written, nothing buzzed: no device, notifications off, quiet hours.
//   'rate_limited' — already nudged this person in this campfire within ten minutes.
export type PingResult = 'sent' | 'sent_no_push' | 'rate_limited';
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
   * the profiles_reset_uni_verification trigger when someone changes school.
   *
   * At most ONE profile can hold a given address with this flag set — a partial unique index on
   * `lower(university_email) where university_email_verified` (migration 0136). Before that, one
   * campus inbox verified an unlimited number of accounts. */
  university_email_verified: boolean;
  /** Centimetres, collected by onboarding's optional height step (design-mocks/128) and written
   * through `set_my_height_cm` (migration 0119). Null for anyone who skipped it, which is a
   * supported state: `stride_m_for` then falls back to a 0.75 m adult-average stride, so the only
   * cost is precision on the steps→distance relic ladder. `numeric` server-side, so PostgREST can
   * hand it back as a string — coerce before doing arithmetic on it. */
  height_cm: number | null;
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
  /**
   * PRIVATE MODE (0170). Only accepted friends can see this user's competitive numbers: off every
   * board and out of search for a non-friend, "Rank muted" on their profile, "Anonymous" at the
   * bottom of a challenge's standings.
   *
   * Optional because a client can be newer than the database it is talking to — runtimeVersion is
   * still sdkVersion-pinned, so OTA cannot reach older installs and the two do not land together.
   * Absent reads as false, which is the pre-0170 behaviour.
   */
  leaderboard_private?: boolean;
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

/**
 * A relic in the hall, with its ladder standing when it rides one (migration 0143).
 *
 * `family` is the discriminator, not `in_progress`: medals and the secret Greek relics ride no
 * ladder and come back with family null, so "is this a rung or a trophy" is one null check rather
 * than a second list of keys the client would have to keep in step with `relic_ladders`.
 *
 * `in_progress` is the earned/unearned line. A ladder below its first threshold has real progress
 * but no grant — it is in this array so the profile can draw "3.3 / 10 h", and it must stay out of
 * the featured strip and out of the "has this person earned anything" test, both of which are
 * earned-only by design (§4).
 */
export type HallRelic = HallTrophy & {
  /** For an in-progress ladder this is relic_progress.updated_at — "last moved", not "earned at". */
  acquired_at: string;
  /** The ladder this relic rides, or null for a medal or a secret relic. */
  family: RelicFamilyKey | null;
  /** Suffix for the numbers: 'lb' | 'km' | 'h'. Null off-ladder. */
  unit: string | null;
  /** Lifetime total in `unit` — the numerator of "43 / 50 km". Null off-ladder. */
  value: number | null;
  /** Rung held, 1-based. 0 while the first threshold is still ahead. Null off-ladder. */
  tier: number | null;
  /** How many rungs the ladder has — 5 for Gym, 4 for the rest. Null off-ladder. */
  max_tier: number | null;
  /** The next rung's threshold, or null at the top rung and off-ladder. */
  next_threshold: number | null;
  /** True when the ladder has progress but has not been granted yet. Never true for a medal. */
  in_progress: boolean;
};

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
  /** Null when the message is a bare attachment — posting a photo with no caption is the normal
   *  case, so migration 0158 stopped requiring text. */
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  // ── attachments (migration 0158) ──
  // Three nullable columns rather than a child table: a chat message carries at most ONE thing,
  // unlike an Agora post which carries up to one of each kind. The legal combinations are enforced
  // by the messages_attachment_shape CHECK, not by this type.
  /** 'photo' | 'lockin' | 'challenge' | null. */
  attach_kind: string | null;
  /** Storage key in the campfire-photos bucket. Photo only; always starts with the author's id. */
  attach_path: string | null;
  /** A check_ins.id being re-posted into the chat, or — on a 'challenge' card (0162) — the
   *  social_challenges.id of a campfire-hosted challenge, which is what the Join CTA acts on. */
  attach_ref_id: string | null;
  /**
   * Which system event this row announces (0163). Non-null exactly when attach_kind is 'system',
   * and the only value today is 'member_joined'.
   *
   * A system row carries no body ON PURPOSE: the sentence is the client's to write, so an old
   * build renders nothing rather than something stale, and the wording can change without a
   * migration. Anything the renderer doesn't recognise is skipped for the same reason.
   */
  system_event: string | null;
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
  // The Forge (migration 0138). Carries the rungs and the dupe flag, never a balance — a rising
  // dupe rate at a tier is the signal that the pool at that tier is too small, which is the one
  // question this feature can go wrong on.
  | 'forge_combined'
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
  | 'goal_scoped'
  | 'challenge_created'
  | 'challenge_completed'
  // 0145's grade races: who reports a mark, and who takes Cindy's door into the create screen
  // rather than the form (mock 143's two paths — worth knowing which one people actually use).
  | 'challenge_grade_reported'
  | 'cindy_challenge_entry_opened'
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
  | 'leaderboard_private_changed'
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
  // The campfire chat's + menu (mock 101). No target user id — who was nudged is not analytics'
  // business, only that the affordance is used.
  | 'campfire_member_pinged'
  // The reward reveal (0116). The pair is the funnel that matters: `seen` counts settled races
  // where the payout was actually announced, `shared` how many of those were worth advertising.
  // A gap between them and the standings-block Share is doing nothing.
  | 'challenge_reward_seen'
  | 'challenge_result_shared'
  // ─── Agent 2 / challenge v2 (0124-0127) ───
  // The third leg of that funnel: how many announced boxes were actually opened from the reveal.
  // Before 0125 this was unmeasurable because the CTA could not be rendered at all.
  | 'challenge_reward_box_opened'
  // ─── the personal-goal completion reveal (0167) ───
  // The pair that says whether the scoped-goal payout is actually being seen. Before 0167 the
  // grant fired with no surface at all, so both of these were unmeasurable — and the first one is
  // the number that says whether Cindy scoping and goal vouching feel like they pay.
  | 'goal_reward_seen'
  | 'goal_reward_box_opened'
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
  // Whether the inline "How am I doing?" answer actually landed. A boolean `ok` and nothing else —
  // the question is fixed and her answer is session content, so neither is worth logging.
  | 'cindy_lockin_status_result'
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
  /** 'Anonymous' when `is_anonymous` — the real display name is never sent (0170 §3). */
  member_name: string;
  /**
   * A count of qualifying lock-ins for a collective goal; the racer's metric score net of their
   * baseline for a placement race (0126). Two meanings behind one name because the screen renders
   * one list either way — `shape` is what says which.
   *
   * NULL for an anonymous racer (0170 §3): their position in the race is exactly the thing being
   * withheld. Render them at the bottom with no figure, not as a 0 — a 0 is a claim about where
   * they stand, and the whole point is that you do not know.
   */
  member_progress: number | null;
  /**
   * PRIVATE MODE (0170 §3). This racer is in the field but hidden: Private mode is on and the
   * viewer is not their friend. Their name reads "Anonymous", their progress and live status are
   * null, and they sort to the bottom of the board.
   *
   * 🔴 A DISPLAY FLAG ONLY. Settlement ranks and pays on the real numbers — an anonymous racer can
   * win, and does get paid. Never feed this into anything that scores.
   */
  is_anonymous: boolean;
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
/**
 * A goal's cadence.
 *
 * 'once' (0155) is a SINGLE non-recurring target — "run a half marathon", "1000 push-ups". It has
 * one window, opened at creation and never closed: roll_over_challenges enumerates 'day' and
 * 'week' positively, so a one-time goal is never rolled, never archived and never zeroed, and once
 * it completes it stays completed.
 */
export type ChallengePeriod = 'day' | 'week' | 'once';
export type ChallengeVisibility = 'circle' | 'private';

// An individual goal. NOT bound to a campfire (migration 0059) — a goal is the user's own, and
// sharing the work behind it is chosen per lock-in on the done screen, which can post to several
// circles at once. `visibility` survives only for rows written before that change.
/** How a custom goal is measured (migration 0061, design-mocks/74). Built-in metrics are always
 * 'manual' here — each has its own real source, or none at all. */
export type ChallengeCountMode = 'manual' | 'lockin_time';

/** The six difficulty tiers Cindy scopes a described feat into (DIFFICULTY_SCOPING.md's grid). */
export type DifficultyTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

/**
 * How the app learns the feat was done. DERIVED SERVER-SIDE and never sent by the client — `auto`
 * is the only path to the top three boxes, so letting a client claim it would be the mint hole the
 * whole scoping design exists to keep shut (migration 0160).
 */
export type GoalVerifiability = 'auto' | 'honor';

/**
 * How the app learned the feat was done, once a claim settles (0164).
 *
 * The spec's gradient is Auto > Vouched > Unvouched. 'vouched' pays the same BAND as 'auto' — the
 * −10%/−20% currency trim that should separate them is still deferred (it needs a signature change
 * to grant_reward; see 0159's header) — so today the gradient is expressed in boxes, which is the
 * part that gates minting.
 */
export type GoalClaimLevel = 'auto' | 'honor' | 'vouched';

/** What claim_goal_complete returns. `pending_vouch` is the only state that has not paid yet. */
export type GoalClaimResult = {
  state: 'resolved' | 'pending_vouch';
  level: GoalClaimLevel;
  /** How many friends were asked. 0 when nobody was, which is the only resolved path (0165). */
  asked: number;
  has_proof?: boolean;
  /** ISO. Only on pending_vouch. */
  deadline?: string;
};

/** What the vouch prompt reads (get_vouch_request). */
export type VouchRequest = {
  goal_id: string;
  label: string | null;
  tier: DifficultyTier | null;
  claimant: string;
  claimant_avatar: string | null;
  claimed_at: string;
  deadline: string | null;
  /** 0165 — the claimant's live-recorded clip, shown to the voucher. A social signal, not proof:
   *  it never settles anything on its own, it just means the yes is informed. */
  proof_path: string | null;
  settled: boolean;
  expired: boolean;
  /** You cannot vouch for yourself — the screen shows a read-only state instead. */
  is_mine: boolean;
  /** Your own prior answer, or null if you have not answered. */
  my_verdict: boolean | null;
  /** Counting vouches so far, out of the two needed. */
  vouches: number;
};

/** One person on a claim's roster (get_claim_status). `answered` is null while they have not
 *  replied, which is what frame C's "· asked" chip renders. */
export type ClaimVoucher = {
  id: string;
  name: string;
  avatar: string | null;
  /** null = asked, no answer yet. true = vouched. false = "Nah". */
  answered: boolean | null;
  /** Whether an anti-collusion rule let this one count toward the two. */
  counted: boolean;
};

/**
 * The claimant's own view of a pending claim (get_claim_status, 0165) — mock 176 frame C.
 *
 * The owner's half of the pair. get_vouch_request is deliberately open to anyone holding the link;
 * this one names who was asked and how each answered, so it is owner-only.
 */
export type ClaimStatus = {
  goal_id: string;
  label: string | null;
  tier: DifficultyTier | null;
  claimed_at: string | null;
  deadline: string | null;
  proof_path: string | null;
  settled: boolean;
  /** Before settlement this is always the floor — a pending claim already holds the honour band
   *  and can only go up. */
  level: GoalClaimLevel | null;
  vouches: number;
  needed: number;
  asked: ClaimVoucher[];
};

/** What preview_challenge_reward / set_goal_scope hand back — the SERVER's figure, not Cindy's. */
export type ScopedRewardPreview = {
  tier: DifficultyTier;
  /** The band the feat is worth. */
  achievement_band: string;
  /** The band it will actually pay, after the verifiability discount. */
  paid_band: string | null;
  discounted: boolean;
  /** The box key it pays, or null for a tier that pays embers only. */
  box: string | null;
  embers: number;
  drip: number;
  significance: number;
  verifiability: GoalVerifiability;
};

/** What host_campfire_challenge hands back (0162) — the receipt for one transaction that created
 *  the race, enrolled the host, scoped it, notified the fire and posted the chat card. */
export type HostedCampfireChallenge = {
  challenge_id: string;
  circle_id: string;
  circle_name: string;
  name: string;
  /** The plural noun being counted — "pushups". */
  metric: string;
  target: number;
  /** The chat card's message id. */
  message_id: string;
  /** How many campfire members the bell/push went to. */
  notified: number;
  /** Null when Cindy proposed no tier — the challenge is created, just unscoped. */
  preview: ScopedRewardPreview | null;
};

export type Challenge = {
  id: string;
  user_id: string;
  type: ChallengeType;
  count_mode: ChallengeCountMode;
  /** Null on every goal created before scoping existed — which keeps its legacy payout (0159). */
  difficulty_tier?: DifficultyTier | null;
  verifiability?: GoalVerifiability | null;
  /**
   * Set when this goal was MINTED for a campfire challenge — the ⚡ "created for a challenge" aura
   * (0162). Null on a goal the user already had and a challenge adopted, which is the honest
   * distinction: a goal you already kept was not created for anything.
   *
   * It also silences the goal's own completion box (economy_on_challenge_completed), so one set of
   * reps pays once — through the challenge, not twice.
   */
  challenge_source_id?: string | null;
  /** 0164 — when the owner said they did it. NOT completion: a claim awaiting friends sits here
   *  with completed_at still null, which is what keeps the payout to exactly one grant. */
  claimed_at?: string | null;
  /** 0164 — storage key of the proof photo, if one was attached. */
  proof_path?: string | null;
  /** 0164 — when the 48h vouch window closes. */
  vouch_deadline?: string | null;
  label: string | null;
  target: number;
  unit: string;
  period: ChallengePeriod;
  progress: number;
  visibility: ChallengeVisibility;
  period_start: string;
  completed_at: string | null;
  /**
   * Set when this goal was collapsed as a duplicate of another reading the same source (0156).
   *
   * A retired goal is FROZEN, not merely hidden: a trigger holds its progress and completed_at at
   * the values they had, so it accrues nothing from any feeder and can never complete — which is
   * what stops a collapsed duplicate paying a second drip off the one effort it was collapsed for.
   * fetchMyChallenges filters these out; nothing else should have to think about them.
   */
  retired_at: string | null;
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
/** 'grade' (0145) is the odd one out and the type cannot say so: the other four accumulate and are
 *  observed, a grade is a single absolute mark the racer reports once. Anything that formats or
 *  settles a metric has to branch on it — see challenge-metric.ts and challenge_racer_score(). */
/** 'count' (0162) is the second odd one out. Like 'grade' it is not read from a source the app
 *  keeps centrally — each racer's number lives in their OWN personal goal (the mirror goal a
 *  campfire challenge adds to their lock-in menu), and challenge_racer_score reads it through
 *  campfire_challenge_goals. `count_unit` names what is being counted. */
export type SocialChallengeRaceMetric = 'lockin_time' | 'volume' | 'distance' | 'ai' | 'xp' | 'grade' | 'count';

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
/**
 * A campfire's LIVE challenge, read by circle rather than by roster (get_circle_active_challenges,
 * migration 0163).
 *
 * WHY THIS EXISTS ALONGSIDE SocialChallenge. That type is what get_my_social_challenges returns,
 * and that read is scoped to challenge_participants — "what am I rostered on". Under the opt-in
 * model a live campfire challenge deliberately has members who are NOT on its roster yet, and they
 * are precisely the people who need to see it: before 0163 the owner saw their own race and every
 * member who joined the fire afterwards saw an empty room. This is the other question — "what is
 * this fire running" — so it is a different row shape, with `i_am_in` as the whole point.
 */
export type CircleActiveChallenge = {
  id: string;
  circle_id: string;
  created_by: string;
  host_name: string;
  mode: SocialChallengeMode;
  shape: ChallengeShape | null;
  /** Only ever 'draft' | 'pending' | 'active' — the server filters to what is joinable. */
  status: SocialChallengeStatus;
  race_metric: SocialChallengeRaceMetric | null;
  count_unit: string | null;
  target_count: number | null;
  payout_xp: number;
  public_name: string | null;
  difficulty_tier: DifficultyTier | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  /** Accepted participants only — the number the strip means by "3 in". */
  participant_count: number;
  /** Am I on the roster? False is the interesting case: it is what puts a Join on the strip. */
  i_am_in: boolean;
};

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
  /** The mark to hit, as a percentage. Non-null exactly when race_metric is 'grade' — except on a
   *  placement board, where the ranking is the result and there is no bar to clear (0145). */
  grade_target: number | null;
  /** "KP451". Free text, and what makes the target mean anything. */
  course_code: string | null;
  /**
   * What a counted race counts — "pushups" (0162). Non-null exactly when race_metric is 'count'.
   *
   * ⚠️ OPTIONAL BECAUSE get_my_social_challenges DOES NOT SELECT IT YET. Widening that RPC means
   * restating a 4.8KB body AND changing its RETURNS TABLE shape, which under MIGRATIONS.md's
   * signature rule is a drop-and-recreate touching every reader — its own migration, not a rider
   * on this one. Nothing on the tab needs it meanwhile: host_campfire_challenge always writes a
   * public_name ("1000 pushups"), and challengeTitle prefers that over any derived label. The
   * count helpers in challenge-metric.ts are ready for it when the column arrives.
   */
  count_unit?: string | null;
  /**
   * 0169 · the bar for a collective goal measured in a real metric, in that metric's RAW units:
   * pounds for volume, METRES for distance. Non-null exactly when the bar is neither a lock-in
   * count nor a grade.
   *
   * ⚠️ OPTIONAL FOR THE SAME REASON count_unit IS — get_my_social_challenges does not select it
   * yet, and widening that RPC is a RETURNS TABLE change touching every reader. The tab does not
   * need it: create writes a public_name and challengeTitle prefers that.
   */
  target_value?: number | null;
  /** What THIS viewer has reported so far on a grade race. Null is "not in yet", which is a
   *  different thing from a reported 0 and has to render differently. */
  my_reported_value: number | null;
  /** This viewer's settled standing (0111 wrote these; 0145 is the first thing to select them).
   *  Null while the race is live, and on any row the viewer is not on the roster for. */
  my_final_rank: number | null;
  /** Stored top-is-1.0, matching every other standings writer. Invert for a "top N%" reading. */
  my_final_percentile: number | null;
  /**
   * WHAT THIS VIEWER WAS PAID (0154), so a settled challenge is a durable record and not only a
   * one-shot reveal.
   *
   * The LEDGER's XP, not `payout_xp`. Those are different numbers: payout_xp is the pot advertised
   * at creation, while a placement or collective finish is paid a fraction of it by band — so a
   * card printing the pot would tell a 4th-place finisher they earned the winner's XP. 0 until the
   * race settles.
   */
  my_awarded_xp: number;
  /** grant_reward's own receipt, stored at settlement. Null while live, and on a challenge that
   *  settled before its payload could be captured. */
  my_reward_payload: ChallengeRewardPayload | null;
};

/** One row of get_challenge_results() (0111) — the settled standings, read rather than
 * re-derived, so a result page cannot drift as later sessions land. */
export type ChallengeResultRow = {
  member_id: string;
  /** 'Anonymous' when `is_anonymous` (0170 §3). */
  member_name: string;
  score_value: number | null;
  place: number | null;
  percentile: number | null;
  /** Null for an anonymous racer — another person's payout is not the reader's business. */
  awarded_xp: number | null;
  /** The winner is ALWAYS named, even if private: a result of "somebody anonymous won" is not a
   *  result. Every other still-private racer stays anonymous (0170 §3). */
  is_winner: boolean;
  /** 0170 §3 — a still-private, non-winning racer. Name reads "Anonymous"; place, figure and
   *  payout are all withheld; sorted to the bottom by the RPC. */
  is_anonymous: boolean;
  /** What this racer's settlement paid beyond the XP — embers, a box, a badge (0154). Null on a
   *  race that settled before the payload was captured, and on the completion band. */
  reward: ChallengeRewardPayload | null;
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

/**
 * One row of get_my_unseen_challenge_rewards() (0137) — a settled challenge this user raced in and
 * has not been shown yet, plus everything the reveal needs to draw itself.
 *
 * `ChallengeReward`'s payout fields (placement/percentile/field_size/xp/payload) are here in the
 * same orientation, alongside the handful of challenge columns `challengeRewardResult()` reads. No
 * `seen_at`: the RPC only returns rows where it is null, so carrying it would be a field that is
 * always the same value.
 */
/**
 * What a rank-up paid — re-derived from the event's tiers against the same reward config the
 * trigger used. Presentation only; nothing reads this to grant.
 */
export type RankUpReward = {
  kind: 'division' | 'tier' | 'primordial';
  embers: number;
  box_key: string | null;
  to_tier: string;
  to_division: number;
  awarded_at: string;
};

export type UnseenChallengeReward = {
  challenge_id: string;
  public_name: string | null;
  shape: ChallengeShape | null;
  mode: SocialChallengeMode;
  race_metric: SocialChallengeRaceMetric | null;
  window_hours: number;
  opponent_id: string | null;
  opponent_name: string | null;
  created_by_name: string | null;
  /** When the race closed — the order two settlements landed in, so they are celebrated that way. */
  settled_at: string;
  placement: number | null;
  /** Stored orientation, as everywhere else: 1.0 is the TOP of the board. */
  percentile: number | null;
  field_size: number;
  xp: number;
  payload: ChallengeRewardPayload | null;
};

/**
 * grant_reward's receipt for a PERSONAL goal, captured by economy_on_challenge_completed (0167).
 *
 * The same shape as `ChallengeRewardPayload` — deliberately, so `buildRows` parses one format
 * whether the payout came from a settled duel or from a Cindy-scoped feat — plus the two facts the
 * trigger knows and grant_reward does not: which verification level the goal settled at, and the
 * tier it was scoped to.
 */
export type GoalRewardPayload = ChallengeRewardPayload & {
  /** The level the claim settled at, final by the time the grant fired (0164). */
  verifiability: GoalClaimLevel | null;
  tier: DifficultyTier | null;
  /** The ceiling goal_paid_band handed grant_reward. Equal to `band` unless the curve came in low. */
  max_band: string | null;
};

/**
 * One row of get_unseen_goal_rewards() (0167) — a personal goal this user finished whose payout
 * has never been shown.
 *
 * Only ONE-TIME and CLAIMED goals appear here; a recurring daily goal's payout belongs to the
 * drip reveal (GoalRevealWatcher) and returning it in both would celebrate one walk twice. See the
 * migration header for the split.
 */
export type UnseenGoalReward = {
  goal_id: string;
  /** The goal in the user's own words — "learn a standing backflip". */
  goal_label: string | null;
  goal_type: ChallengeType;
  tier: DifficultyTier | null;
  /** How the app learned it was done. 'honor' is the one that pays a tier down. */
  verified_as: GoalClaimLevel | null;
  /** The band actually PAID, off the stored receipt. */
  band: string | null;
  /** What the same tier pays at the full level, and the crate that band names — the honest line's
   *  "a clip or a vouch unlocks the full Vessel of Hestia". Never granted, only named. */
  full_band: string | null;
  full_box: string | null;
  settled_at: string;
  payload: GoalRewardPayload | null;
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
        // `body` is no longer required: migration 0158 made it nullable so a photo can be posted
        // with no caption. The two attachment columns come along through Partial<Message>.
        Insert: Partial<Message> & { group_id: string; user_id: string };
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
      // 0170 · gained `muted`. When the viewer may not see this user's rank (Private mode, and
      // they are not friends) the RPC returns ONE row with every figure null and muted = true —
      // never zero rows, which would be indistinguishable from "no rank yet", and never a spoofed
      // number. Every field is therefore nullable now; the client must branch on `muted`.
      get_user_rank: {
        Args: { p_user_id: string };
        Returns: {
          score: number | null;
          tier: RankTierName | null;
          division: number | null;
          xp_into_tier: number | null;
          xp_for_next_tier: number | null;
          muted: boolean;
        }[];
      };
      get_user_lock_in_photos: {
        Args: { p_user_id: string; p_limit?: number };
        Returns: { id: string; goal_type: GoalType; goal_detail: string | null; duration_seconds: number | null; photo_url: string | null }[];
      };
      get_my_social_challenges: { Args: Record<string, never>; Returns: SocialChallenge[] };
      /** 0163 · the same question asked of the CIRCLE instead of the roster. Gated on
       *  membership, so a member who joined after a challenge started still gets it back —
       *  with i_am_in false, which is what puts the opt-in CTA on screen. */
      get_circle_active_challenges: { Args: { p_circle_id: string }; Returns: CircleActiveChallenge[] };
      // ─── difficulty scoping (0159-0160) ───
      // No p_verifiability on either: the server derives it. That absence is the firewall.
      set_goal_scope: { Args: { p_goal_id: string; p_tier: DifficultyTier }; Returns: ScopedRewardPreview };
      set_challenge_scope: { Args: { p_challenge_id: string; p_tier: DifficultyTier }; Returns: ScopedRewardPreview };
      preview_challenge_reward: {
        Args: { p_tier: DifficultyTier; p_verifiability?: string; p_duration_days?: number; p_scope?: number };
        Returns: ScopedRewardPreview;
      };
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
          /** 0145 · a grade race's two extra terms. Both null on every other metric. */
          p_grade_target?: number | null;
          p_course_code?: string | null;
        };
        Returns: SocialChallenge;
      };
      create_group_challenge: {
        Args: {
          p_circle_id: string;
          /** Null ONLY for a grade goal, whose bar is p_grade_target instead. The server takes
           *  exactly one of the two and refuses both or neither. */
          p_target_count: number | null;
          p_window_hours: number;
          p_payout_xp?: number;
          p_public_name?: string | null;
          p_starts_on?: string | null;
          p_ends_on?: string | null;
          /** 0145 · a grade race's two extra terms. Both null on every other metric. */
          p_grade_target?: number | null;
          p_course_code?: string | null;
          /**
           * 0169 · a collective goal measured in a real metric — "everyone lifts 10,000 lb".
           *
           * The third spelling of "the bar", alongside p_target_count and p_grade_target, and the
           * server takes exactly one of the three. p_race_metric is only read when p_target_value
           * is set, and only 'volume' and 'distance' are accepted there.
           */
          p_race_metric?: SocialChallengeRaceMetric | null;
          p_target_value?: number | null;
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
          /** 0145 · a grade race's two extra terms. Both null on every other metric. */
          p_grade_target?: number | null;
          p_course_code?: string | null;
        };
        Returns: SocialChallenge;
      };
      /** 0162 · the fourth create path, and the only admin-gated one Cindy can reach. The server
       *  re-reads the caller's campfire role before it writes anything — no p_role, and p_tier is
       *  validated and priced there, so neither can be forged. */
      host_campfire_challenge: {
        Args: {
          p_circle_id: string;
          /** The plural noun counted: "pushups". Becomes the unit and the lock-in type's name. */
          p_metric: string;
          p_target: number;
          p_window_hours?: number;
          p_label?: string | null;
          /** 'most_by_deadline' is refused — that is a placement race, which settles differently. */
          p_shape?: 'everyone_hits_target' | 'first_to';
          p_tier?: DifficultyTier | null;
          p_payout_xp?: number;
        };
        Returns: HostedCampfireChallenge;
      };
      /** Opt in from the chat card. Any campfire member; hosting is the admin act, joining is not. */
      join_campfire_challenge: {
        Args: { p_challenge_id: string };
        Returns: { challenge_id: string; goal_id: string | null; metric: string | null; target: number | null };
      };
      // ─── the honour path (0164) ───
      // No p_level on either: the server decides the verification level and completes the goal
      // itself, so exactly one grant fires at exactly one band. That absence is the firewall.
      claim_goal_complete: {
        Args: { p_goal_id: string; p_proof_path?: string | null; p_voucher_ids?: string[] | null };
        Returns: GoalClaimResult;
      };
      submit_vouch: {
        Args: { p_goal_id: string; p_verdict: boolean };
        Returns: { counted: boolean; vouches: number; resolved: boolean };
      };
      get_vouch_request: { Args: { p_goal_id: string }; Returns: VouchRequest };
      /** The claimant's mirror of get_vouch_request (0165). Owner-only — it names the roster. */
      get_claim_status: { Args: { p_goal_id: string }; Returns: ClaimStatus };
      respond_to_h2h_challenge: { Args: { p_challenge_id: string; p_accept: boolean }; Returns: SocialChallenge };
      /** Self-report your mark on a grade race (0145). Returns the value the SERVER stored — it
       *  rounds to 2dp, and that copy is what settlement scores. */
      report_challenge_grade: { Args: { p_challenge_id: string; p_grade: number }; Returns: number };
      cancel_social_challenge: { Args: { p_challenge_id: string }; Returns: undefined };
      /** The settled standings (0111) — every racer's final figure, rank and what they were paid. */
      get_challenge_results: { Args: { p_challenge_id: string }; Returns: ChallengeResultRow[] };
      /** This viewer's own payout on a settled challenge (0116) — reads what grant_reward paid. */
      get_challenge_reward: { Args: { p_challenge_id: string }; Returns: ChallengeReward };
      get_my_unseen_challenge_rewards: { Args: Record<string, never>; Returns: UnseenChallengeReward[] };
      /** What the last rank-up actually paid (0142). Read-only; the grant happened at 0121. */
      get_my_last_rank_up_reward: { Args: Record<string, never>; Returns: RankUpReward[] };
      /** Stamps the fire-once flag so the reveal never plays twice (0116). */
      mark_challenge_reward_seen: { Args: { p_challenge_id: string }; Returns: undefined };
      /** Personal goals that finished and were never celebrated (0167). Read-only; it cannot pay. */
      get_unseen_goal_rewards: { Args: Record<string, never>; Returns: UnseenGoalReward[] };
      /** The goal reveal's fire-once stamp — the only thing it can write is a timestamp (0167). */
      mark_goal_reward_seen: { Args: { p_goal_id: string }; Returns: undefined };
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
      /** The + menu's silent nudge (mock 101, migration 0152). Returns nothing and posts nothing —
       *  one notification to one member, with the copy fixed server-side so a ping can never
       *  carry a message. Not notify_event, which clients cannot call. */
      // 0172 · was `Returns: undefined`. The RPC now reports what actually happened, because both
      // of its non-delivery paths used to be silent: 'sent' | 'sent_no_push' | 'rate_limited'.
      ping_campfire_member: { Args: { p_group_id: string; p_user_id: string }; Returns: PingResult };
      // 0171 · set, swap or clear the caller's single reaction. Returns the emoji now held, or
      // null when the reaction was cleared (which is what passing the held emoji again does).
      set_message_reaction: { Args: { p_message_id: string; p_emoji: string }; Returns: string | null };
      // 0170 · private mode. Writes only the caller's own row.
      set_leaderboard_private: { Args: { p_on: boolean }; Returns: undefined };
      can_see_rank: { Args: { p_viewer: string; p_target: string }; Returns: boolean };
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
      /**
       * The Forge (migration 0138). Consume N owned cosmetics of p_rarity, grant one of the next
       * rarity up.
       *
       * p_item_ids are cosmetics_owned ROW ids, not catalog keys — the row is what gets destroyed,
       * and naming rows is what makes "you selected the same item three times" a distinguishable
       * mistake. Nothing else is sent: unlike open_loot_box, which has to hand over a candidate pool
       * because the catalog lives in the bundle, the Forge's pool is box_droppable_items and the
       * server already holds it. There is no argument here a patched client could aim.
       */
      forge_combine: {
        Args: { p_rarity: string; p_item_ids: string[] };
        Returns: EconomyForgeResult;
      };
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
          /** 0128's single-attachment triple. Kept for builds predating 0140; unused by this one. */
          p_attach_kind?: AgoraAttachKind | null;
          p_attach_ref_id?: string | null;
          p_attach_key?: string | null;
          /** 0140 — every attachment on the post, at most one per kind. Ownership checked per item. */
          p_attachments?: AgoraAttachInput[] | null;
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

/**
 * A combine the SERVER already decided (migration 0138) — the hammer strike only visualizes it,
 * same ordering rule as EconomyOpenResult above.
 *
 * `rarity` is the OUTPUT tier and is guaranteed, never rolled; the gamble is which item of that tier
 * `cosmetic_key` turns out to be. `dupe` is the one path where nothing new arrives: cosmetics_owned
 * is unique on (user_id, cosmetic_key), so a roll that lands on something already owned auto-salvages
 * to `embers` instead of stacking. The server prefers un-owned items, so that only happens to someone
 * who already holds the whole tier.
 */
export type EconomyForgeResult = {
  cosmetic_key: string;
  rarity: string;
  dupe: boolean;
  embers: number;
  /** The rarity that was consumed, echoed back so the reveal can say "from 3 Rare". */
  input_rarity: string;
  consumed: number;
  consumed_keys: string[];
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
 * What the composer SENDS: which achievement, never what it says. `create_agora_post` re-reads
 * each one from the table that owns it and freezes the snapshot server-side (0130, per-item 0140).
 */
export type AgoraAttachInput = {
  kind: AgoraAttachKind;
  ref_id: string | null;
  key: string | null;
};

/** One frozen attachment as migration 0140 stored it — the input, plus the server's snapshot. */
export type AgoraAttachment = AgoraAttachInput & {
  snapshot: AgoraAttachSnapshot;
};

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
  /**
   * Element [0] of `attachments`, restated. Kept only so a build that predates migration 0140
   * still renders a post's first attachment; nothing in this codebase should read it.
   *
   * @deprecated Read `attachments`.
   */
  attach_kind: AgoraAttachKind | null;
  /** @deprecated Read `attachments`. */
  attach_snapshot: AgoraAttachSnapshot;
  /**
   * Every frozen attachment on the item, in composed order (migration 0140).
   *
   * A post carries a photo AND a lock-in AND an achievement together — mock 162 scoped the three
   * as combinable media, and 0128's single slot made each new pick delete the last. A milestone
   * row arrives as a one-element array, so the renderer walks one list for both row types.
   */
  attachments: AgoraAttachment[];
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
