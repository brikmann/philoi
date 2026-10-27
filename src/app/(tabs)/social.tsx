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
//   • Chats — campfire group chats, your forests and DMs in one list, filtered by kind
//     (All · DMs · Campfires · Forests), with the locked-in-with-you panel (0270's session threads)
//     on top when it has something.
//
// Search is the top bar's 🔍 on every tab now (pre-submission E11), not a button on this row — so
// the Feed · Chats toggle and search's own discovery categories never share a bar.
//
// ?channel=campfire:<id> (a campfire's "posts" button) opens the Feed on that channel.

type Pane = 'feed' | 'chats';

export default function SocialScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ channel?: string; pane?: string }>();
  const [pane, setPane] = useState<Pane>(params.pane === 'chats' ? 'chats' : 'feed');

  const toggle = <PaneToggle pane={pane} onChange={setPane} />;

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

function PaneToggle({ pane, onChange }: { pane: Pane; onChange: (p: Pane) => void }) {
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
    </View>
  );
}

// Pre-submission B6: sort Chats by what kind of conversation it is. A filter on the one list —
// no second fetch, no ranking.
type ChatFilter = 'all' | 'dm' | 'campfire' | 'forest';
const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'dm', label: 'DMs' },
  { key: 'campfire', label: 'Campfires' },
  { key: 'forest', label: 'Forests' },
];
const FILTER_EMPTY: Record<ChatFilter, { title: string; body: string; cta: string; route: string }> = {
  all: { title: 'No chats yet', body: 'Join a campfire for a group chat, or message a friend from their profile.', cta: 'Find a campfire', route: '/campfires' },
  dm: { title: 'No DMs yet', body: 'Message a friend from their profile — DMs are between friends.', cta: 'Find people', route: '/people' },
  campfire: { title: 'No campfires yet', body: 'A campfire is a small group that locks in together, with its own chat.', cta: 'Find a campfire', route: '/campfires' },
  forest: { title: 'No forests yet', body: 'Forests are bigger rooms around a class, a gym or a goal.', cta: 'Browse forests', route: '/forests' },
};

function ChatsPane({ toggle }: { toggle: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [chats, setChats] = useState<SocialChat[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const shown = chats && filter !== 'all' ? chats.filter((c) => c.kind === filter) : chats;
  const empty = FILTER_EMPTY[filter];

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
    else if (chat.kind === 'forest') router.push({ pathname: '/forest/[id]', params: { id: chat.id } } as never);
    else router.push({ pathname: '/dm/[friendId]', params: { friendId: chat.friendId } });
  }

  return (
    <View style={[styles.chatsRoot, { paddingTop: insets.top }]}>
      <AppTopBar title="Social" />
      {toggle}
      <View style={styles.filterRow} accessibilityRole="tablist">
        {CHAT_FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              style={[styles.filter, on && styles.filterOn]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.filterText, on && styles.filterTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {shown === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={shown}
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
              <Text style={styles.emptyTitle}>{empty.title}</Text>
              <Text style={styles.emptyBody}>{empty.body}</Text>
              <Pressable style={styles.emptyBtn} onPress={() => router.push(empty.route as never)} accessibilityRole="button">
                <Text style={styles.emptyBtnText}>{empty.cta}</Text>
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
      accessibilityLabel={`${chat.name}${chat.kind === 'campfire' ? ', campfire chat' : chat.kind === 'forest' ? ', forest' : ''}${unread > 0 ? `, ${unread} unread` : ''}`}>
      {chat.kind === 'campfire' || chat.kind === 'forest' ? (
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
        ) : chat.kind === 'forest' ? (
          <Text style={styles.last} numberOfLines={1}>
            {chat.memberCount} {chat.memberCount === 1 ? 'member' : 'members'}
            {chat.lastAt ? '' : ' · nothing posted yet'}
          </Text>
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
  // Mock 320's `.seg`: two pills, the active one ember.
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
  // The kind filter: smaller and quieter than the Feed · Chats toggle above it, so the two rows
  // read as a pane switch and a filter within it.
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  filter: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  filterOn: {
    backgroundColor: Colors.spacePanel2,
    borderColor: Colors.navEmber2,
  },
  filterText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  filterTextOn: {
    color: Colors.navEmber2,
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
