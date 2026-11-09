import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmberIcon } from '@/components/economy/ember-icon';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { EmberCta } from '@/components/lockin-hub/ember-cta';
import { PersonDisc } from '@/components/lockin-hub/person-disc';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useCindy } from '@/hooks/use-cindy';
import { previewScopedReward } from '@/lib/api/challenges';
import { CoachError, isScopedTier, sendToCindy, type CoachReply } from '@/lib/api/coach';
import { fetchMyFriends, type Friend } from '@/lib/api/friends';
import { createH2HChallenge, setChallengeScope, type LockinGoalType } from '@/lib/api/social-challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import type { DifficultyTier, ScopedRewardPreview, SocialChallengeRaceMetric } from '@/types/database';

// DUEL + CINDY REFEREE (ShareSpot ss4 §D, mock 361).
//
// You vs a friend, swipe to pick who, then say the challenge in plain words. Cindy officiates as
// REFEREE, through the scoped-challenge algorithm that already runs the New Challenge Q&A
// (CHALLENGE_CINDY_SCOPING.md):
//
//   1. CINDY PARSES. The typed sentence goes to her chat op with the same "Score this challenge…
//      It's a duel against X" prompt challenge-qa.ts's scoringPrompt sends, transient (persist:false
//      — nothing reaches her visible chat). Her `propose_social_challenge` proposal carries the
//      structured terms: metric · shape · window · tier · rationale. Nothing is written by her.
//   2. THE SERVER PRICES IT. preview_challenge_reward(tier, verifiability) returns the crate and the
//      embers. This screen shows exactly that and computes nothing — there is no local payout table.
//   3. THE SERVER GRANTS IT. Send = create_h2h_challenge, then set_challenge_scope (a duel is created
//      'pending', which that RPC accepts — the same two calls challenge/verdict.tsx's duel branch
//      makes). Settlement pays from the row. 🔒 Cindy grants nothing: she never sees a payout call.
//
// Verifiability is DERIVED server-side from the race metric; the "Verify" chip only predicts it with
// the server's own rule (lock-in time, volume and distance are observed). Duels here are limited to
// those three observed metrics — they pay the full tier and need no grade terms. A grade or honour
// duel still has its full home in the New Challenge Q&A, and Cindy says so rather than half-making it.

/** The race metrics a duel from this screen can be — every one auto-tracked (verdict.tsx OBSERVED_METRICS). */
const DUEL_METRICS: readonly SocialChallengeRaceMetric[] = ['lockin_time', 'volume', 'distance'];

type Terms = {
  label: string;
  tier: DifficultyTier;
  rationale: string;
  metric: SocialChallengeRaceMetric;
  lockinKind: LockinGoalType | null;
  windowHours: number;
};

type Ref =
  | { phase: 'idle' }
  | { phase: 'scoping' }
  /** She asked a question or couldn't place it; her words, verbatim. */
  | { phase: 'said'; text: string }
  | { phase: 'scoped'; terms: Terms };

function metricChip(t: Terms): string {
  if (t.metric === 'volume') return 'Weight lifted';
  if (t.metric === 'distance') return 'Distance';
  if (t.lockinKind === 'study') return 'Study hrs';
  if (t.lockinKind === 'gym') return 'Gym hrs';
  return 'Lock-in hrs';
}

function windowChip(hours: number): string {
  if (hours % 168 === 0) return hours === 168 ? '1 week' : `${hours / 168} weeks`;
  if (hours % 24 === 0) return hours === 24 ? '1 day' : `${hours / 24} days`;
  return `${hours}h`;
}

/** Her proposal, read into terms — or null when she didn't propose a duel this screen can make. */
function termsFrom(reply: CoachReply, fallbackLabel: string): Terms | 'unsupported' | null {
  const a = reply.action;
  if (!a || a.tool !== 'propose_social_challenge' || a.input.shape !== 'duel') return null;
  const metric = String(a.input.metric ?? 'lockin_time') as SocialChallengeRaceMetric;
  if (!DUEL_METRICS.includes(metric)) return 'unsupported';
  const tier = isScopedTier(a.input.difficulty_tier) ? a.input.difficulty_tier : 'uncommon';
  const wh = typeof a.input.window_hours === 'number' && a.input.window_hours > 0 ? Math.round(a.input.window_hours) : 168;
  const kind = a.input.lockin_kind === 'gym' || a.input.lockin_kind === 'study' ? a.input.lockin_kind : null;
  const label = String(a.input.label ?? '').trim().slice(0, 60) || fallbackLabel.slice(0, 60);
  const rationale = typeof a.input.scope_rationale === 'string' ? a.input.scope_rationale.trim() : '';
  return { label, tier, rationale, metric, lockinKind: metric === 'lockin_time' ? kind : null, windowHours: wh };
}

export default function DuelScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { consented, loading: cindyLoading } = useCindy();
  const params = useLocalSearchParams<{ opponentId?: string }>();

  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(params.opponentId ?? null);
  const [ask, setAsk] = useState('');
  const [ref, setRef] = useState<Ref>({ phase: 'idle' });
  const [preview, setPreview] = useState<ScopedRewardPreview | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMyFriends()
      .then((fs) => {
        if (!live) return;
        setFriends(fs);
        setOpponentId((cur) => (cur && fs.some((f) => f.friend_id === cur) ? cur : (fs[0]?.friend_id ?? null)));
      })
      .catch(() => {
        if (live) setFriends([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const opponent = friends?.find((f) => f.friend_id === opponentId) ?? null;
  const oppName = opponent?.display_name?.trim() || 'your friend';
  const oppFirst = oppName.split(' ')[0];
  const scoped = ref.phase === 'scoped' ? ref.terms : null;

  // Step 2: the server's price for her tier. Every duel here is an observed metric → 'auto'.
  useEffect(() => {
    if (!scoped) return;
    let live = true;
    previewScopedReward(scoped.tier, 'auto').then((r) => {
      if (live) setPreview(r);
    });
    return () => {
      live = false;
    };
  }, [scoped]);

  /** Changing who or what voids her call — the terms she set were for that pair and that sentence. */
  function invalidate() {
    if (ref.phase !== 'idle' && ref.phase !== 'scoping') setRef({ phase: 'idle' });
    setPreview(null);
  }

  async function referee() {
    const text = ask.trim();
    if (!text || !opponent) return;
    setRef({ phase: 'scoping' });
    setPreview(null);
    try {
      // Step 1, worded exactly as challenge-qa.ts's scoringPrompt words a duel, so she routes it to
      // the same propose_social_challenge tool with the same scoping rules.
      const prompt =
        `Score this challenge for me: ${text}. It's a duel against ${oppName} — whoever is further along when it ends wins. ` +
        'Give it a difficulty tier and propose it — I\'ll confirm it on your verdict screen.';
      const reply = await sendToCindy(prompt, { persist: false, history: [] });
      const terms = termsFrom(reply, text);
      if (terms === 'unsupported') {
        setRef({
          phase: 'said',
          text: 'A duel I can referee here has to be something the app tracks — hours locked in, weight lifted, or distance. For a grade or anything on your word, start it from New challenge and I\'ll set it up there.',
        });
      } else if (terms) {
        setRef({ phase: 'scoped', terms });
      } else {
        setRef({ phase: 'said', text: reply.text.trim() || 'Tell me a little more — what are you two racing on, and by when?' });
      }
    } catch (e) {
      if (e instanceof CoachError && e.code === 'not_consented') {
        setRef({ phase: 'idle' });
        return;
      }
      setRef({ phase: 'said', text: e instanceof CoachError ? e.message : 'I couldn’t reach the scoring just now. Try again?' });
    }
  }

  async function send() {
    if (!scoped || !opponent || sending) return;
    setSending(true);
    try {
      // Step 3 — the server writes the duel and its scope. The tier call is swallowed on failure for
      // the reason verdict.tsx gives: an unscoped duel pays a smaller reward, never a wrong one, and
      // losing an invite the opponent already has over a tier that did not stick is the worse trade.
      const duel = await createH2HChallenge({
        opponentId: opponent.friend_id,
        raceMetric: scoped.metric,
        windowHours: scoped.windowHours,
        publicName: scoped.label,
        lockinGoalType: scoped.lockinKind,
      });
      if (duel?.id) await setChallengeScope(duel.id, scoped.tier).catch(() => {});
      router.replace({ pathname: '/challenge-info/[challengeId]', params: { challengeId: duel.id, fresh: '1' } });
    } catch (e) {
      Alert.alert('Couldn’t send the duel', getErrorMessage(e, 'Try again in a moment.'));
      setSending(false);
    }
  }

  const boxKey = asBoxKey(preview?.box);
  const tierColor = scoped ? TIER_COLOR[scoped.tier] : Colors.legend;
  const myName = profile?.display_name?.trim() || 'You';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader title="Duel" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* ── VS hero ── */}
        <View style={styles.vs}>
          <View style={styles.vsSide}>
            <PersonDisc name={myName} avatarUrl={profile?.avatar_url} size={72} lit />
            <Text style={styles.vsName}>You</Text>
          </View>
          <View style={styles.vsMid}>
            <SocialGlyph name="swords" size={26} color={Colors.gold} />
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.vsSide}>
            <PersonDisc name={oppName} avatarUrl={opponent?.avatar_url} size={72} lit={Boolean(opponent)} />
            <Text style={styles.vsName} numberOfLines={1}>
              {opponent ? oppFirst : '—'}
            </Text>
          </View>
        </View>
        <Text style={styles.vsLine}>
          {scoped ? `${scoped.label} — winner takes the W 🔥` : 'Whoever logs more this week takes the W 🔥'}
        </Text>

        {/* ── who ── */}
        <Text style={styles.kicker}>CHALLENGE WHO</Text>
        {friends === null ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
        ) : friends.length === 0 ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>A duel is with a friend. Add someone first, then come back.</Text>
            <Pressable onPress={() => router.push('/add-friend')} accessibilityRole="button">
              <Text style={styles.noteLink}>Find friends ›</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={76}
            contentContainerStyle={styles.picker}>
            {friends.map((f) => {
              const on = f.friend_id === opponentId;
              const name = f.display_name?.trim() || 'Friend';
              return (
                <Pressable
                  key={f.friend_id}
                  onPress={() => {
                    if (f.friend_id !== opponentId) {
                      setOpponentId(f.friend_id);
                      invalidate();
                    }
                  }}
                  style={styles.pick}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Challenge ${name}`}>
                  <PersonDisc name={name} avatarUrl={f.avatar_url} size={52} lit={on} />
                  <Text style={[styles.pickName, on && styles.pickNameOn]} numberOfLines={1}>
                    {name.split(' ')[0]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* ── what, in plain words ── */}
        <Text style={styles.kicker}>WHAT’S THE CHALLENGE?</Text>
        <TextInput
          value={ask}
          onChangeText={(t) => {
            setAsk(t);
            invalidate();
          }}
          placeholder={`Who can study more for KP344 this week 📚`}
          placeholderTextColor={Colors.spaceFaint}
          style={styles.input}
          multiline
          maxLength={200}
          accessibilityLabel="What's the challenge"
        />
        <Text style={styles.hint}>Say it however you want — Cindy sets fair terms.</Text>

        {/* ── Cindy, referee ── */}
        {!cindyLoading && !consented ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>Cindy referees every duel — she needs to be switched on to set the terms.</Text>
            <Pressable onPress={() => router.push('/cindy')} accessibilityRole="button">
              <Text style={styles.noteLink}>Turn Cindy on ›</Text>
            </Pressable>
          </View>
        ) : ref.phase === 'idle' ? (
          <EmberCta
            label="Ask Cindy to referee"
            onPress={referee}
            disabled={!ask.trim() || !opponent || cindyLoading}
            style={styles.cta}
          />
        ) : (
          <View style={[styles.ref, scoped && { borderColor: `${tierColor}66` }]}>
            <View style={styles.refHead}>
              <View style={styles.cindyDisc}>
                <EquippedFlameSvg width={18} height={22} />
              </View>
              <Text style={styles.refName}>Cindy</Text>
              <View style={styles.refBadge}>
                <Text style={styles.refBadgeText}>REFEREE</Text>
              </View>
            </View>

            {ref.phase === 'scoping' ? (
              <View style={styles.refBusy}>
                <ActivityIndicator color={Colors.legend} />
                <Text style={styles.refBusyText}>Setting fair terms…</Text>
              </View>
            ) : ref.phase === 'said' ? (
              <>
                <Text style={styles.says}>“{ref.text}”</Text>
                <Pressable onPress={referee} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again with what you wrote</Text>
                </Pressable>
              </>
            ) : scoped ? (
              <>
                <Text style={styles.says}>
                  “
                  {scoped.rationale ||
                    `Got it. I’ll track ${metricChip(scoped).toLowerCase()}, most by the end of ${windowChip(scoped.windowHours)} wins.`}{' '}
                  I’ll keep score and call it fair.”
                </Text>

                <View style={styles.chips}>
                  <Chip k="Metric" v={metricChip(scoped)} />
                  <Chip k="Shape" v="Race · most" />
                  <Chip k="Window" v={windowChip(scoped.windowHours)} />
                  <Chip k="Verify" v="Auto-tracked" />
                </View>

                {/* Worth — the SERVER's crate and embers, never a number this screen made up. */}
                <View style={styles.worth}>
                  <Text style={styles.worthKicker}>WORTH</Text>
                  {preview ? (
                    <View style={styles.worthRow}>
                      <EmberIcon size={14} />
                      <Text style={styles.worthText}>
                        <Text style={styles.worthStrong}>{preview.embers.toLocaleString('en-US')} embers</Text>
                        {boxKey ? ` · ${BOXES[boxKey].name}` : ''}
                        <Text style={{ color: tierColor }}> · {scoped.tier.charAt(0).toUpperCase() + scoped.tier.slice(1)}</Text>
                      </Text>
                    </View>
                  ) : (
                    <ActivityIndicator color={Colors.navEmber} style={styles.worthSpinner} />
                  )}
                </View>
              </>
            ) : null}
          </View>
        )}

        {scoped ? (
          <EmberCta
            label={`Send duel to ${oppFirst}`}
            onPress={send}
            loading={sending}
            disabled={!preview || !opponent}
            style={styles.cta}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipK}>{k}: </Text>
      <Text style={styles.chipV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  body: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.six,
  },
  vs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: Spacing.two,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(185,139,255,0.28)',
  },
  vsSide: {
    alignItems: 'center',
    gap: 6,
    width: 92,
  },
  vsName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  vsMid: {
    alignItems: 'center',
    gap: 2,
  },
  vsText: {
    fontFamily: Fonts.black,
    fontSize: 20,
    color: Colors.gold,
    letterSpacing: 1,
  },
  vsLine: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 10,
  },
  kicker: {
    fontFamily: Fonts.black,
    fontSize: 11,
    letterSpacing: 0.6,
    color: Colors.spaceDim,
    marginTop: 22,
    marginBottom: 10,
  },
  spinner: {
    paddingVertical: Spacing.three,
  },
  picker: {
    gap: 12,
    paddingRight: SPACE_GUTTER,
  },
  pick: {
    width: 64,
    alignItems: 'center',
    gap: 5,
  },
  pickName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  pickNameOn: {
    color: Colors.ink,
  },
  input: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
    textAlignVertical: 'top',
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 6,
  },
  note: {
    marginTop: Spacing.three,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    gap: 8,
  },
  noteText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    lineHeight: 18,
  },
  noteLink: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.navEmber2,
  },
  cta: {
    marginTop: Spacing.three,
  },
  ref: {
    marginTop: Spacing.three,
    padding: 14,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: 'rgba(185,139,255,0.35)',
  },
  refHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cindyDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,122,47,0.14)',
  },
  refName: {
    fontFamily: Fonts.black,
    fontSize: 14,
    color: Colors.ink,
  },
  refBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Colors.legend,
  },
  refBadgeText: {
    fontFamily: Fonts.black,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: '#160D26',
  },
  refBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  refBusyText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  says: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.ink,
    marginTop: 10,
  },
  retry: {
    marginTop: 10,
  },
  retryText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.navEmber2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  chip: {
    flexDirection: 'row',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(79,214,224,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(79,214,224,0.35)',
  },
  chipK: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  chipV: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ink,
  },
  worth: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
  },
  worthKicker: {
    fontFamily: Fonts.black,
    fontSize: 10,
    letterSpacing: 0.6,
    color: Colors.spaceDim,
  },
  worthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
  },
  worthText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  worthStrong: {
    fontFamily: Fonts.black,
    color: Colors.navEmber2,
  },
  worthSpinner: {
    alignSelf: 'flex-start',
    marginTop: 6,
  },
});
