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
import {
  createGroupChallenge,
  createPlacementChallenge,
  hostCampfireChallenge,
} from '@/lib/api/social-challenges';
import { BOX_KEYS, BOXES, type BoxKey } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import type {
  ChallengeCountMode,
  ChallengePeriod,
  ChallengeType,
  DifficultyTier,
  GoalClaimLevel,
  ScopedRewardPreview,
  SocialChallengeRaceMetric,
} from '@/types/database';

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

type Branch = 'solo' | 'duel' | 'campfire' | 'collective' | 'placement';

/**
 * Cindy's solo proposal arrives as `solo_goal` — the branch name the create_challenge routing in
 * cindy.tsx uses, to say plainly which of her tools sent it. It is the same shape as `solo` and is
 * folded into it here: a second solo path that created goals slightly differently is exactly the
 * kind of drift that ends with two answers to "what did I just agree to".
 */
function asBranch(raw: string | undefined): Branch {
  if (raw === 'campfire' || raw === 'duel' || raw === 'collective' || raw === 'placement') return raw;
  return 'solo';
}

/**
 * The race metrics the app OBSERVES, mirroring challenge_verifiability_for (migration 0175).
 *
 * 🔒 Not a claim — a prediction, and only for the preview. The server derives the row's real
 * verifiability from the metric it stores, and ignores anything a client says about it. Kept as
 * the same three names so the figure this screen shows is the figure settlement will reach.
 */
const OBSERVED_METRICS: readonly string[] = ['lockin_time', 'volume', 'distance'];

/**
 * ...except on a COLLECTIVE goal, where 'lockin_time' is not a metric at all.
 *
 * 🛑 CAUGHT BY A FUNCTIONAL PROBE, not by reading. createGroupChallenge sends a lock-in
 * collective goal as a COUNT (`targetCount`) and deliberately leaves `race_metric` NULL (0098) —
 * that null is what routes it to the count arm. challenge_verifiability_for(null) is 'honor', so
 * the server derives honor for the exact shape this screen was about to call observed, and the
 * crate shown would have been a band too generous.
 *
 * Only the two MEASURED bars send a race_metric on a collective goal, so only they are observed.
 */
const OBSERVED_COLLECTIVE_METRICS: readonly string[] = ['volume', 'distance'];

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
    goalType?: string;
    countMode?: string;
    /** campfire, collective, placement */
    circleId?: string;
    circleName?: string;
    metric?: string;
    windowHours?: string;
    /** duel */
    opponentName?: string;
  }>();

  const tier = (p.tier as DifficultyTier) ?? 'uncommon';
  const branch = asBranch(p.branch);

  // The goal's shape, and the only two fields that decide its verifiability. Both are also
  // arguments to the createChallenge below, so they are read once here and used in both places
  // rather than parsed twice out of params that could drift apart. The defaults are the honour
  // shape, which is where the campfire and duel branches — carrying neither — belong.
  const goalType: ChallengeType = (p.goalType as ChallengeType) ?? 'custom';
  const countMode: ChallengeCountMode = p.countMode === 'lockin_time' ? 'lockin_time' : 'manual';

  // ── WHAT THE PREVIEW ASKS FOR, AND WHY IT IS NOT ALWAYS 'honor' ──
  //
  // 🔒 STILL NOT A CLAIM. set_goal_scope (0160) derives verifiability from the goal's own row at
  // write time and ignores anything a caller says about it; this only PREDICTS what that function
  // will derive, by applying its exact rule — a built-in metric is observed, a custom goal counted
  // in lock-in TIME is observed, everything else is honour — to the same two fields the CTA below
  // is about to insert. It grants nothing either way, and the server's answer is what lands.
  //
  // Asking 'honor' unconditionally was right while the only caller was the campfire branch, where
  // there is no goal yet to have a shape. For a solo goal it UNDERSTATES: a scoped "40 hours of
  // Orgo" counted in lock-in time is auto-tracked, and telling its owner up front that unverified
  // pays a tier down is a caveat about a rule that will never apply to them. That is the same
  // broken promise this screen exists to avoid, pointed the other way.
  //
  // 0175 EXTENDS THE SAME ARGUMENT TO A RACE. A duel, a collective goal and a placement race derive
  // their verifiability from the RACE METRIC rather than from a goal's type — lock-in time, volume
  // and distance are measured; a grade is somebody's word. Before 0174 taught settlement to read
  // the tier at all, none of this could be honest on a social branch, because the number shown here
  // came from a pricing path that settlement never consulted. It does now.
  //
  // The campfire branch stays 'honor' and is not an oversight: host_campfire_challenge builds a
  // 'count' race, which is people typing how many they did.
  const claimLevel: GoalClaimLevel =
    branch === 'solo'
      ? goalType !== 'custom' || countMode === 'lockin_time'
        ? 'auto'
        : 'honor'
      : branch === 'campfire'
        ? 'honor'
        : (branch === 'collective' ? OBSERVED_COLLECTIVE_METRICS : OBSERVED_METRICS).includes(
              String(p.metric ?? '')
            )
          ? 'auto'
          : 'honor';

  const [preview, setPreview] = useState<ScopedRewardPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    previewScopedReward(tier, claimLevel).then((r) => {
      if (alive) setPreview(r);
    });
    return () => {
      alive = false;
    };
  }, [tier, claimLevel]);

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
      if (branch === 'collective' || branch === 'placement') {
        // 🔒 THE TIER GOES IN WITH THE CREATE, not after it (0175). set_challenge_scope refuses a
        // challenge that has already started, and a placement race with an immediate start is
        // inserted 'active' — so a second call would be accepted for a collective goal and
        // silently refused for a placement one, on the very screen that just quoted a price.
        // Passing p_tier makes it one transaction, and the server still DERIVES verifiability
        // from the metric rather than accepting anything this client believes about it.
        const metric = (p.metric ?? 'lockin_time') as SocialChallengeRaceMetric;
        const windowHours = Number(p.windowHours ?? 168) || 168;
        const created =
          branch === 'placement'
            ? await createPlacementChallenge({
                circleId: String(p.circleId),
                raceMetric: metric,
                windowHours,
                publicName: String(p.label),
                tier,
              })
            : await createGroupChallenge({
                circleId: String(p.circleId),
                // Exactly ONE bar, matching the server's constraint: a measured collective goal
                // sends raceMetric + targetValue, and a lock-in one sends the count instead.
                ...(metric === 'volume' || metric === 'distance'
                  ? { raceMetric: metric, targetCount: null, targetValue: Number(p.target ?? 0) }
                  : { targetCount: Math.max(1, Math.round(Number(p.target ?? 1))) }),
                windowHours,
                publicName: String(p.label),
                tier,
              });
        router.replace(`/challenge-info/${created.id}`);
        return;
      }
      if (branch === 'duel') {
        // A duel needs an opponent and a metric the create form already knows how to collect, so
        // this hands off rather than reimplementing that picker behind a different door.
        router.replace({
          pathname: '/challenge/create',
          // The metric rides along with the tier: Cindy proposed both, and dropping the metric
          // would land them on the picker's default with a tier scoped for something else.
          params: {
            shape: 'duel',
            publicName: String(p.label),
            tier,
            ...(p.metric ? { raceMetric: String(p.metric) } : {}),
          },
        });
        return;
      }
      // ── solo ──
      //
      // This is, deliberately, the same two calls in the same order that performCoachAction runs
      // for an unscoped create — createChallenge, then set_goal_scope — so routing through this
      // screen changed WHEN the goal is written and nothing about HOW. `type` and `countMode` are
      // carried from the proposal rather than hardcoded: a built-in metric or a lock-in-time count
      // is what makes a goal auto-verifiable, so pinning them to custom/manual here would quietly
      // downgrade every goal that came through this door.
      const created = await createChallenge({
        userId: session.user.id,
        type: goalType,
        label: String(p.label),
        target: Number(p.target ?? 1),
        // Free text on a custom goal only — createChallenge overrides it from the metric for every
        // built-in type, and migration 0157 enforces the same rule in a trigger.
        unit: String(p.unit ?? ''),
        period: (p.period as ChallengePeriod) ?? 'once',
        countMode,
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
        : branch === 'collective'
          ? `Set it for ${p.circleName || 'the campfire'}`
          : branch === 'placement'
            ? `Start the race in ${p.circleName || 'the campfire'}`
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
