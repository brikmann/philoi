// social_media stays for historical rows' typing — the lock-in goal picker (PHILOI_UI_SPEC.md
// §12) doesn't offer it, only gym/run/study/job_applications/read/custom.
export type GoalType = 'gym' | 'run' | 'study' | 'social_media' | 'custom' | 'job_applications' | 'read';
export type MemberRole = 'owner' | 'member';
export type CheckInStatus = 'on_time' | 'late';
// infernal is the apex tier (PHILOI_UI_SPEC.md §11) — singular, no divisions. Renamed from
// "legend" (migration 0030) for the fire theme.
export type RankTierName = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'infernal';

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
};

export type Profile = {
  id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  university: string | null;
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
  created_at: string;
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
  created_at: string;
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

export type GroupMember = {
  group_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
  /** Chat push notifications (mentions + batched general messages) muted for this circle. */
  chat_muted: boolean;
  /** "I can help with this class" (PHILOI_UI_SPEC.md §14) — self-declared, surfaced as a badge. */
  is_helper: boolean;
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
};

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
  sets: Pick<WorkoutSet, 'id' | 'set_index' | 'weight' | 'reps' | 'is_pr'>[];
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
  | 'routine_saved';

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

export type Challenge = {
  id: string;
  user_id: string;
  circle_id: string | null;
  type: ChallengeType;
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
export type SocialChallengeStatus = 'pending' | 'active' | 'completed' | 'declined' | 'expired';
export type SocialChallengeRaceMetric = 'xp' | 'lockin_time';

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
        Row: { id: string; name: string };
        Insert: { id?: string; name: string };
        Update: { id?: string; name?: string };
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
      ensure_personal_invite: { Args: Record<string, never>; Returns: string };
      delete_group: { Args: { p_group_id: string }; Returns: undefined };
      delete_my_account: { Args: Record<string, never>; Returns: undefined };
      delete_my_message: { Args: { p_message_id: string }; Returns: undefined };
      get_university_leaderboard: {
        Args: { p_university: string; p_limit?: number };
        Returns: UniversityLeaderboardRow[];
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
      create_h2h_challenge: {
        Args: {
          p_opponent_id: string;
          p_race_metric: SocialChallengeRaceMetric;
          p_window_hours: number;
          p_circle_id?: string | null;
          p_payout_xp?: number;
        };
        Returns: SocialChallenge;
      };
      create_group_challenge: {
        Args: { p_circle_id: string; p_target_count: number; p_window_hours: number; p_payout_xp?: number };
        Returns: SocialChallenge;
      };
      respond_to_h2h_challenge: { Args: { p_challenge_id: string; p_accept: boolean }; Returns: SocialChallenge };
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
      get_challenge_leaderboard: {
        Args: { p_circle_id: string; p_type: ChallengeType };
        Returns: ChallengeLeaderboardRow[];
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
    };
  };
};
