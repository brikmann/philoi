import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MuteBell } from '@/components/chat/chat-mute-button';
import { LiveFriendsChip } from '@/components/lockin-cheers/live-friends-chip';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Avatar } from '@/components/ui/avatar';
import { IconText } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useChatSupport } from '@/hooks/use-chat-support';
import { fetchMyChats } from '@/lib/api/chat';
import { fetchMySocialChats, type SocialChat } from '@/lib/api/social-chats';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/format';

// CHAT (mock 331) — the club's home base, its own tab now. Every conversation you're part of in one
// list: DMs with friends, your campfires' group chats and your forests, filtered by kind
// (All · DMs · Campfires · Forests), with the locked-in-with-you panel (0270's session threads) on
// top when it has something. Newest first, never ranked.
//
// This was the Social tab's second pane (mock 320) until the connection-first bar split Social into
// Discover (the feed) and Chat (this), so a conversation is one tap from anywhere.

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

export function ChatsHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;
  const [chats, setChats] = useState<SocialChat[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const shown = chats && filter !== 'all' ? chats.filter((c) => c.kind === filter) : chats;
  const empty = FILTER_EMPTY[filter];

  // 0284 · with get_my_chats the list carries unread + mute for rooms too, and a forest row opens
  // the forest's room chat. fetchMyChats answers null on a server without it, and the list is
  // built exactly the old way — the switch is invisible either way.
  const rich = useChatSupport() === true;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const fromServer = await fetchMyChats(userId).catch(() => null);
      setChats(fromServer ?? (await fetchMySocialChats(userId)));
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
    else if (chat.kind === 'forest')
      router.push(
        (rich
          ? { pathname: '/forest-chat/[id]', params: { id: chat.id } }
          : { pathname: '/forest/[id]', params: { id: chat.id } }) as never
      );
    else router.push({ pathname: '/dm/[friendId]', params: { friendId: chat.friendId } });
  }

  return (
    <View style={[styles.chatsRoot, { paddingTop: insets.top }]}>
      <AppTopBar title="Chat" />
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
  // A DM always has a count; a room has one only from get_my_chats (0284).
  const unread = chat.unread ?? 0;
  // 0284 · get_my_chats' mute bit (a campfire's is its group_members.chat_muted, switched from the
  // campfire's own sheet). Absent on the old path, which has no mute to show.
  const muted = chat.muted === true;
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}${chat.kind === 'campfire' ? ', campfire chat' : chat.kind === 'forest' ? ', forest' : ''}${unread > 0 ? `, ${unread} unread` : ''}${muted ? ', muted' : ''}`}>
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
        {chat.kind !== 'dm' && chat.lastIcon && chat.lastLine ? (
          <IconText icon={chat.lastIcon} style={[styles.last, styles.lastShrink, unread > 0 && styles.lastUnread]} numberOfLines={1}>
            {chat.lastLine}
          </IconText>
        ) : chat.kind === 'forest' && !chat.lastLine ? (
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
        {unread > 0 || muted ? (
          <View style={styles.metaMarks}>
            {muted ? <MuteBell muted size={13} color={Colors.spaceFaint} /> : null}
            {/* A muted room still counts what you missed — it just stops shouting about it, so the
                badge goes quiet with it rather than disappearing. */}
            {unread > 0 ? (
              <View style={[styles.badge, muted && styles.badgeMuted]}>
                <Text style={[styles.badgeText, muted && styles.badgeTextMuted]}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The kind filter: small pills under the bar — a filter on the one list, never a second fetch.
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
  badgeMuted: {
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  badgeTextMuted: {
    color: Colors.spaceDim,
  },
  metaMarks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
