import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatAttachmentList } from '@/components/chat/chat-attachments';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageSheet } from '@/components/chat/chat-message-sheet';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { EmberFill } from '@/components/ui/ember-fill';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SpaceIconButton } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useChatSupport, useMarkRoomReadWhileFocused } from '@/hooks/use-chat-support';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { blockUser } from '@/lib/api/agora';
import {
  chatDeleteMyMessage,
  chatMarkRead,
  fetchForestMessages,
  reportChatMessage,
  subscribeToForestChat,
  type ForestChatMessage,
} from '@/lib/api/chat';
import { fetchForest } from '@/lib/api/forests';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import type { ForestDetail } from '@/types/social';

// A FOREST'S ROOM CHAT (0284 · forest_messages).
//
// Until 0284 a forest had no chat — only its Agora channel, which is posts. This is the room's
// conversation: the DM thread's bubbles and composer, with the sender NAMED on every incoming
// bubble because a room has more than two people in it (the DM leaves names off; here alignment
// alone can't say who spoke).
//
// Membership is the server's: "forest_messages: read if member" gates every read (and the realtime
// feed, which re-evaluates it per subscriber), chat_send refuses a non-member. A non-member who
// lands here — a stale push, a forest they left — gets the room's own refusal and a way back to
// the forest page, never an empty thread with a live composer.
//
// Reached from the forest page's Chat button and from Social → Chats forest rows. NEITHER is drawn
// without 0284, so the only way here on an old server is a hand-typed link — and then the screen
// says so and points back at the forest instead of erroring.

export default function ForestChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const myUserId = profile?.id;
  const insets = useSafeAreaInsets();
  const supported = useChatSupport();

  const [forest, setForest] = useState<ForestDetail | null>(null);
  const [messages, setMessages] = useState<ForestChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<ForestChatMessage | null>(null);
  const listRef = useRef<FlatList<ForestChatMessage>>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchForest(id)
      .then((f) => {
        if (live) setForest(f);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);

  const refetch = useCallback(async () => {
    if (!id) return;
    try {
      const rows = await fetchForestMessages(id);
      setMessages(rows);
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load this chat.'));
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    if (!id || supported !== true) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to (same as use-dm-thread)
    void refetch();
    return subscribeToForestChat(id, () => {
      void refetch();
      // Reading it live is reading it — the same reason use-dm-thread marks on every arrival.
      chatMarkRead('forest', id).catch(() => {});
    });
  }, [id, supported, refetch]);

  useMarkRoomReadWhileFocused('forest', id, supported);

  const senders = useMemo(() => [...new Set(messages.map((m) => m.sender_id))], [messages]);
  const loadouts = usePublicLoadouts(senders);

  const isMember = forest?.my_status === 'active';
  const name = forest?.name ?? 'Forest';

  async function block(userId: string) {
    if (!myUserId) return;
    try {
      await blockUser(myUserId, userId);
      await refetch();
      Alert.alert('User blocked', "You won't see their messages anymore.");
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Try again.'));
    }
  }

  const header = (
    <View style={[styles.top, { paddingTop: Spacing.two + insets.top }]}>
      <SpaceIconButton onPress={() => router.back()} label="Back">
        <UiGlyph name="back" size={20} color={Colors.ink} />
      </SpaceIconButton>
      <Pressable
        style={styles.who}
        onPress={() => id && router.push({ pathname: '/forest/[id]', params: { id } } as never)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}>
        <View style={styles.roomGlyph}>
          {/* The forest's emoji is the owner's choice — content, not chrome. */}
          <Text style={styles.roomEmoji}>{forest?.emoji ?? ''}</Text>
        </View>
        <View style={styles.whoText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {forest ? (
            <Text style={styles.sub} numberOfLines={1}>
              {forest.member_count.toLocaleString()} {forest.member_count === 1 ? 'member' : 'members'}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );

  // Without 0284 there is no room chat to show. Say so and point back — never an error.
  if (supported === false) {
    return (
      <Screen padded={false} edges={[]}>
        <Stack.Screen options={{ headerShown: false }} />
        {header}
        <View style={styles.center}>
          <EmptyState
            glyph="chat"
            title="Forest chat is on its way"
            body="This forest's conversation happens in its feed for now."
          />
        </View>
      </Screen>
    );
  }

  // The room refused us (left, removed, request pending) — its rule is the whole screen.
  const shut = forest !== null && !isMember;

  return (
    <Screen padded={false} edges={[]}>
      <Stack.Screen options={{ headerShown: false }} />
      {header}

      <View style={styles.body}>
        {shut ? (
          <View style={styles.center}>
            <Text style={styles.shutText}>Join this forest to chat in it.</Text>
          </View>
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!loaded || supported === null ? (
              <View style={styles.center}>
                <ActivityIndicator color={Colors.navEmber} />
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(m) => m.id}
                style={styles.flatlist}
                contentContainerStyle={styles.list}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <EmptyState glyph="chat" title="No messages yet" body={`Say something to ${name}.`} />
                }
                renderItem={({ item }) => {
                  const isOwn = item.sender_id === myUserId;
                  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
                  const hasText = Boolean(item.body?.trim());
                  if (!hasText && attachments.length === 0) return null;
                  const senderName = item.profiles?.display_name ?? 'Someone';
                  const loadout = loadouts[item.sender_id] ?? {};
                  return (
                    <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
                      {!isOwn ? (
                        <Pressable
                          style={styles.avatar}
                          onPress={() => router.push({ pathname: '/friend-profile', params: { userId: item.sender_id } })}
                          accessibilityLabel={`Open ${senderName}'s profile`}>
                          <CosmeticAvatar
                            userId={item.sender_id}
                            name={senderName}
                            avatarUrl={item.profiles?.avatar_url}
                            loadout={loadout}
                            size={30}
                            motion="reduced"
                          />
                        </Pressable>
                      ) : null}
                      <View style={styles.msgBody}>
                        {!isOwn ? (
                          <View style={styles.senderLine}>
                            <Text style={styles.senderName} numberOfLines={1}>
                              {senderName}
                            </Text>
                            {loadout.title ? <PublicTitle loadout={loadout} compact /> : null}
                          </View>
                        ) : null}
                        {hasText ? (
                          <Pressable
                            onLongPress={() => setSheetFor(item)}
                            style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                            {isOwn ? (
                              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                                <EmberFill style={styles.ownFill} radius={0} direction="diagonal" />
                              </View>
                            ) : null}
                            <Text style={styles.bubbleBody}>{item.body}</Text>
                            {attachments.length === 0 ? (
                              <Text style={[styles.time, isOwn && styles.timeOwn]}>
                                {formatRelativeTime(item.created_at)}
                              </Text>
                            ) : null}
                          </Pressable>
                        ) : null}
                        {attachments.length > 0 ? (
                          <Pressable
                            onLongPress={() => setSheetFor(item)}
                            style={[styles.attachments, isOwn && styles.attachmentsOwn]}>
                            <ChatAttachmentList attachments={attachments} />
                            <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                }}
              />
            )}

            <ChatComposer
              scope="forest"
              roomId={supported === true && id ? id : null}
              userId={myUserId}
              rich={supported === true}
              placeholder={`Message ${name}…`}
              bottomInset={insets.bottom}
              onSent={refetch}
            />
          </>
        )}
      </View>

      <ChatMessageSheet
        visible={sheetFor !== null}
        own={sheetFor?.sender_id === myUserId}
        onClose={() => setSheetFor(null)}
        onDelete={async () => {
          if (!sheetFor) return;
          try {
            await chatDeleteMyMessage('forest', sheetFor.id);
            await refetch();
          } catch (e) {
            Alert.alert('Could not delete', getErrorMessage(e, 'Try again.'));
            throw e;
          }
        }}
        onReport={async (reason) => {
          if (!sheetFor) return;
          try {
            await reportChatMessage('forest', sheetFor.id, reason);
          } catch (e) {
            Alert.alert('Could not report', getErrorMessage(e, 'Try again.'));
            throw e;
          }
        }}
        onBlock={() => {
          if (sheetFor) void block(sheetFor.sender_id);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  roomGlyph: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomEmoji: {
    fontSize: 17,
  },
  whoText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.black,
    fontSize: 17,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  body: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.six,
  },
  shutText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.danger,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  flatlist: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  // ── the DM's bubbles (dm/[friendId].tsx), plus a name line ──
  msgRow: {
    flexDirection: 'row',
    gap: 9,
    maxWidth: '86%',
  },
  msgRowOwn: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  msgBody: {
    flexShrink: 1,
  },
  senderLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: 2,
  },
  senderName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.spaceDim,
    flexShrink: 1,
  },
  bubble: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  bubbleOther: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  bubbleOwn: {
    backgroundColor: Colors.coral,
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 6,
  },
  ownFill: {
    flex: 1,
  },
  bubbleBody: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceDim,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.75)',
  },
  attachments: {
    gap: 2,
    marginTop: 4,
    alignItems: 'flex-start',
  },
  attachmentsOwn: {
    alignItems: 'flex-end',
  },
});
