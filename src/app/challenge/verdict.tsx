import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { createChallenge, previewScopedReward, setGoalScope } from '@/lib/api/challenges';
import { hostCampfireChallenge } from '@/lib/api/social-challenges';
import { BOX_KEYS, BOXES, type BoxKey } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import type { ChallengePeriod, DifficultyTier, ScopedRewardPreview } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CINDY'S VERDICT — a screen, not a chat bubble (design-mocks/173, CODE_PROMPT §A).
//
// "You're doing a challenge, and this is what you could win." One full screen: the goal at the
// top, the tier and Cindy's reasoning under it, the crate it pays, and the CTA. Every branch of
// the loop — solo, duel, campfire — arrives here, and only the CTA differs.
//
// 🔒 THE NUMBERS ARE THE SERVER'S. Cindy proposes a TIER and is forbidden from saying what it
// pays (SCOPING_RULES in the coach prompt); this screen asks preview_challenge_reward, which reads
// the same economy_config grant_reward will read at completion. A local tier→payout table here
// would be a second source of truth, and the first retune would have the verdict promise one thing
// and the reveal deliver another. One round trip to never be wrong.
//
// WHY THE RATIONALE IS RENDERED VERBATIM AND NOT REWRITTEN. It is the one thing on the screen that
// is genuinely Cindy's, and it is what makes the tier feel judged rather than rolled — "a standing
// backflip takes most people 3-9 months, the wall is the fear" earns the EPIC above it in a way no
// generic tier blurb can. It falls back to a per-tier line only when she did not supply one.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TIER_LINE: Record<DifficultyTier, string> = {
  common: 'A daily habit.',
  uncommon: 'A solid push this week.',
  rare: 'A real training block.',
  epic: 'Most people never do this.',
  legendary: 'A genuine life feat.',
  mythic: 'Bragging rights for life.',
};

const TIER_COLOR: Record<DifficultyTier, string> = {
  common: Colors.muted,
  uncommon: Colors.green,
  rare: Colors.sky,
  epic: '#A06CD5',
  legendary: Colors.amber,
  mythic: Colors.coral,
};

function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

type Branch = 'solo' | 'duel' | 'campfire';

export default function VerdictScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const p = useLocalSearchParams<{
    label: string;
    tier: string;
    rationale?: string;
    branch?: string;
    /** solo */
    target?: string;
    unit?: string;
    period?: string;
    /** campfire */
    circleId?: string;
    circleName?: string;
    metric?: string;
    /** duel */
    opponentName?: string;
  }>();

  const tier = (p.tier as DifficultyTier) ?? 'uncommon';
  const branch = (p.branch as Branch) ?? 'solo';
  const [preview, setPreview] = useState<ScopedRewardPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // 'honor' is the conservative half of the pair and the right thing to ASK for: the goal does
    // not exist yet, so it has no metric for the server to derive verifiability from. Asking honor
    // means this screen can only ever understate what an auto-tracked goal will pay, never
    // overstate it — a promise it cannot keep is the one failure mode worth designing out.
    previewScopedReward(tier, 'honor').then((r) => {
      if (alive) setPreview(r);
    });
    return () => {
      alive = false;
    };
  }, [tier]);

  const boxKey = asBoxKey(preview?.box);

  const start = async () => {
    if (!session) return;
    setBusy(true);
    try {
      if (branch === 'campfire') {
        const hosted = await hostCampfireChallenge({
          circleId: String(p.circleId),
          metric: String(p.metric ?? 'reps'),
          target: Number(p.target ?? 0),
          label: String(p.label),
          tier,
        });
        router.replace(`/challenge-info/${hosted.challenge_id}`);
        return;
      }
      if (branch === 'duel') {
        // A duel needs an opponent and a metric the create form already knows how to collect, so
        // this hands off rather than reimplementing that picker behind a different door.
        router.replace({
          pathname: '/challenge/create',
          params: { shape: 'duel', publicName: String(p.label), tier },
        });
        return;
      }
      // ── solo ──
      const created = await createChallenge({
        userId: session.user.id,
        type: 'custom',
        label: String(p.label),
        target: Number(p.target ?? 1),
        unit: String(p.unit ?? ''),
        period: (p.period as ChallengePeriod) ?? 'once',
        countMode: 'manual',
      });
      // Second and separately — set_goal_scope is where the tier is validated and, the part that
      // matters, where verifiability is DERIVED rather than accepted. Swallowed on failure: an
      // unscoped goal pays what it would have before scoping existed, which is a smaller reward,
      // never a wrong one. Losing the goal over a tier that did not stick is the worse trade.
      if (created?.id) await setGoalScope(created.id, tier).catch(() => {});
      router.replace('/(tabs)/challenges');
    } catch (e) {
      Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const cta =
    branch === 'campfire'
      ? `Post to ${p.circleName ?? 'the campfire'}`
      : branch === 'duel'
        ? `Challenge ${p.opponentName ?? 'a friend'}`
        : 'Start this goal';

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Cindy's verdict", headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>YOUR GOAL</Text>
        <Text style={styles.goal}>{p.label}</Text>

        <Text style={styles.deserves}>Cindy thinks this deserves</Text>
        <Text style={[styles.tier, { color: TIER_COLOR[tier] }]}>{tier.toUpperCase()}</Text>
        <Text style={styles.rationale}>{p.rationale?.trim() || TIER_LINE[tier]}</Text>

        {/* The crate, lit. The halo takes the tier's own colour rather than the flame ramp: this is
            the one screen where the subject is the PRIZE, not the user's fire, and a legendary
            crate glowing violet because someone equipped a violet flame would read as the wrong
            rarity. Same SVG-underneath trick as everywhere else — no radial gradients in RN. */}
        <View style={styles.heroWrap}>
          <Svg width={180} height={180} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <RadialGradient id="verdictHalo" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={TIER_COLOR[tier]} stopOpacity={0.38} />
                <Stop offset="0.68" stopColor={TIER_COLOR[tier]} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={90} cy={90} r={90} fill="url(#verdictHalo)" />
          </Svg>
          {preview === null ? (
            <ActivityIndicator color={Colors.amber} />
          ) : boxKey ? (
            <BoxArt boxKey={boxKey} size={104} />
          ) : (
            <EmberIcon size={54} />
          )}
        </View>

        <Text style={styles.unlocksLabel}>POTENTIAL UNLOCKS</Text>
        {preview ? (
          <View style={[styles.crate, { borderColor: TIER_COLOR[tier] }]}>
            {boxKey ? <BoxArt boxKey={boxKey} size={34} /> : <EmberIcon size={22} />}
            <View style={styles.crateMeta}>
              <Text style={[styles.crateName, { color: TIER_COLOR[tier] }]}>
                {boxKey ? BOXES[boxKey].name : 'Embers only'}
              </Text>
              <View style={styles.crateLineRow}>
                <EmberIcon size={11} />
                <Text style={styles.crateLine}>
                  {preview.embers.toLocaleString('en-US')} embers
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.crateSkeleton} />
        )}

        {/* The discount, said BEFORE they commit. A user who learns at the reveal that unverified
            pays a tier down has been surprised by a rule working exactly as designed. */}
        {preview?.discounted ? (
          <View style={styles.caveatRow}>
            <Ionicons name="camera-outline" size={14} color={Colors.textTertiary} />
            <Text style={styles.caveat}>
              Proof or a friend&apos;s vouch unlocks the full crate — unverified pays one tier down.
            </Text>
          </View>
        ) : preview ? (
          <View style={styles.caveatRow}>
            <Ionicons name="checkmark-circle-outline" size={14} color={Colors.green} />
            <Text style={styles.caveat}>Tracked automatically, so it pays the full tier.</Text>
          </View>
        ) : null}

        <View style={styles.cta}>
          <PrimaryButton label={cta} onPress={start} loading={busy} disabled={busy || !preview} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, alignItems: 'center', paddingBottom: Spacing.six },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2.4,
    color: Colors.textTertiary,
  },
  goal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 21,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 26,
  },
  deserves: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted, marginTop: Spacing.three },
  tier: { fontFamily: Fonts.bodyBold, fontSize: 27, letterSpacing: 1, marginTop: 4 },
  rationale: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 7,
    maxWidth: 280,
  },
  heroWrap: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.two,
  },
  unlocksLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2,
    color: Colors.textTertiary,
    marginBottom: Spacing.two,
  },
  crate: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: 11,
    backgroundColor: 'rgba(20,14,26,0.66)',
  },
  crateSkeleton: {
    alignSelf: 'stretch',
    height: 58,
    borderRadius: Radius.card,
    backgroundColor: 'rgba(20,14,26,0.5)',
  },
  crateMeta: { flex: 1, gap: 3 },
  crateName: { fontFamily: Fonts.bodyBold, fontSize: 13.5 },
  crateLineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  crateLine: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  caveatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: Spacing.two,
    alignSelf: 'stretch',
  },
  caveat: { flex: 1, fontFamily: Fonts.body, fontSize: 11, lineHeight: 15.5, color: Colors.textTertiary },
  cta: { alignSelf: 'stretch', marginTop: Spacing.four },
});
