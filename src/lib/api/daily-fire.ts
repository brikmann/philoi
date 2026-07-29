import { track } from '@/lib/analytics';
import { getLocalDayBounds, formatLocalDate } from '@/lib/local-day';
import { supabase } from '@/lib/supabase';
import type { DailyFire } from '@/types/database';

// The daily flame meter's read+create+recompute call (PHILOI_UI_SPEC.md §5, design-mocks/26).
// "now" defaults to the call-time device clock — a param only so a screen can pin a stable
// instant across a render pass rather than each caller computing its own slightly-different one.
export async function fetchOrCreateDailyFire(now: Date = new Date()): Promise<DailyFire> {
  const { start, end } = getLocalDayBounds(now);
  const { data, error } = await supabase.rpc('get_or_create_daily_fire', {
    p_day: formatLocalDate(now),
    p_day_start: start.toISOString(),
    p_day_end: end.toISOString(),
  });
  if (error) throw error;
  if (!data?.[0]) throw new Error('Could not load today\'s fire.');
  return data[0];
}

export async function setDailyGoalMode(mode: 'auto' | 'manual', manualTarget?: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_daily_goal_mode', { p_mode: mode, p_manual_target: manualTarget ?? null });
  if (error) throw error;
}

export async function setPublishFlameCompletion(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_publish_flame_completion', { p_enabled: enabled });
  if (error) throw error;
}

// "Share" on the completion card (§5: "like a lock-in") — fans out to every campfire the
// caller is in; there's no single-circle target picker in the mock, unlike the lock-in done
// screen, since the daily goal isn't scoped to one campfire.
export async function publishFlameCompletion(now: Date = new Date()): Promise<void> {
  const { error } = await supabase.rpc('publish_flame_completion', { p_day: formatLocalDate(now) });
  if (error) throw error;
  track('flame_completion_published', {});
}

export type FlameCompletionFeedItem = {
  id: string;
  user_id: string;
  display_name: string;
  day: string;
  posted_at: string;
};

type FlameCompletionCircleRow = {
  posted_at: string;
  flame_completion_posts: { id: string; user_id: string; day: string; profiles: { display_name: string } } | null;
};

// The published "I completed my fire today" card in a campfire's chain (§5: "like a
// lock-in") — merged client-side into circle-timeline.tsx's rows, same pattern already used
// there for live lock-in sessions.
export async function fetchFlameCompletionFeed(circleId: string): Promise<FlameCompletionFeedItem[]> {
  const { data, error } = await supabase
    .from('flame_completion_circles')
    .select('posted_at, flame_completion_posts(id, user_id, day, profiles(display_name))')
    .eq('circle_id', circleId)
    .order('posted_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  return ((data ?? []) as unknown as FlameCompletionCircleRow[])
    .filter((row): row is FlameCompletionCircleRow & { flame_completion_posts: NonNullable<FlameCompletionCircleRow['flame_completion_posts']> } =>
      Boolean(row.flame_completion_posts)
    )
    .map((row) => ({
      id: row.flame_completion_posts.id,
      user_id: row.flame_completion_posts.user_id,
      display_name: row.flame_completion_posts.profiles.display_name,
      day: row.flame_completion_posts.day,
      posted_at: row.posted_at,
    }));
}
