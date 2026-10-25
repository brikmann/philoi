// The social layer (design-mocks/HANDOFF_INDEX_social_layer.md) — identity profile (0272),
// session auto-post (0273), Forests (0274) and grind-alikes (0275). Shapes mirror the jsonb the
// RPCs return; every field a viewer may not be allowed to see is optional, because the server
// omits it rather than nulling it.

import type { AgoraVisibility } from '@/types/database';

// ───────────────────────────── identity (0272) ─────────────────────────────

/** Who can see your identity fields — the Agora's own three-way dial. */
export type IdentityVisibility = AgoraVisibility;

export type Anthem = { title: string; artist?: string | null; url?: string | null };

export type DisciplineBucket = 'study' | 'deep_work' | 'gym' | 'run' | 'other';

export type DisciplineMixRow = { bucket: DisciplineBucket; seconds: number; sessions: number; pct: number };

export type RecentWin = { kind: 'pr' | 'challenge' | 'rank_up' | 'badge'; label: string; at: string };

export type ProfileIdentity = {
  user_id: string;
  is_self: boolean;
  /** False when the dial keeps this viewer out: the identity fields, mix and win are then absent. */
  identity_visible: boolean;
  streak: { current: number; longest: number };
  career_goal?: string | null;
  working_toward?: string | null;
  working_on?: string | null;
  anthem?: Anthem | null;
  interests?: string[];
  /** Self only. */
  visibility?: IdentityVisibility;
  /** Absent when 0217's rank dial hides it from this viewer. */
  rank?: {
    tier: string;
    division: number | null;
    week_xp: number;
    prev_week_xp: number;
    trend: 'up' | 'down' | 'flat';
  };
  recent_win?: RecentWin | null;
};

/** A patch: only the keys you send change. '' or null clears a field. */
export type IdentityPatch = Partial<{
  career_goal: string | null;
  working_toward: string | null;
  working_on: string | null;
  anthem: Anthem | null;
  interests: string[];
  visibility: IdentityVisibility;
}>;

// ───────────────────────────── forests (0274) ─────────────────────────────

export type ForestSort = 'active' | 'popular' | 'new' | 'mine';
export type ForestVisibility = 'open' | 'request';
export type ForestMemberStatus = 'active' | 'pending' | 'removed';

export type ForestSummary = {
  id: string;
  name: string;
  purpose: string | null;
  emoji: string;
  cover_url: string | null;
  visibility: ForestVisibility;
  /** Null = cross-uni. */
  university: string | null;
  tags: string[];
  is_official: boolean;
  my_status: ForestMemberStatus | null;
  member_count: number;
  locked_in_now: number;
  posts_24h: number;
  campfire_count: number;
  /** Alive in the last 24h — someone locked in now, or a post. */
  pulse: boolean;
  /** Matched to your university, interests or program. */
  suggested: boolean;
  created_at: string;
};

export type ForestMember = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  role: 'owner' | 'member';
  locked_in: boolean;
};

export type ForestCampfire = {
  id: string;
  name: string;
  emoji: string | null;
  privacy: 'open' | 'gated' | 'private';
  goal_type: string | null;
  member_count: number;
  is_member: boolean;
  /** Only for an open campfire, and only to the forest's own members. */
  join_code: string | null;
};

export type ForestPendingRequest = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
};

export type ForestDetail = Omit<ForestSummary, 'posts_24h' | 'campfire_count' | 'pulse' | 'suggested'> & {
  is_owner: boolean;
  /** False for a request-only forest you haven't been let into: members/campfires/feed absent. */
  can_read: boolean;
  members?: ForestMember[];
  campfires?: ForestCampfire[];
  /** Owner only. */
  pending?: ForestPendingRequest[];
};

// ───────────────────────────── grind-alikes (0275) ─────────────────────────────

export type MatchScope = 'program' | 'uni' | 'wider';
export type FindMe = 'everyone' | 'friends_of_friends' | 'same_uni';

export type MatchSettings = {
  discoverable: boolean;
  match_scope: MatchScope;
  find_me: FindMe;
  show_live: boolean;
};

export type MatchReason = { key: string; emoji: string; label: string };

export type GrindAlike = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  /** Only when their identity is visible to you. */
  career_goal: string | null;
  /** Similarity, 0–100. Not a ranking — the UI keeps it quiet. */
  score: number;
  reasons: MatchReason[];
  live: boolean;
  is_friend: boolean;
};

/** Percent of locked-in time per bucket (study / deep work / gym / run), last 90 days. */
export type MatchMix = Record<'study' | 'deep_work' | 'gym' | 'run', number>;

export type MatchDetail = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  university: string | null;
  streak: number;
  /** Null for a friend who hasn't opted in — the engine only scores the discoverable. */
  score: number | null;
  reasons: MatchReason[];
  my_mix: MatchMix | null;
  their_mix: MatchMix | null;
  live: boolean;
  is_friend: boolean;
  request: 'outgoing' | 'incoming' | null;
  career_goal?: string | null;
  working_toward?: string | null;
};
