import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImmersiveFeed } from '@/components/agora/immersive-feed';
import { LiveFriendsChip } from '@/components/lockin-cheers/live-friends-chip';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Avatar } from '@/components/ui/avatar';
import { IconText } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchMySocialChats, type SocialChat } from '@/lib/api/social-chats';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/format';

// SOCIAL (mock 320) — the Search tab, retasked as the public square. Feed · Chats, and the ＋ that
// posts (the chip at the head of the Feed's channel row). Everything communal lives in this one tab;
// Home is your own.
//
//   • Feed — the immersive Agora (mock 317), its channels (All · Friends · Everyone · your rooms)
//     across the top. No algorithm: the channel picks the sources, the server orders them newest
//     first (get_agora_feed, 0280), and nothing is ranked or injected.
//   • Chats — v1 routes to the chat surfaces that already exist: campfire group chats and DMs in one
//     list, with the locked-in-with-you panel (0270's session threads) on top when it has something.
//
// Search didn't go away: the 🔍 beside Feed · Chats opens it (/search — people, programs,
// exercises, forests, campfires), and installed builds' links to /search still land there.
//
// ?channel=campfire:<id> (a campfire's "posts" button) opens the Feed on that channel.

type Pane = 'feed' | 'chats';

export default function SocialScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channel?: string; pane?: string }>();
  const [pane, setPane] = useState<Pane>(params.pane === 'chats' ? 'chats' : 'feed');

  const toggle = <PaneToggle pane={pane} onChange={setPane} onSearch={() => router.push('/search')} />;

  if (pane === 'feed') {
    return (
      <ImmersiveFeed
        title="Social"
        header={toggle}
        requestedChannel={params.channel}
        onRequestedChannelSeen={() => router.setParams({ channel: undefined })}
      />
    );
  }
  return <ChatsPane toggle={toggle} />;
}

function PaneToggle({ pane, onChange, onSearch }: { pane: Pane; onChange: (p: Pane) => void; onSearch: () => void }) {
  return (
    <View style={styles.toggleRow}>
      {(['feed', 'chats'] as const).map((p) => {
        const on = pane === p;
        return (
          <Pressable
            key={p}
            style={[styles.seg, on && styles.segOn]}
            onPress={() => onChange(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{p === 'feed' ? 'Feed' : 'Chats'}</Text>
          </Pressable>
        );
      })}
      <Pressable style={styles.search} onPress={onSearch} accessibilityRole="button" accessibilityLabel="Search people, programs and forests">
        <Ionicons name="search" size={16} color={Colors.muted} />
      </Pressable>
    </View>
  );
}

function ChatsPane({ toggle }: { toggle: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [chats, setChats] = useState<SocialChat[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setChats(await fetchMySocialChats(userId));
    } catch {
      setChats((prev) => prev ?? []);
    }
  }, [userId]);

  // On focus: back from a thread is when its unread count just dropped.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function open(chat: SocialChat) {
    if (chat.kind === 'campfire') router.push(`/group/${chat.id}`);
    else router.push({ pathname: '/dm/[friendId]', params: { friendId: chat.friendId } });
  }

  return (
    <View style={[styles.chatsRoot, { paddingTop: insets.top }]}>
      <AppTopBar title="Social" />
      {toggle}
      {chats === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(c) => `${c.kind}:${c.id}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<LiveFriendsChip style={styles.live} />}
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptyBody}>Join a campfire for a group chat, or message a friend from their profile.</Text>
              <Pressable style={styles.emptyBtn} onPress={() => router.push('/campfires')} accessibilityRole="button">
                <Text style={styles.emptyBtnText}>Find a campfire</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => <ChatRow chat={item} onPress={() => open(item)} />}
        />
      )}
    </View>
  );
}

function ChatRow({ chat, onPress }: { chat: SocialChat; onPress: () => void }) {
  const unread = chat.kind === 'dm' ? chat.unread : 0;
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}${chat.kind === 'campfire' ? ', campfire chat' : ''}${unread > 0 ? `, ${unread} unread` : ''}`}>
      {chat.kind === 'campfire' ? (
        <View style={[styles.avatar, styles.campfireAvatar]}>
          <Text style={styles.campfireEmoji}>{chat.emoji}</Text>
        </View>
      ) : chat.avatarUrl ? (
        <Image source={{ uri: chat.avatarUrl }} style={styles.avatar} contentFit="cover" />
      ) : (
        <Avatar label={(chat.name || '?').slice(0, 2).toUpperCase()} size={44} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.name, unread > 0 && styles.nameUnread]} numberOfLines={1}>
          {chat.name}
        </Text>
        {chat.kind === 'campfire' && chat.lastIcon && chat.lastLine ? (
          <IconText icon={chat.lastIcon} style={[styles.last, styles.lastShrink]} numberOfLines={1}>
            {chat.lastLine}
          </IconText>
        ) : (
          <Text style={[styles.last, unread > 0 && styles.lastUnread]} numberOfLines={1}>
            {chat.lastLine ?? (chat.kind === 'campfire' ? 'Nobody’s said anything yet' : 'Say hi')}
          </Text>
        )}
      </View>
      <View style={styles.meta}>
        {chat.lastAt ? <Text style={styles.when}>{formatRelativeTime(chat.lastAt)}</Text> : null}
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Mock 320's `.seg`: two pills, the active one ember, plus the search affordance.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  seg: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  segOn: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  segText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  segTextOn: {
    color: '#1A1030',
  },
  search: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chatsRoot: {
    flex: 1,
  },
  loader: {
    marginTop: Spacing.five,
  },
  live: {
    alignSelf: 'flex-start',
    marginBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  campfireAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  campfireEmoji: {
    fontSize: 20,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  nameUnread: {
    fontFamily: Fonts.bodyBold,
  },
  last: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  lastUnread: {
    color: Colors.ink,
  },
  lastShrink: {
    flexShrink: 1,
  },
  meta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  when: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceFaint,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.black,
    fontSize: 10.5,
    color: '#1A1030',
  },
  empty: {
    marginTop: Spacing.five,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  emptyBody: {
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.spaceDim,
    paddingHorizontal: Spacing.four,
  },
  emptyBtn: {
    marginTop: Spacing.two,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.navEmber,
  },
  emptyBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#1A1030',
  },
});
