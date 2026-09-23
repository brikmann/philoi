import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CosmeticAvatar } from '@/components/economy/public-identity';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { EmptyState } from '@/components/ui/empty-state';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useDmThread } from '@/hooks/use-dm-thread';
import { track } from '@/lib/analytics';
import { deleteMyDm, sendDm, type DmThreadMessage } from '@/lib/api/dm';
import { fetchProfileById } from '@/lib/api/profile';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * One friend, one thread (WS3, MESSAGING_DM_SPEC.md, migration 0206).
 *
 * The route is keyed on the FRIEND, not on the thread: every entry point into this screen — the
 * Message button on a profile, the bubble on a friend row, a tapped `dm_received` notification —
 * knows who it means and does not know what thread id that resolves to. useDmThread does the
 * resolve. It is also why the `dm_received` push carries `/dm/[friendId]` with the sender's id: a
 * notification that had to carry a thread id would be one more thing to keep in step.
 *
 * The bubbles are chat-panel's, adapted off a groupId and with the sender name dropped — in a room
 * with exactly two people, labelling every bubble with whose it is just says what the alignment
 * already said. Authors carry their avatar instead.
 */
export default function DmThreadScreen() {
  const router = useRouter();
  const { friendId } = useLocalSearchParams<{ friendId: string }>();
  const { profile: myProfile } = useAuth();
  const myUserId = myProfile?.id;

  const thread = useDmThread(friendId);
  const [friend, setFriend] = useState<Profile | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!friendId) return;
    fetchProfileById(friendId).then(setFriend).catch(() => {});
  }, [friendId]);

  useEffect(() => {
    if (thread.threadId) track('dm_thread_opened', { friend_id: friendId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per resolved thread, not per render
  }, [thread.threadId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !thread.threadId) return;
    setSending(true);
    setDraft('');
    try {
      await sendDm(thread.threadId, body);
      // The realtime INSERT is the sender's own echo and arrives on the same channel, but a
      // refetch here means the bubble lands even if the socket is asleep — which on a cold
      // Android resume it often is.
      await thread.refetch();
    } catch (e) {
      // Put the text BACK in the box. A send that failed and also ate what you typed is the
      // version of this bug people actually complain about.
      setDraft(body);
      Alert.alert('Could not send', getErrorMessage(e, 'Try again.'));
    } finally {
      setSending(false);
    }
  }

  function handleMore(message: DmThreadMessage) {
    const isOwn = message.sender_id === myUserId;
    if (isOwn) {
      Alert.alert('Message options', '', [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMyDm(message.id);
              await thread.refetch();
            } catch (e) {
              Alert.alert('Could not delete', getErrorMessage(e, 'Try again.'));
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('Report or block', '', [
      { text: 'Report', onPress: () => router.push(`/report?userId=${message.sender_id}`) },
      {
        text: 'Block user',
        style: 'destructive',
        onPress: () => handleBlock(),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Blocking is mutual and server-enforced (is_blocked_either_way), so the thread disappears from
  // BOTH sides the moment this lands — including from the realtime feed, because postgres_changes
  // re-evaluates the same SELECT policy per subscriber. Nothing to clean up client-side; leaving
  // the screen is the whole of it.
  async function handleBlock() {
    if (!myUserId || !friendId) return;
    try {
      await supabase.from('blocked_users').insert({ blocker_id: myUserId, blocked_id: friendId });
      router.back();
      Alert.alert('User blocked', "You won't see their messages anymore.");
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Try again.'));
    }
  }

  const name = friend?.display_name ?? '…';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={Colors.muted} />
        </Pressable>

        <Pressable
          style={styles.who}
          onPress={() => friendId && router.push({ pathname: '/friend-profile', params: { userId: friendId } })}
          accessibilityLabel={`Open ${name}'s profile`}>
          <CosmeticAvatar userId={friendId} name={name} avatarUrl={friend?.avatar_url} size={32} motion="reduced" />
          <View style={styles.whoText}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {friend?.handle ? (
              <Text style={styles.handle} numberOfLines={1}>
                @{friend.handle}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <Pressable onPress={() => setMoreOpen(true)} hitSlop={8} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {/* The guardrails speak for themselves here. dm_open_thread refuses a non-friend or a
            blocked pair, and when it does, its message IS the screen — an empty thread with a live
            composer would invite a send that can only fail. */}
        {thread.error && !thread.threadId ? (
          <View style={styles.blocked}>
            <Text style={styles.blockedText}>{thread.error}</Text>
          </View>
        ) : (
          <>
            {thread.error ? <Text style={styles.error}>{thread.error}</Text> : null}

            {thread.loading && thread.messages.length === 0 ? (
              <View style={styles.loading}>
                <ActivityIndicator color={Colors.coral} />
              </View>
            ) : (
              <FlatList
                data={thread.messages}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  !thread.loading ? (
                    <EmptyState title="No messages yet" body={`Say something to ${name}.`} />
                  ) : null
                }
                renderItem={({ item }) => {
                  // Skip a kind this build has no renderer for. 0206 reserves 'challenge',
                  // 'invite' and 'cheer' and nothing writes them yet — but OTA is closed, so the
                  // shipped behaviour for an unknown kind has to be "render nothing", decided now.
                  if (item.kind !== 'text') return null;
                  const isOwn = item.sender_id === myUserId;
                  return (
                    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
                      {/* WS1 · the author wears their gear here too. `motion="reduced"` for the
                          same reason the friends list uses it: a thread is a list, and thirty
                          breathing auras scrolling past is noise, not identity. */}
                      {!isOwn && (
                        <CosmeticAvatar
                          userId={item.sender_id}
                          name={name}
                          avatarUrl={friend?.avatar_url}
                          size={26}
                          motion="reduced"
                        />
                      )}
                      <Pressable
                        onLongPress={() => handleMore(item)}
                        style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                        <Text style={styles.bubbleBody}>{item.body}</Text>
                        <Text style={[styles.time, isOwn && styles.timeOwn]}>
                          {formatRelativeTime(item.created_at)}
                        </Text>
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={`Message ${name}…`}
                value={draft}
                onChangeText={setDraft}
                maxLength={2000}
                multiline
              />
              <Pressable
                onPress={handleSend}
                disabled={sending || !draft.trim() || !thread.threadId}
                style={[styles.send, (sending || !draft.trim() || !thread.threadId) && styles.sendOff]}
                accessibilityLabel="Send">
                <Ionicons name="arrow-up" size={18} color={Colors.ink} />
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <ReportBlockSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onReport={() => router.push(`/report?userId=${friendId}`)}
        onBlock={handleBlock}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    // Transparent, not a flat fill: this screen doesn't route through <Screen>, so an opaque colour
    // here would paint over the navigator's deep-purple radial (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  whoText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  body: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blocked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.six,
  },
  blockedText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  list: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  bubbleOther: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  bubbleOwn: {
    backgroundColor: Colors.coral,
  },
  bubbleBody: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.75)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  input: {
    flex: 1,
    maxHeight: 100,
  },
  send: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.pill,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {
    opacity: 0.45,
  },
});
