import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FriendFace, UnreadBadge } from '@/components/lockin-cheers/friend-faces';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { blockUser } from '@/lib/api/agora';
import {
  CHEER_PRESETS,
  LOCKIN_MESSAGE_MAX,
  THREAD_QUICK_LINES,
  fetchLockInThread,
  friendActivityLabel,
  reportLockInThread,
  sendCheer,
  sendLockInMessage,
  timeInLabel,
  type CheerPreset,
  type FriendLockedIn,
  type LockInThreadMessage,
} from '@/lib/api/lockin-cheers';
import { getErrorMessage } from '@/lib/errors';

/**
 * The one presence panel both entry points open (mock 298, panels 2 + 3): every friend live right
 * now, each with 🔥 Cheer and 💬 Message inline, and a light 1:1 thread reached only from here.
 *
 * You can message any friend who is live, locked in yourself or not, and a thread stays open while
 * at least one of you is — a friend who wrote to you and has since stopped stays listed (no 🔥,
 * since there is no session to cheer) until you stop too. When neither is live the friend drops
 * off the list and an open thread says it closed; nothing is kept to come back to.
 */
export function LockInCheersSheet({
  visible,
  onClose,
  friends,
  meId,
  meLive,
  inboundSeq,
  onCheered,
  onThreadRead,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  friends: FriendLockedIn[];
  meId: string | null;
  /** Whether the viewer has a live session — only changes the copy. */
  meLive: boolean;
  inboundSeq: number;
  onCheered: (userId: string) => void;
  onThreadRead: (userId: string) => void;
  onChanged: () => void;
}) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // A snapshot taken when the thread opens, so its header can still name them after they stop.
  const [threadWith, setThreadWith] = useState<FriendLockedIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  // Every open starts on the list.
  const close = () => {
    setPickerFor(null);
    setThreadWith(null);
    setError(null);
    onClose();
  };

  const handleCheer = async (friend: FriendLockedIn, preset: CheerPreset) => {
    setSending(friend.userId);
    setError(null);
    try {
      await sendCheer(friend.userId, preset);
      onCheered(friend.userId);
      setPickerFor(null);
    } catch (e) {
      setError(getErrorMessage(e, 'That cheer didn’t send.'));
      onChanged();
    } finally {
      setSending(null);
    }
  };

  const openThread = (friend: FriendLockedIn) => {
    setError(null);
    setPickerFor(null);
    setThreadWith(friend);
  };

  const threadFriend = threadWith ? friends.find((f) => f.userId === threadWith.userId) : undefined;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          {threadWith ? (
            <ThreadView
              key={threadWith.userId}
              withUserId={threadWith.userId}
              name={threadWith.name}
              friend={threadFriend}
              meId={meId}
              inboundSeq={inboundSeq}
              onBack={() => setThreadWith(null)}
              onRead={onThreadRead}
            />
          ) : (
            <>
              <Text style={styles.title}>
                {meLive ? 'Locked in with you' : 'Friends locked in now'} · {friends.filter((f) => f.live).length} live
              </Text>
              <Text style={styles.sub}>
                {meLive
                  ? 'Send a cheer or a quick message — they won’t break focus either way. Back to your timer when you’re done.'
                  : 'Send a cheer or a quick message — it won’t break their focus, and you don’t need to start a session.'}
              </Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {friends.length === 0 && <Text style={styles.empty}>Nobody’s locked in right now.</Text>}
                {friends.map((f) => (
                  <View key={f.userId}>
                    <View style={styles.row}>
                      <FriendFace name={f.name} avatarUrl={f.avatarUrl} size={36} live />
                      <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>
                          {f.name}
                        </Text>
                        <Text style={styles.activity} numberOfLines={1}>
                          {friendActivityLabel(f)}{' '}
                          <Text style={styles.activityTime}>
                            · {!f.startedAt ? 'thread open' : f.paused ? 'paused' : timeInLabel(f.startedAt)}
                          </Text>
                        </Text>
                      </View>
                      <View style={styles.actions}>
                        {!f.live ? null : f.iCheered ? (
                          <View style={[styles.iconButton, styles.iconDone]} accessibilityLabel={`Cheered ${f.name}`}>
                            <UiGlyph name="check" size={18} color={Colors.green} />
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setPickerFor((cur) => (cur === f.userId ? null : f.userId))}
                            style={[styles.iconButton, styles.iconCheer]}
                            disabled={sending === f.userId}
                            accessibilityRole="button"
                            accessibilityLabel={`Cheer ${f.name}`}>
                            <NavGlyph name="flame" size={18} color="#2A0F05" />
                          </Pressable>
                        )}
                        <Pressable
                          onPress={() => openThread(f)}
                          style={[styles.iconButton, f.unread > 0 && styles.iconReply]}
                          accessibilityRole="button"
                          accessibilityLabel={`Message ${f.name}`}>
                          <UiGlyph name="send" size={17} color={f.unread > 0 ? Colors.navEmber2 : Colors.ink} />
                          <UnreadBadge count={f.unread} ringColor={Colors.spacePanel} />
                        </Pressable>
                      </View>
                    </View>
                    {pickerFor === f.userId && f.live && !f.iCheered && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker} contentContainerStyle={styles.pickerContent}>
                        {CHEER_PRESETS.map((p) => (
                          <Pressable
                            key={p.key}
                            onPress={() => handleCheer(f, p.key)}
                            disabled={sending === f.userId}
                            style={({ pressed }) => [styles.preset, pressed && styles.pressed]}
                            accessibilityRole="button"
                            accessibilityLabel={p.line}>
                            <Text style={styles.presetEmoji}>{p.emoji}</Text>
                            <Text style={styles.presetLabel}>{p.short}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const THREAD_POLL_MS = 15_000;

function ThreadView({
  withUserId,
  name,
  friend,
  meId,
  inboundSeq,
  onBack,
  onRead,
}: {
  withUserId: string;
  name: string;
  /** Undefined once they're no longer live — the thread has closed. */
  friend: FriendLockedIn | undefined;
  meId: string | null;
  inboundSeq: number;
  onBack: () => void;
  onRead: (userId: string) => void;
}) {
  const [messages, setMessages] = useState<LockInThreadMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const closed = friend === undefined;
  // Ephemeral by design: once it closes, what was on screen goes too.
  const shown = closed ? [] : messages;

  const load = useCallback(() => {
    fetchLockInThread(withUserId)
      .then((rows) => {
        setMessages(rows);
        onRead(withUserId);
      })
      // The next tick or inbound event retries.
      .catch(() => {});
  }, [withUserId, onRead]);

  // Re-read the moment anything lands for us, and on a slow poll as the floor.
  useEffect(load, [load, inboundSeq]);
  useGatedInterval(load, THREAD_POLL_MS, !closed);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || busy || closed) return;
    setBusy(true);
    setError(null);
    try {
      await sendLockInMessage(withUserId, body);
      setDraft('');
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'That didn’t send.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmReport = () => {
    Alert.alert('Report this thread?', `We'll send the last day of messages with ${name} to Philoi's moderators.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () => {
          reportLockInThread(withUserId, 'Harassment or bullying')
            .then(() => Alert.alert('Reported', 'Thanks — a moderator will take a look.'))
            .catch((e) => Alert.alert('Couldn’t report', getErrorMessage(e, 'Try again in a moment.')));
        },
      },
    ]);
  };

  const confirmBlock = () => {
    if (!meId) return;
    Alert.alert(`Block ${name}?`, 'They won’t see you live, and you won’t see them — anywhere in Philoi.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          blockUser(meId, withUserId)
            .then(onBack)
            .catch((e) => Alert.alert('Couldn’t block', getErrorMessage(e, 'Try again in a moment.')));
        },
      },
    ]);
  };

  return (
    <View style={styles.thread}>
      <View style={styles.threadHeader}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to friends">
          <UiGlyph name="back" size={18} color={Colors.spaceDim} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {name}
          {friend?.startedAt ? ` · ${friendActivityLabel(friend)} · ${timeInLabel(friend.startedAt)}` : ''}
        </Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={10}
          style={styles.threadMenu}
          accessibilityRole="button"
          accessibilityLabel="Report or block">
          <UiGlyph name="more" size={18} color={Colors.spaceDim} />
        </Pressable>
      </View>
      <Text style={styles.sub}>
        {closed
          ? 'Neither of you is locked in now, so this thread closed. Nothing here is kept.'
          : 'A quick back-and-forth while one of you grinds. Pick a preset or type a line.'}
      </Text>

      {!closed && (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.bubbles}
            contentContainerStyle={styles.bubblesContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {shown.length === 0 && <Text style={styles.empty}>Say something — it only lasts while one of you is live.</Text>}
            {shown.map((m) => (
              <View key={m.id} style={[styles.bubble, m.fromMe ? styles.bubbleMe : styles.bubbleThem]}>
                <Text style={m.fromMe ? styles.bubbleMeText : styles.bubbleThemText}>{m.body}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.quicks}>
            {THREAD_QUICK_LINES.map((q) => (
              <Pressable key={q} onPress={() => send(q)} disabled={busy} style={({ pressed }) => [styles.quick, pressed && styles.pressed]}>
                <Text style={styles.quickText}>{q}</Text>
              </Pressable>
            ))}
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a line…"
              placeholderTextColor={Colors.spaceFaint}
              maxLength={LOCKIN_MESSAGE_MAX}
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={() => send(draft)}
              editable={!busy}
            />
            <Pressable
              onPress={() => send(draft)}
              disabled={busy || draft.trim().length === 0}
              style={[styles.sendButton, (busy || draft.trim().length === 0) && styles.iconMuted]}
              accessibilityRole="button"
              accessibilityLabel="Send">
              <UiGlyph name="send" size={17} color="#2A0F05" />
            </Pressable>
          </View>
        </>
      )}

      <ReportBlockSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onReport={confirmReport}
        onBlock={confirmBlock}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(14,10,28,0.6)',
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: Colors.spacePanel,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: 15,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.spaceLine,
    marginTop: Spacing.one,
    marginBottom: Spacing.twelve,
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Colors.ink,
    paddingHorizontal: Spacing.half,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.spaceDim,
    paddingHorizontal: Spacing.half,
    paddingTop: Spacing.half,
    paddingBottom: Spacing.twelve,
  },
  error: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.danger,
    paddingHorizontal: Spacing.half,
    paddingBottom: Spacing.two,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  activity: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.navEmber2,
    marginTop: 1,
  },
  activityTime: {
    fontFamily: Fonts.body,
    color: Colors.spaceDim,
  },
  actions: {
    flexDirection: 'row',
    gap: 7,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel2,
  },
  // The row's one ember action.
  iconCheer: {
    backgroundColor: Colors.navEmber,
    borderColor: 'transparent',
  },
  iconDone: {
    backgroundColor: 'rgba(61,168,92,0.10)',
    borderColor: 'rgba(61,168,92,0.4)',
  },
  iconReply: {
    borderColor: 'rgba(255,176,90,0.4)',
    backgroundColor: 'rgba(255,122,47,0.10)',
  },
  iconMuted: {
    opacity: 0.45,
  },
  picker: {
    flexGrow: 0,
    marginBottom: 10,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
  },
  pickerContent: {
    gap: 7,
    padding: 10,
  },
  preset: {
    minWidth: 54,
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
  presetEmoji: {
    fontSize: 20,
  },
  presetLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: Colors.spaceDim,
    marginTop: 3,
  },
  thread: {
    flexShrink: 1,
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  threadMenu: {
    marginLeft: 'auto',
  },
  bubbles: {
    flexGrow: 0,
    maxHeight: 280,
    backgroundColor: Colors.spaceBg,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
  },
  bubblesContent: {
    padding: 11,
    gap: 7,
  },
  bubble: {
    maxWidth: '80%',
    paddingVertical: Spacing.two,
    paddingHorizontal: 11,
    borderRadius: 13,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.navEmber,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.spacePanel2,
    borderBottomLeftRadius: 4,
  },
  bubbleMeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: '#2A0F05',
  },
  bubbleThemText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.ink,
  },
  quicks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  quick: {
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.spacePanel2,
  },
  quickText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 10,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
    backgroundColor: Colors.spaceBg,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.navEmber,

    alignItems: 'center',
    justifyContent: 'center',
  },
});
