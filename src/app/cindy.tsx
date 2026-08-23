import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CindyActionChip } from '@/components/cindy/cindy-action-chip';
import { CindyConsent } from '@/components/cindy/cindy-consent';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useCindy } from '@/hooks/use-cindy';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import {
  clearCindyHistory,
  CoachError,
  fetchCindyHistory,
  isVoiceAvailable,
  performCoachAction,
  recordCoachAction,
  sendToCindy,
  type CoachAction,
  type CoachMessage,
} from '@/lib/api/coach';

// CINDY CHAT — mock 115 frames 2, 3 and 5.
//
// She is the SAME flame as everywhere else: the avatar in this header renders EquippedFlameSvg,
// so whatever cosmetic is equipped is what Cindy looks like here, on Home, on the lock-in screen
// and on a share card. That is the identity claim made literal — there is no separate "assistant
// avatar" asset anywhere in this feature, because a second flame would break the one thing the
// whole persona rests on.

/** Optimistic rows get a client id so the list has a key before the server replies. */
type Row = CoachMessage & { pending?: boolean };

export default function CindyScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { consented, loading: settingsLoading, refetch: refetchSettings } = useCindy();
  const { session: activeSession, start, clear } = useActiveSession();

  const [rows, setRows] = useState<Row[]>([]);
  // ?ask= prefills the composer. Used by the lock-in quick sheet, which hands off a question
  // rather than answering inline — it does NOT auto-send: arriving in a chat that has already
  // spoken on your behalf is disorienting, and a prefilled box is still one tap to send and
  // editable if the canned phrasing is not quite what you meant.
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  const [draft, setDraft] = useState(typeof ask === 'string' ? ask : '');
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [voiceReady, setVoiceReady] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    // No consent means no fetch at all — and the loading flag is DERIVED below rather than
    // cleared here, since a synchronous setState in an effect body cascades a render.
    if (!consented) return;

    fetchCindyHistory()
      .then(setRows)
      .catch((e) => console.error('[cindy] history failed:', e))
      .finally(() => setLoading(false));
    // Voice ships dark — the mic only exists once the project has an ElevenLabs key.
    isVoiceAvailable().then(setVoiceReady);
  }, [consented]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  async function handleSend() {
    const message = draft.trim();
    if (!message || thinking) return;

    setDraft('');
    setThinking(true);
    const optimistic: Row = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: message,
      action: null,
      modality: 'text',
      created_at: new Date().toISOString(),
      pending: true,
    };
    setRows((prev) => [...prev, optimistic]);
    scrollToEnd();

    try {
      const reply = await sendToCindy(message);
      const replyRow: Row = {
        id: `reply-${Date.now()}`,
        role: 'assistant',
        content: reply.text,
        action: reply.action ? { ...reply.action, status: 'proposed' } : null,
        modality: 'text',
        created_at: new Date().toISOString(),
      };
      setRows((prev) => [...prev, replyRow]);
      scrollToEnd();

      // 'auto' actions run immediately — starting a session is safe and instant (CINDY_SPEC),
      // and making the user confirm the single most common request would feel bureaucratic.
      // 'confirm' actions do nothing until the chip is tapped.
      if (reply.action?.effect === 'auto') await runAction(replyRow.id, reply.action);
    } catch (e) {
      setDraft(message);
      setRows((prev) => prev.filter((r) => r.id !== optimistic.id));
      Alert.alert('Cindy', e instanceof CoachError ? e.message : 'Could not reach Cindy. Try again?');
    } finally {
      setThinking(false);
    }
  }

  /**
   * Perform a proposed action.
   *
   * 🔒 The write happens HERE, on the device, under this user's own session — never on the
   * server. See src/lib/api/coach.ts for why that is the firewall rather than a convenience.
   */
  async function runAction(rowId: string, action: CoachAction) {
    if (!session) return;
    setBusyAction(rowId);
    try {
      const outcome = await performCoachAction(action, {
        userId: session.user.id,
        activeSession: activeSession ? { id: activeSession.id, goalType: activeSession.goalType } : null,
        startSession: start,
        clearSession: clear,
      });

      setRows((prev) =>
        prev.map((r) => (r.id === rowId && r.action ? { ...r, action: { ...r.action, status: outcome.status } } : r))
      );
      await recordCoachAction(action, outcome.status);

      if (outcome.status === 'failed' && outcome.error) {
        Alert.alert('Cindy', outcome.error);
      }
      // Safety routing takes priority over staying in the chat: when the coach surfaces real
      // support, nothing should sit between the user and that screen.
      if (outcome.route) router.push(outcome.route as never);
      else if (outcome.sessionId) router.push('/lock-in');
    } finally {
      setBusyAction(null);
    }
  }

  async function declineAction(rowId: string, action: CoachAction) {
    setRows((prev) =>
      prev.map((r) => (r.id === rowId && r.action ? { ...r, action: { ...r.action, status: 'declined' } } : r))
    );
    await recordCoachAction(action, 'declined');
  }

  function handleClear() {
    Alert.alert('Clear this chat?', "Your history with Cindy will be deleted. She'll still know your data.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearCindyHistory();
          setRows([]);
        },
      },
    ]);
  }

  // `loading` only means anything once we know they've consented — otherwise no fetch was ever
  // started and the consent gate below is what should render.
  if (settingsLoading || (consented && loading)) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Colors.amber} />
      </Screen>
    );
  }

  // The consent gate. Cindy reads a lot and sends it to a model, so nothing may be called before
  // the user has actually agreed — this screen is her entire on-ramp.
  if (!consented) {
    return <CindyConsent onDone={refetchSettings} />;
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <View style={styles.avatar}>
          <EquippedFlameSvg width={20} height={24} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name}>Cindy</Text>
          <Text style={styles.status}>here for you</Text>
        </View>
        <Pressable onPress={handleClear} hitSlop={12} accessibilityLabel="Clear chat">
          <Ionicons name="ellipsis-horizontal" size={20} color={Colors.textTertiary} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={scrollToEnd}
        ListEmptyComponent={<CindyOpener />}
        renderItem={({ item }) => (
          <View style={styles.turn}>
            {item.content.length > 0 && (
              <View style={[styles.bubble, item.role === 'user' ? styles.mine : styles.hers]}>
                <Text style={item.role === 'user' ? styles.mineText : styles.hersText}>{item.content}</Text>
              </View>
            )}
            {item.action && (
              <CindyActionChip
                action={item.action}
                busy={busyAction === item.id}
                onConfirm={() => runAction(item.id, item.action!)}
                onDecline={() => declineAction(item.id, item.action!)}
              />
            )}
          </View>
        )}
      />

      {thinking && (
        <View style={styles.thinking}>
          <ActivityIndicator size="small" color={Colors.amber} />
          <Text style={styles.thinkingText}>Cindy&apos;s thinking…</Text>
        </View>
      )}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Cindy…"
          style={styles.input}
          multiline
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        {voiceReady && (
          <Pressable
            onPress={() => router.push('/cindy-voice')}
            style={styles.mic}
            accessibilityRole="button"
            accessibilityLabel="Talk to Cindy">
            <Ionicons name="mic-outline" size={17} color={Colors.ember} />
          </Pressable>
        )}
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim() || thinking}
          style={[styles.send, (!draft.trim() || thinking) && styles.sendOff]}
          accessibilityRole="button"
          accessibilityLabel="Send">
          <Ionicons name="send" size={15} color={Colors.onEmber} />
        </Pressable>
      </View>
    </Screen>
  );
}

/** First-run state. Concrete prompts, because "ask me anything" tells nobody what she can do. */
function CindyOpener() {
  return (
    <View style={styles.opener}>
      <EquippedFlameSvg width={64} height={78} />
      <Text style={styles.openerTitle}>I&apos;m Cindy — your flame.</Text>
      <Text style={styles.openerBody}>
        I know your ranks, your sessions, your challenges and what&apos;s left to unlock. Ask me anything, or
        tell me to start a session.
      </Text>
      <View style={styles.examples}>
        <Text style={styles.example}>“How much do I need to lock in to hit Hero?”</Text>
        <Text style={styles.example}>“Start a study session for BU111”</Text>
        <Text style={styles.example}>“How am I doing this week?”</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 1,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  status: { fontFamily: Fonts.body, fontSize: 10, color: Colors.green },

  list: { padding: Spacing.three, gap: Spacing.twelve, flexGrow: 1 },
  turn: { gap: Spacing.two },
  bubble: {
    maxWidth: '82%',
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.two + 2,
  },
  hers: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.card,
    borderBottomLeftRadius: 4,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.amber,
    borderBottomRightRadius: 4,
  },
  hersText: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 19, color: Colors.ink },
  mineText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, lineHeight: 19, color: Colors.onEmber },

  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  thinkingText: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.twelve,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  input: { flex: 1, maxHeight: 110 },
  mic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: Colors.disabledSurface },

  opener: { alignItems: 'center', gap: Spacing.twelve, paddingHorizontal: Spacing.four, paddingTop: Spacing.six },
  openerTitle: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  openerBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: 'center',
  },
  examples: { gap: Spacing.two, marginTop: Spacing.two, alignItems: 'center' },
  example: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary },
});
