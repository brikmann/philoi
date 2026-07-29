import { useMemo } from 'react';

import { CHAT_ENABLED } from '@/constants/feature-flags';
import { useChallengeFeed } from '@/hooks/use-challenge-feed';
import { useChat } from '@/hooks/use-chat';
import { useFeed } from '@/hooks/use-feed';
import type { FeedCheckIn } from '@/lib/api/check-ins';
import type { FeedChallengeEvent } from '@/lib/api/challenges';
import type { ChatMessage } from '@/lib/api/messages';

export type TimelineRow =
  | { kind: 'check_in'; id: string; created_at: string; data: FeedCheckIn }
  | { kind: 'challenge'; id: string; created_at: string; data: FeedChallengeEvent }
  | { kind: 'message'; id: string; created_at: string; data: ChatMessage };

// Merges check-ins, challenge events, and chat messages into one chronological timeline
// (UI_REDESIGN_SPEC.md's "merged feed/chat"). Sorted ASCENDING (oldest first) to match
// chat's own convention — new stuff appears near the composer at the bottom, not at the top
// the old separate Feed tab used. Chat is realtime (see useChat/subscribeToMessages);
// check-ins/challenges are still fetch + pull-to-refresh only — a deliberate scope line for
// this pass, not an oversight (see V1_BUILD_SPEC/UI_REDESIGN_SPEC discussion).
export function useCircleTimeline(groupId: string) {
  const feed = useFeed(groupId);
  const challengeFeed = useChallengeFeed(groupId);
  const chat = useChat(groupId);

  const rows = useMemo<TimelineRow[]>(() => {
    const checkInRows: TimelineRow[] = feed.items.map((item) => ({
      kind: 'check_in',
      id: item.id,
      created_at: item.created_at,
      data: item,
    }));
    const challengeRows: TimelineRow[] = challengeFeed.events.map((event) => ({
      kind: 'challenge',
      id: event.id,
      created_at: event.created_at,
      data: event,
    }));
    const messageRows: TimelineRow[] = CHAT_ENABLED
      ? chat.messages.map((m) => ({ kind: 'message', id: m.id, created_at: m.created_at, data: m }))
      : [];
    return [...checkInRows, ...challengeRows, ...messageRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [feed.items, challengeFeed.events, chat.messages]);

  // Not wrapped in useCallback — only used as a RefreshControl onRefresh prop, never as an
  // effect dependency, so referential stability across renders isn't load-bearing here.
  function refetch() {
    return Promise.all([feed.refetch(), challengeFeed.refetch(), chat.refetch()]);
  }

  return {
    rows,
    loading: feed.loading || challengeFeed.loading || chat.loading,
    error: feed.error ?? challengeFeed.error ?? chat.error,
    refetch,
    feed,
    chat,
  };
}
