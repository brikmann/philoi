import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { ImmersiveFeed } from '@/components/agora/immersive-feed';

// DISCOVER (mock 331) — the public square, one name for one thing: the Agora feed is Discover. The
// route keeps its `social` filename because a campfire's "posts" button and installed builds
// deep-link /social?channel=campfire:<id>.
//
// The immersive Agora (mock 317), full-bleed under one slim bar (mock 326): Friends · Everyone,
// ＋ · 💬 (to the Chat tab) · 🔍. No algorithm and no like button: the tab picks the sources, the
// server orders them newest first (get_agora_feed, 0280), and nothing is ranked or injected.
//
// The conversation list that used to be this tab's second pane is the Chat tab now ((tabs)/chat.tsx).
// An old ?pane=chats link forwards there.

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channel?: string; pane?: string }>();

  useEffect(() => {
    if (params.pane === 'chats') {
      router.setParams({ pane: undefined });
      router.navigate('/chat' as never);
    }
  }, [params.pane, router]);

  return (
    <ImmersiveFeed
      requestedChannel={params.channel}
      onRequestedChannelSeen={() => router.setParams({ channel: undefined })}
      onOpenChats={() => router.navigate('/chat' as never)}
    />
  );
}
