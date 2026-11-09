import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { chatMarkRead, fetchChatLiveNow } from '@/lib/api/chat';
import { campfirePhotoUrl, messagePhotoPaths } from '@/lib/api/messages';
import {
  fetchRoomGate,
  fetchRoomMessages,
  groupRoomMessages,
  roomNameColor,
  RoomsNotLiveError,
  sendRoomMessage,
  subscribeToRoom,
  type RoomGate,
  type RoomMessage,
} from '@/lib/api/rooms';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// ROOM CHAT (ShareSpot mock 380) — Discord-style. Channel pills (# general, # runs, # pr-wall…, the
// room's `channels`, 0297), LEFT-ALIGNED grouped messages: avatar + coloured name + time on the first
// of a run, consecutive messages from the same author within 5 min stacked under it. Realtime via one
// postgres_changes subscription for the whole room; an insert in another channel just marks that pill.
//
// Group chats live HERE, never in Messages (DMs only). Members-only by RLS ("messages: read if
// member"), so a code room's chat is unreadable to anyone who hasn't got in through the gate.
// A pre-0297 server has no `channel` column; then this falls back to the legacy campfire screen.

const SYSTEM_LINE: Record<string, string> = {
  member_joined: 'joined the room 👋',
};

export default function RoomChatScreen() {
  const router = useRouter();
  const { id, channel: initialChannel } = useLocalSearchParams<{ id: string; channel?: string }>();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const [gate, setGate] = useState<RoomGate | null>(null);
  const [channel, setChannel] = useState(initialChannel || 'general');
  const [messages, setMessages] = useState<RoomMessage[] | null>(null);
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  // Read by the realtime callback, which outlives any one render. Written only in selectChannel.
  const channelRef = useRef(channel);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      fetchRoomGate(id)
        .then((g) => {
          if (!g || !g.is_member) {
            router.replace(g?.room.join_policy === 'code' ? { pathname: '/room/[id]/code', params: { id } } : { pathname: '/room/[id]', params: { id } });
            return;
          }
          setGate(g);
        })
        .catch((e) => {
          if (e instanceof RoomsNotLiveError) router.replace({ pathname: '/group/[groupId]', params: { groupId: id } });
          else setError(getErrorMessage(e, 'Could not open this room.'));
        });
      fetchChatLiveNow()
        .then((m) => setOnline(m.get(`campfire:${id}`) ?? 0))
        .catch(() => {});
      void chatMarkRead('campfire', id).catch(() => {});
    }, [id, router])
  );

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await fetchRoomMessages(id, channelRef.current);
      setError(null);
      setMessages(rows);
    } catch (e) {
      if (e instanceof RoomsNotLiveError) {
        router.replace({ pathname: '/group/[groupId]', params: { groupId: id } });
        return;
      }
      setError(getErrorMessage(e, 'Could not load messages.'));
      setMessages((prev) => prev ?? []);
    }
  }, [id, router]);

  // First load on focus (and again on returning to the screen).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const selectChannel = (c: string) => {
    if (c === channelRef.current) return;
    channelRef.current = c;
    setChannel(c);
    setMessages(null);
    setUnseen((prev) => {
      const next = new Set(prev);
      next.delete(c);
      return next;
    });
    void load();
  };

  useEffect(() => {
    if (!id) return;
    return subscribeToRoom(id, (row) => {
      const c = row.channel ?? 'general';
      if (c === channelRef.current) void load();
      else setUnseen((prev) => new Set(prev).add(c));
    });
  }, [id, load]);

  const groups = useMemo(() => groupRoomMessages(messages ?? []), [messages]);

  const send = async () => {
    if (!id || !me || !draft.trim() || sending) return;
    const body = draft;
    setDraft('');
    setSending(true);
    try {
      await sendRoomMessage(id, me, channel, body);
      await load();
    } catch (e) {
      setDraft(body);
      Alert.alert('Not sent', getErrorMessage(e, 'Could not send that.'));
    } finally {
      setSending(false);
    }
  };

  const channels = gate?.room.channels ?? ['general'];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Pressable
            style={styles.headText}
            onPress={() => id && router.push({ pathname: '/room/[id]', params: { id } })}
            accessibilityRole="button">
            <Text style={styles.title} numberOfLines={1}>
              <Text style={styles.hash}># </Text>
              {channel}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {gate?.room.emoji} {gate?.room.name}
              {online > 0 ? ` · ${online} online` : ''}
            </Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills} style={styles.pillBar}>
          {channels.map((c) => (
            <Pressable
              key={c}
              onPress={() => selectChannel(c)}
              style={[styles.pill, c === channel && styles.pillOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: c === channel }}>
              <Text style={[styles.pillText, c === channel && styles.pillTextOn]}># {c}</Text>
              {unseen.has(c) ? <View style={styles.pillDot} /> : null}
            </Pressable>
          ))}
        </ScrollView>

        {messages === null ? (
          <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.five }} />
        ) : (
          <FlatList
            ref={listRef}
            data={groups}
            keyExtractor={(g) => g.head.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.empty}>{error ?? `This is the start of # ${channel}. Say something.`}</Text>
            }
            renderItem={({ item: g }) =>
              g.head.system_event ? (
                <Text style={styles.system}>
                  <Text style={styles.systemName}>{g.head.profiles?.display_name ?? 'Someone'}</Text>{' '}
                  {SYSTEM_LINE[g.head.system_event] ?? ''}
                </Text>
              ) : (
                <View style={styles.group}>
                  <Pressable onPress={() => router.push({ pathname: '/friend-profile', params: { userId: g.head.user_id } })}>
                    {g.head.profiles?.avatar_url ? (
                      <Image source={{ uri: g.head.profiles.avatar_url }} style={styles.avatar} />
                    ) : (
                      <Avatar label={(g.head.profiles?.display_name || '?').slice(0, 2).toUpperCase()} size={36} />
                    )}
                  </Pressable>
                  <View style={styles.groupBody}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, { color: roomNameColor(g.head.user_id) }]}>
                        {g.head.profiles?.display_name ?? 'Someone'}
                      </Text>
                      <Text style={styles.time}>{clock(g.head.created_at)}</Text>
                    </View>
                    {[g.head, ...g.rest].map((m) => (
                      <MessageBody key={m.id} m={m} />
                    ))}
                  </View>
                </View>
              )
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message # ${channel}`}
            placeholderTextColor={Colors.spaceDim}
            style={styles.input}
            multiline
            maxLength={2000}
            accessibilityLabel={`Message # ${channel}`}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendOff]}
            accessibilityRole="button"
            accessibilityLabel="Send">
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBody({ m }: { m: RoomMessage }) {
  const photos = messagePhotoPaths({ attach_paths: (m.attach_paths ?? []) as never, attach_path: m.attach_path } as never);
  return (
    <View style={styles.msg}>
      {m.body ? <Text style={styles.body}>{m.body}</Text> : null}
      {photos.length > 0 ? (
        <View style={styles.photos}>
          {photos.slice(0, 4).map((p) => (
            <Image key={p} source={{ uri: campfirePhotoUrl(p) }} style={styles.photo} contentFit="cover" />
          ))}
        </View>
      ) : null}
      {m.attach_kind === 'lockin' ? (
        <View style={styles.embed}>
          <Text style={styles.embedTitle}>🔥 Lock-in session</Text>
          <Text style={styles.embedSub}>Shared to the room</Text>
        </View>
      ) : m.attach_kind === 'challenge' ? (
        <View style={styles.embed}>
          <Text style={styles.embedTitle}>🏁 Room challenge</Text>
          <Text style={styles.embedSub}>Open the room to join in</Text>
        </View>
      ) : null}
    </View>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  back: { fontSize: 28, color: Colors.ink, marginTop: -4 },
  headText: { flex: 1 },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  hash: { color: Colors.spaceDim },
  sub: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.spaceDim },
  pillBar: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: Colors.spaceLine },
  pills: { gap: 6, paddingHorizontal: Spacing.three, paddingBottom: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  pillOn: { backgroundColor: Colors.spacePanel2, borderColor: Colors.navEmber },
  pillText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.muted },
  pillTextOn: { color: Colors.ink },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.navEmber },
  list: { paddingHorizontal: Spacing.three, paddingVertical: 12, gap: 14, flexGrow: 1 },
  empty: { marginTop: Spacing.five, textAlign: 'center', fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim },
  system: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim, paddingLeft: 46 },
  systemName: { fontFamily: Fonts.bodySemiBold, color: Colors.muted },
  group: { flexDirection: 'row', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  groupBody: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 14 },
  time: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.spaceDim },
  msg: { gap: 6 },
  body: { fontFamily: Fonts.body, fontSize: 14, lineHeight: 20, color: Colors.ink },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  photo: { width: 130, height: 130, borderRadius: 10, backgroundColor: Colors.spacePanel2 },
  embed: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderLeftWidth: 3,
    borderLeftColor: Colors.navEmber,
    gap: 2,
  },
  embedTitle: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.ink },
  embedSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    margin: Spacing.three,
    marginTop: 6,
    padding: 6,
    paddingLeft: 14,
    borderRadius: 22,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  input: { flex: 1, maxHeight: 120, paddingVertical: 8, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink },
  sendBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.navEmber, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { fontFamily: Fonts.black, fontSize: 16, color: Colors.onEmber },
});
