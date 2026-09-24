import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { EmberFill } from '@/components/ui/ember-fill';
import { EmptyState } from '@/components/ui/empty-state';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useDmThread } from '@/hooks/use-dm-thread';
import { usePublicLoadouts, useRefreshPublicLoadoutsOnFocus } from '@/hooks/use-public-loadouts';
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
 * THE BUBBLES ARE THE CAMPFIRE'S (circle-timeline.tsx), not chat-panel's.
 *
 * They started as chat-panel's — flat coral for yours, a flat card for theirs, symmetric corners —
 * and chat-panel is itself no longer on screen anywhere: the campfire chat moved to CircleTimeline
 * and left it behind. So this screen was the last thing still wearing the pre-Ember look, and next
 * to a campfire it read as a different app: a bare page with an orange slab on it.
 *
 * What it takes from circle-timeline, and why each piece:
 *   · the ASYMMETRIC tail corner — the squared corner points at whoever's side the bubble came
 *     from, which is what tells the two sides apart before you read a word of it.
 *   · the EMBER GRADIENT on your own bubble (EmberFill under an `overflow: hidden` parent, so the
 *     paint takes the real asymmetric shape) instead of one flat `Colors.coral`.
 *   · `Colors.ink` on both sides. Legibility is the whole point of the complaint this fixes.
 *   · the composer: a pill field on a translucent shelf, with the round EmberFill send button.
 *
 * The sender NAME still stays off the bubbles — in a room with exactly two people, labelling every
 * bubble with whose it is only says what the alignment already said. What was missing is the rest
 * of the identity: incoming bubbles now carry the sender's equipped avatar gear AND their Title,
 * exactly as a campfire message does, so gear you paid for is worn in a DM too.
 */
export default function DmThreadScreen() {
  const router = useRouter();
  const { friendId } = useLocalSearchParams<{ friendId: string }>();
  const { profile: myProfile } = useAuth();
  const myUserId = myProfile?.id;

  const thread = useDmThread(friendId);
  // The shelf runs to the bottom EDGE, with the inset as padding inside it — same as the
  // campfire composer. `edges` above is top-only on purpose, so this is the one place that knows
  // about the gesture bar.
  const insets = useSafeAreaInsets();
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

  // Both participants in one call — see the batching note in economy/public-identity.tsx. A thread
  // has exactly two authors, so resolving them here rather than per bubble means a hundred-message
  // scroll fires no reads at all. Mine is fetched too so an own bubble can't fall back to
  // `useResolvedLoadout`'s self-fetch on one row and the batch on the next.
  const participants = useMemo(() => [friendId, myUserId], [friendId, myUserId]);
  const loadouts = usePublicLoadouts(participants);
  // A thread is a surface you leave (to their profile, to the shop) and come back to, so the gear
  // on it re-reads on focus like the friends list's does.
  useRefreshPublicLoadoutsOnFocus(participants);
  const friendLoadout = friendId ? (loadouts[friendId] ?? {}) : {};

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
          <CosmeticAvatar
            userId={friendId}
            name={name}
            avatarUrl={friend?.avatar_url}
            loadout={friendLoadout}
            size={32}
            motion="reduced"
          />
          <View style={styles.whoText}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {/* Their Title sits where the campfire's member/heat line sits — the one line under the
                name that says who you are looking at. It falls back to the handle when nothing is
                equipped, rather than leaving the row a name and a gap. */}
            {friendLoadout.title ? (
              <PublicTitle loadout={friendLoadout} compact />
            ) : friend?.handle ? (
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
                  // The joined author, with the header profile as the fallback: a row fetched
                  // before `friend` landed still has its own `profiles`, and `friend` still covers
                  // a row whose embed came back null.
                  const senderName = item.profiles?.display_name ?? name;
                  return (
                    <View style={[styles.msgRow, isOwn && styles.msgRowOwn]}>
                      {/* WS1 · the author wears their gear here too. `motion="reduced"` for the
                          same reason the friends list uses it: a thread is a list, and thirty
                          breathing auras scrolling past is noise, not identity. */}
                      {!isOwn && (
                        <View style={styles.avatar}>
                          <CosmeticAvatar
                            userId={item.sender_id}
                            name={senderName}
                            avatarUrl={item.profiles?.avatar_url ?? friend?.avatar_url}
                            loadout={loadouts[item.sender_id] ?? {}}
                            size={30}
                            motion="reduced"
                          />
                        </View>
                      )}
                      <View style={styles.msgBody}>
                        {/* The campfire's sender line, minus the name — see the note at the top of
                            this file. The Title is the part a two-person room does NOT already
                            say, so it is the part that stays. */}
                        {!isOwn && loadouts[item.sender_id]?.title ? (
                          <View style={styles.senderLine}>
                            <PublicTitle loadout={loadouts[item.sender_id] ?? {}} compact />
                          </View>
                        ) : null}
                        <Pressable
                          onLongPress={() => handleMore(item)}
                          style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                          {/* Painted UNDERNEATH via absoluteFill rather than as the Pressable's
                              background, because the bubble's corners are ASYMMETRIC and EmberFill
                              takes one radius. The parent clips with `overflow: 'hidden'`, so the
                              gradient takes the bubble's real shape including the 5px tail. */}
                          {isOwn && (
                            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                              <EmberFill style={styles.ownFill} radius={0} direction="diagonal" />
                            </View>
                          )}
                          <Text style={styles.bubbleBody}>{item.body}</Text>
                          <Text style={[styles.time, isOwn && styles.timeOwn]}>
                            {formatRelativeTime(item.created_at)}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }}
              />
            )}

            {/* The campfire composer: a pill field on a translucent shelf, and a send button that
                is LIT only when there is something to send. */}
            <View style={[styles.inputRow, { paddingBottom: Spacing.two + insets.bottom }]}>
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
                accessibilityRole="button"
                accessibilityLabel="Send">
                {draft.trim() && thread.threadId && !sending ? (
                  <EmberFill style={styles.send} radius={20} direction="diagonal">
                    <Ionicons name="send" size={16} color={Colors.onEmber} style={styles.sendGlyph} />
                  </EmberFill>
                ) : (
                  <View style={[styles.send, styles.sendOff]}>
                    <Ionicons name="send" size={16} color={Colors.textTertiary} style={styles.sendGlyph} />
                  </View>
                )}
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
  // ── the bubbles, straight off circle-timeline.tsx ───────────────────────────────────
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
    // No fixed box, no clip: CosmeticAvatar draws its own circle and needs room OUTSIDE it for the
    // halo ring and the flare, which an overflow:hidden 30x30 wrapper would have cut off.
    alignItems: 'center',
    justifyContent: 'center',
    // Sits at the bottom of a multi-line bubble.
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
  bubble: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  // Asymmetric "tail" corner — the squared corner points toward whoever's side the bubble came
  // from, which is how you tell the two sides apart at a glance.
  bubbleOther: {
    backgroundColor: 'rgba(36,28,56,0.86)',
    borderWidth: 1,
    borderColor: Colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: Radius.card,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  bubbleOwn: {
    // The solid coral stays as the UNDER-colour: EmberFill needs one layout pass to measure
    // before it can paint, and a transparent bubble for that frame would flash.
    backgroundColor: Colors.coral,
    overflow: 'hidden',
    // The tail tucks toward the composer, bottom-right — mock 174's `.mine`.
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
    // Both sides. The ember fill is dark enough at the coral end and the cream reads on it; a
    // tinted body colour is what made this screen look like orange-on-orange.
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
  // ── the composer, likewise ───────────────────────────────────────────────────
  // A translucent shelf rather than a hairline over an opaque bar, so the page's radial carries on
  // behind it the way the banner does behind a campfire's.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: 14,
    paddingTop: Spacing.two,
    // paddingBottom is applied inline — it carries the safe-area inset.
    backgroundColor: Colors.scrim,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: 'rgba(36,28,56,0.9)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {
    backgroundColor: Colors.disabledSurface,
    borderWidth: 1,
    borderColor: Colors.disabledBorder,
  },
  sendGlyph: {
    // Ionicons' paper plane sits visually low-left inside its box; nudge it back to centre.
    marginLeft: 2,
  },
});
