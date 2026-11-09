import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ImmersiveFeed } from '@/components/agora/immersive-feed';
import { SearchBoard } from '@/components/discover/search-board';

// SEARCH = THE DISCOVERY BOARD (ShareSpot ss2, mock 345; was Phase 8.3's Discover). The route keeps its `social` filename because a
// campfire's "posts" button and installed builds deep-link /social?channel=campfire:<id>.
//
// Two states, one tab:
//   • 'people' — the landing: the discovery board — People / Rooms / Clubs / Posts swipe rows
//     (components/discover/search-board.tsx). Match-first, not an infinite scroll.
//   • 'feed'   — the immersive Agora (mocks 317/326), unchanged, one tap below the matches; its bar's
//     ‹ People returns. No algorithm and no like button: the tab picks the sources, the server orders
//     them newest first (get_agora_feed, 0280), and nothing is ranked or injected.
// A ?channel= deep link means "show me that room's posts", so it opens straight onto the feed.
//
// The conversation list that used to be this tab's second pane is the Chat tab now ((tabs)/chat.tsx).
// An old ?pane=chats link forwards there.

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channel?: string; pane?: string }>();
  const [view, setView] = useState<'people' | 'feed'>(params.channel ? 'feed' : 'people');

  useEffect(() => {
    if (params.pane === 'chats') {
      router.setParams({ pane: undefined });
      router.navigate('/chat' as never);
    }
  }, [params.pane, router]);

  // The tab stays mounted, so a channel link that arrives later has to flip it onto the feed.
  const [seenChannel, setSeenChannel] = useState(params.channel);
  if (params.channel && params.channel !== seenChannel) {
    setSeenChannel(params.channel);
    setView('feed');
  }

  if (view === 'people') return <SearchBoard onOpenFeed={() => setView('feed')} />;

  return (
    <ImmersiveFeed
      requestedChannel={params.channel}
      onRequestedChannelSeen={() => router.setParams({ channel: undefined })}
      onOpenChats={() => router.navigate('/chat' as never)}
      onBack={() => setView('people')}
    />
  );
}
