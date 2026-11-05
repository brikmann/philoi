import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MuteBell } from '@/components/chat/chat-mute-button';
import { LiveFriendsChip } from '@/components/lockin-cheers/live-friends-chip';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Avatar } from '@/components/ui/avatar';
import { Icon, IconText, type IconName } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useChatSupport } from '@/hooks/use-chat-support';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { chatLiveKey, fetchChatLiveNow, fetchMyChats } from '@/lib/api/chat';
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
//
// Phase 8.4 (mock 337): under All the list is two sections — Your campfires & forests, then Friends —
// each row carrying a green active-now dot when someone in it is in a live lock-in (0291, Pulse's
// rule). A search field filters by name and last line, on the list already loaded; ＋ opens the
// existing ways in (message a friend, start a campfire, start a forest). No new messaging store.

// The dots' refresh floor while the tab is focused — the same 45s Pulse's live strip uses.
const LIVE_POLL_MS = 45_000;

type ChatSection = { title: string | null; data: SocialChat[] };

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
  const [query, setQuery] = useState('');
  const [live, setLive] = useState<Map<string, number>>(() => new Map());
  const [newOpen, setNewOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const empty = FILTER_EMPTY[filter];

  const sections = useMemo((): ChatSection[] | null => {
    if (!chats) return null;
    const q = query.trim().toLowerCase();
    const matched = chats
      .filter((c) => filter === 'all' || c.kind === filter)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.lastLine ?? '').toLowerCase().includes(q));
    if (filter !== 'all') return matched.length ? [{ title: null, data: matched }] : [];
    const rooms = matched.filter((c) => c.kind !== 'dm');
    const dms = matched.filter((c) => c.kind === 'dm');
    return [
      ...(rooms.length ? [{ title: 'Your campfires & forests', data: rooms }] : []),
      ...(dms.length ? [{ title: 'Friends', data: dms }] : []),
    ];
  }, [chats, filter, query]);

  // 0284 · with get_my_chats the list carries unread + mute for rooms too, and a forest row opens
  // the forest's room chat. fetchMyChats answers null on a server without it, and the list is
  // built exactly the old way — the switch is invisible either way.
  const rich = useChatSupport() === true;

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
      const fromServer = await fetchMyChats(userId).catch(() => null);
      setChats(fromServer ?? (await fetchMySocialChats(userId)));
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
      <AppTopBar
        title="Chat"
        right={
          <Pressable
            onPress={() => setNewOpen(true)}
            hitSlop={8}
            style={styles.newBtn}
            accessibilityRole="button"
            accessibilityLabel="New conversation">
            <Icon name="plus" size={16} color={Colors.ink} />
          </Pressable>
        }
      />
      <View style={styles.search}>
        <NavGlyph name="search" size={14} color={Colors.spaceDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor={Colors.spaceFaint}
          style={styles.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search conversations"
        />
      </View>
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
      {sections === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => `${c.kind}:${c.id}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (section.title ? <Text style={styles.sec}>{section.title}</Text> : null)}
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
            query.trim() ? (
              <View style={styles.empty}>
                <Text style={styles.emptyBody}>Nothing matches “{query.trim()}”.</Text>
              </View>
            ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{empty.title}</Text>
              <Text style={styles.emptyBody}>{empty.body}</Text>
              <Pressable style={styles.emptyBtn} onPress={() => router.push(empty.route as never)} accessibilityRole="button">
                <Text style={styles.emptyBtnText}>{empty.cta}</Text>
              </Pressable>
            </View>
            )
          }
          renderItem={({ item }) => <ChatRow chat={item} live={live.get(chatLiveKey(item)) ?? 0} onPress={() => open(item)} />}
        />
      )}
      <NewChatSheet visible={newOpen} onClose={() => setNewOpen(false)} />
    </View>
  );
}

/**
 * ＋ — the ways into a new conversation that already exist. A Modal sheet, not an Alert: Android caps
 * an Alert at three buttons and would drop Cancel.
 */
function NewChatSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const go = (route: string) => {
    onClose();
    router.push(route as never);
  };
  const options: { icon: IconName; label: string; sub: string; route: string }[] = [
    { icon: 'chat', label: 'Message a friend', sub: 'DMs are between friends', route: '/people' },
    { icon: 'campfire', label: 'Start a campfire', sub: 'A small group that locks in together', route: '/group/create' },
    { icon: 'forest', label: 'Start a forest', sub: 'A bigger room around a class, gym or goal', route: '/forest/create' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <Text style={styles.sheetTitle}>New conversation</Text>
          {options.map((o) => (
            <Pressable
              key={o.route}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
              onPress={() => go(o.route)}
              accessibilityRole="button"
              accessibilityLabel={o.label}>
              <Icon name={o.icon} size={18} color={Colors.navEmber2} />
              <View style={styles.rowText}>
                <Text style={styles.name}>{o.label}</Text>
                <Text style={styles.last}>{o.sub}</Text>
              </View>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={styles.sheetCancel} accessibilityRole="button">
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ChatRow({ chat, live, onPress }: { chat: SocialChat; live: number; onPress: () => void }) {
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
      accessibilityLabel={`${chat.name}${chat.kind === 'campfire' ? ', campfire chat' : chat.kind === 'forest' ? ', forest' : ''}${live > 0 ? (chat.kind === 'dm' ? ', locked in now' : `, ${live} locked in now`) : ''}${unread > 0 ? `, ${unread} unread` : ''}${muted ? ', muted' : ''}`}>
      <View>
        {chat.kind === 'campfire' || chat.kind === 'forest' ? (
          <View style={[styles.avatar, styles.campfireAvatar]}>
            <Text style={styles.campfireEmoji}>{chat.emoji}</Text>
          </View>
        ) : chat.avatarUrl ? (
          <Image source={{ uri: chat.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Avatar label={(chat.name || '?').slice(0, 2).toUpperCase()} size={44} />
        )}
        {/* 0291 · someone here is in a live lock-in right now. */}
        {live > 0 ? <View style={styles.liveDot} /> : null}
      </View>
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
        {live > 0 && chat.kind !== 'dm' ? <Text style={styles.liveText}>{live} locked in</Text> : null}
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
  newBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 9,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 10,
    marginBottom: 4,
    marginHorizontal: 2,
  },
  liveDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: Colors.green,
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
  liveText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.green,
  },
  pressed: {
    opacity: 0.8,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,14,0.6)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    marginBottom: Spacing.one,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  sheetCancel: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  sheetCancelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.spaceDim,
  },
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
