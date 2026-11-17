import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatRow, loadChatList, useOpenChat } from '@/components/chat/chats-hub';
import { GymTopBar } from '@/components/gym-spark/gym-top-bar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { chatLiveKey, fetchChatLiveNow } from '@/lib/api/chat';
import { GYM_ROOM_ID } from '@/lib/api/gym-spark';
import type { SocialChat } from '@/lib/api/social-chats';
import { useAuth } from '@/lib/auth/auth-context';

// THE GYM SPARK's Chat tab (v2-fixes §4): a chat LIST, not a single room. The Laurier Gym room is
// pinned first, then every other conversation you're in (DMs, plus any campfire/forest), newest first.
//
// No new queries: the list is ChatsHub's own (loadChatList → get_my_chats, or the pre-0284 assembly),
// drawn with ChatsHub's ChatRow and opened with its useOpenChat — so a DM opens /dm/[friendId] and the
// gym row opens /group/GYM_ROOM_ID as a normal pushed room with a back arrow. Every account is
// auto-joined to the gym room (0302), so it is normally in the list already; if it isn't (yet), a bare
// gym row is drawn anyway — the room is always one tap away.

// Same refresh floor as ChatsHub's live dots.
const LIVE_POLL_MS = 45_000;

const GYM_ROW_FALLBACK: SocialChat = {
  kind: 'campfire',
  id: GYM_ROOM_ID,
  name: 'Laurier Gym',
  emoji: '🏋️',
  lastAt: null,
  lastLine: null,
  lastIcon: null,
};

export function GymChatList() {
  const router = useRouter();
  const open = useOpenChat();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [chats, setChats] = useState<SocialChat[] | null>(null);
  const [live, setLive] = useState<Map<string, number>>(() => new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [focused, setFocused] = useState(false);

  const loadLive = useCallback(async () => {
    try {
      setLive(await fetchChatLiveNow());
    } catch {
      // A dot is flavour — keep the last ones.
    }
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    void loadLive();
    try {
      setChats(await loadChatList(userId));
    } catch {
      setChats((prev) => prev ?? []);
    }
  }, [userId, loadLive]);

  // On focus: back from a thread is when its unread count just dropped.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load])
  );

  useGatedInterval(loadLive, LIVE_POLL_MS, focused && !!userId);

  const { gym, others } = useMemo(() => {
    const list = chats ?? [];
    const isGym = (c: SocialChat) => c.kind === 'campfire' && c.id === GYM_ROOM_ID;
    return { gym: list.find(isGym) ?? GYM_ROW_FALLBACK, others: list.filter((c) => !isGym(c)) };
  }, [chats]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <GymTopBar />
      <FlatList
        data={chats === null ? [] : others}
        keyExtractor={(c) => `${c.kind}:${c.id}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={Colors.navEmber}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.sec}>Pinned</Text>
            <ChatRow chat={gym} live={live.get(chatLiveKey(gym)) ?? 0} onPress={() => open(gym)} />
            <Text style={[styles.sec, styles.secGap]}>Messages</Text>
          </View>
        }
        ListEmptyComponent={
          chats === null ? (
            <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyBody}>No DMs yet — say hi to someone from the gym.</Text>
              <Pressable onPress={() => router.push('/people')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.emptyLink}>Find people</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ChatRow chat={item} live={live.get(chatLiveKey(item)) ?? 0} onPress={() => open(item)} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  header: {
    gap: 6,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 10,
    marginHorizontal: 2,
  },
  secGap: {
    marginTop: Spacing.three,
  },
  loader: {
    marginTop: Spacing.four,
  },
  empty: {
    marginTop: Spacing.three,
    alignItems: 'center',
    gap: 6,
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  emptyLink: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
});
