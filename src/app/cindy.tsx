import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CindyActionChip } from '@/components/cindy/cindy-action-chip';
import { useMyGroups } from '@/hooks/use-my-groups';
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
  isScopedTier,
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
  // Only for resolving a campfire id back to its name for the verdict CTA — see runAction.
  const { groups } = useMyGroups();

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

    // ── HOSTING FOR A CAMPFIRE GETS THE VERDICT SCREEN, NOT AN INLINE WRITE ──────────────────
    //
    // Every other proposed action is small, private and reversible enough to confirm in the flow
    // of the chat. This one posts a card into a whole campfire's chat and pushes every member, and
    // it is the one action Cindy has already PRICED — she proposes a difficulty tier, and 0159-0161
    // let the server say what that tier pays before anything is written.
    //
    // The inline chip could only ever show that as a two-line tease. Mock 173 is the screen the
    // scoping engine was built for: the goal, the tier, Cindy's own rationale, and the crate it
    // pays with its rays — then "Post to {campfire}". challenge/verdict.tsx has existed since
    // c60cb8a and nothing in the app navigated to it; this is the door.
    //
    // 🔒 NOTHING IS WRITTEN HERE. The verdict screen's CTA calls hostCampfireChallenge, which is
    // where the admin check, the insert, the enrolment, the push and the chat post all happen in
    // one server transaction (0162), reaching every member including late joiners (0163). So the
    // chip stays 'proposed' rather than 'done': at this point the user has been shown a price, not
    // charged one, and marking it done would be a receipt for something that has not happened.
    if (action.tool === 'host_campfire_challenge') {
      const input = action.input ?? {};
      const circleId = typeof input.circle_id === 'string' ? input.circle_id : null;
      // No campfire id means Cindy did not resolve one against the user's own list, which the tool
      // description tells her never to guess at. Falling through to the inline path would ask the
      // server to host for a campfire nobody named; better to let it refuse with its own sentence.
      if (circleId) {
        router.push({
          pathname: '/challenge/verdict',
          params: {
            branch: 'campfire',
            circleId,
            // The tool deliberately carries no campfire NAME — a name the model wrote is exactly
            // the thing that could be wrong — so it is resolved here, from the user's own groups.
            circleName: groups.find((g) => g.id === circleId)?.name ?? '',
            label: String(input.label ?? 'Challenge'),
            metric: String(input.metric ?? 'reps'),
            target: String(input.target ?? 0),
            tier: typeof input.difficulty_tier === 'string' ? input.difficulty_tier : 'uncommon',
            rationale: typeof input.scope_rationale === 'string' ? input.scope_rationale : '',
          },
        });
        return;
      }
    }

    // ── AND A SCOPED SOLO GOAL GETS THE SAME SCREEN ─────────────────────────────────────────
    //
    // The campfire branch above is the loud half of this; the quiet half was that a private goal
    // Cindy had ALREADY JUDGED never showed the judgement. coach.ts created the goal and called
    // set_goal_scope inline, so the tier, the rationale and the crate — the whole of 0159-0161 —
    // resolved into a chip that said "Done". The one screen built to read a verdict was skipped by
    // the one flow that produces one.
    //
    // ONLY WHEN THERE IS A TIER, which is the whole test. "10k steps a day" carries nothing to
    // deliberate: no tier, no rationale, and a verdict screen in front of it is a door between
    // someone and a habit they already decided on. Those still create inline, exactly as before.
    //
    // 🔒 NOTHING IS WRITTEN HERE. The CTA on that screen performs the create and then the scope,
    // in that order, through the same two functions this file's executor calls — so set_goal_scope
    // is still where verifiability is DERIVED, and the reward figure on screen is still the
    // server's own preview rather than a number Cindy said. The chip stays 'proposed' for the same
    // reason the campfire one does: the user has been shown a price, not charged one.
    if (action.tool === 'create_challenge') {
      const input = action.input;
      const tier = input.difficulty_tier;
      // An unscoped goal falls straight through to the executor below and is created inline, which
      // is the behaviour every create had before this branch existed.
      if (isScopedTier(tier)) {
        router.push({
          pathname: '/challenge/verdict',
          params: {
            branch: 'solo_goal',
            label: String(input.label ?? 'Goal'),
            tier,
            rationale: typeof input.scope_rationale === 'string' ? input.scope_rationale : '',
            // The goal's own shape, carried whole. Every one of these is an argument the CTA hands
            // to createChallenge, so a field dropped here is a field silently changed on the way:
            // a lockin_time goal arriving as 'manual' stops accruing from lock-ins AND stops being
            // auto-verifiable, which is a tier band of reward lost to a missing param.
            goalType: typeof input.type === 'string' ? input.type : 'custom',
            target: String(input.target ?? 1),
            unit: typeof input.unit === 'string' ? input.unit : '',
            period: typeof input.period === 'string' ? input.period : 'week',
            countMode: input.count_mode === 'lockin_time' ? 'lockin_time' : 'manual',
          },
        });
        return;
      }
    }

    // —— A DUEL, A COLLECTIVE GOAL OR A PLACEMENT RACE: THE SAME SCREEN AGAIN ——————
    //
    // The third door onto the verdict, and the one that finishes the set. Solo goals and campfire
    // hosting already routed here; these three shapes could only be built from the form, so a feat
    // Cindy had scoped for a whole campfire had nowhere to show the scope.
    //
    // 🔒 NOTHING IS WRITTEN HERE. The screen's CTA calls createGroupChallenge /
    // createPlacementChallenge with the tier as a create argument (0175 — it cannot be a second
    // call, because set_challenge_scope refuses a placement race that has already started), or
    // hands a duel to the create form where the opponent picker lives. The chip stays 'proposed'
    // for the same reason as the other two: a price has been shown, not charged.
    if (action.tool === 'propose_social_challenge') {
      const input = action.input;
      const shape = String(input.shape ?? '');
      const circleId = typeof input.circle_id === 'string' ? input.circle_id : '';
      // A campfire shape needs its campfire. Falling through to the executor lets it answer with
      // its own sentence rather than opening a screen that cannot complete.
      const ok = shape === 'duel' || ((shape === 'collective' || shape === 'placement') && circleId);
      if (ok) {
        router.push({
          pathname: '/challenge/verdict',
          params: {
            branch: shape,
            label: String(input.label ?? 'Challenge').slice(0, 60),
            tier: isScopedTier(input.difficulty_tier) ? input.difficulty_tier : 'uncommon',
            rationale: typeof input.scope_rationale === 'string' ? input.scope_rationale : '',
            metric: String(input.metric ?? 'lockin_time'),
            target: String(input.target ?? 0),
            windowHours: String(
              typeof input.window_hours === 'number' && input.window_hours > 0
                ? Math.round(input.window_hours)
                : 168
            ),
            ...(circleId
              ? {
                  circleId,
                  // Resolved from the user's own groups, never from a name the model wrote —
                  // the same rule the campfire branch above follows, for the same reason.
                  circleName: groups.find((g) => g.id === circleId)?.name ?? '',
                }
              : {}),
          },
        });
        return;
      }
    }

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
