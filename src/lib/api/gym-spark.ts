import { supabase } from '@/lib/supabase';
import type { AgoraCursor, AgoraItem } from '@/types/database';

// THE GYM SPARK's server contract (migration 0301, CODE_PROMPT_gym_spark.md). Additive only:
//   • get_gym_feed  — get_agora_feed's rows + is_pr + the newest comment, for the Feed (mock 400).
//   • get_gym_board — one weekly (or all-time) leaderboard, everyone on it, ranked by XP (402; 0305).
//   • set_agora_post_pr — the author flags their own post as a PR (composer's "Attach PR", 401).
// Same firewall as lib/api/agora.ts: nothing here WRITES XP, embers or rank (the board only reads XP).

/** Feed chips (mock 400). 'gym' = every post from everyone; 'following' = people you follow; 'prs' = PR-flagged. */
export type GymFeedFilter = 'gym' | 'following' | 'prs';

export type GymFeedItem = AgoraItem & {
  is_pr: boolean;
  /** Newest visible comment on the item (blocked users excluded), or null when there are none. */
  top_comment_name: string | null;
  top_comment_body: string | null;
};

export async function fetchGymFeed(
  filter: GymFeedFilter,
  cursor: AgoraCursor | null = null,
  limit = 20
): Promise<GymFeedItem[]> {
  const { data, error } = await supabase.rpc('get_gym_feed' as never, {
    p_filter: filter,
    p_before_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  } as never);
  if (error) throw error;
  return (data ?? []) as GymFeedItem[];
}

/** Flag (or unflag) one of YOUR posts as a PR. The server refuses anyone else's post. */
export async function setAgoraPostPr(postId: string, isPr: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_agora_post_pr' as never, { p_post_id: postId, p_is_pr: isPr } as never);
  if (error) throw error;
}

/** Board tabs (mock 402). 'week' = the current Sunday-00:00-UTC week (lib/time/week.ts ↔ SQL week_start()). */
export type GymBoardWindow = 'week' | 'all';

/** Board scope (0306). 'everyone' = 0305's board; 'uni' = people whose profiles.university matches yours
 *  (trimmed, case-insensitive). With no university on your profile, 'uni' returns just your own row. */
export type GymBoardScope = 'everyone' | 'uni';

export type GymBoardRow = {
  /** 1-based place, unique (0305: row_number over xp desc, display_name, user_id) — one 🥇 / 🥈 / 🥉. */
  rank: number;
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  /** The ranking metric (0305): 'week' = XP earned this week (sum of check_ins.xp_earned since
   *  week_start()); 'all' = lifetime XP (live_rank_xp — the number shown as your XP everywhere). */
  xp: number;
  /** Consecutive Sunday-weeks, ending this week (or last week if none yet this week), with ≥1 finished lock-in. */
  week_streak: number;
  is_me: boolean;
};

/**
 * The whole board, ranked by XP desc. Everyone with ≥1 XP in the window is on it, and the caller's
 * own row is ALWAYS included (with 0 if they have none) so the screen can pin it.
 */
export async function fetchGymBoard(window: GymBoardWindow, scope: GymBoardScope = 'everyone'): Promise<GymBoardRow[]> {
  const { data, error } = await supabase.rpc('get_gym_board' as never, { p_window: window, p_scope: scope } as never);
  if (error) throw error;
  return (data ?? []) as GymBoardRow[];
}

/**
 * THE gym chat (spec §5): one seeded campfire ("Laurier Gym", migration 0302) every account is
 * auto-joined to on signup and backfilled into. Fixed id so the client opens it without a lookup;
 * the Chat tab goes straight here.
 */
export const GYM_ROOM_ID = 'a11a0000-0000-4000-8000-000000000001';
