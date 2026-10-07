import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { BackHeader } from '@/components/ui/back-header';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { createChallenge, previewScopedReward, setGoalScope } from '@/lib/api/challenges';
import { syncChallengeFromDevice } from '@/lib/api/fitness-challenge-sync';
import { recordCoachAction } from '@/lib/api/coach';
import {
  createGroupChallenge,
  createH2HChallenge,
  createPlacementChallenge,
  hostCampfireChallenge,
  setChallengeScope,
} from '@/lib/api/social-challenges';
import { BOXES } from '@/lib/economy/boxes';
import { asBoxKey, isDifficultyTier, TIER_COLOR, TIER_LINE } from '@/lib/challenge-tier';
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
// CINDY'S VERDICT — a screen, not a chat bubble (design-mocks/173, CODE_PROMPT §A; laid out per
// design-mocks/263).
//
// "You're doing a challenge, and this is what you could win." One vertical read: Cindy says why,
// the goal, the tier she scores it, the crate it pays, one "Lock it in". Every branch of the loop —
// solo, duel, campfire, collective, placement — arrives here, and only what `start` creates
// differs.
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
    /** campfire — 'everyone_hits_target' | 'first_to' */
    shape?: string;
    /** duel */
    opponentName?: string;
    /** duel — set when the opponent is already chosen (the create Q&A), so this screen creates it. */
    opponentId?: string;
    /** duel — the optional "let a campfire watch" circle a people-sheet deep link carried. */
    watchCircleId?: string;
    /** The coach tool whose proposal priced this, so the chat's pending chip is resolved on create. */
    coachTool?: string;
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

  // The create Q&A scores through Cindy's chat op, which leaves her proposal 'proposed' in the
  // transcript. Resolving it once the challenge really exists stops /cindy re-offering a confirm
  // chip that would create it a second time. Fire-and-forget: recordCoachAction never throws.
  const resolveCoachProposal = () => {
    if (p.coachTool) {
      void recordCoachAction({ tool: p.coachTool, input: {}, effect: 'confirm', summary: String(p.label) }, 'done');
    }
  };

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
          // Carried from Cindy's proposal (cindy.tsx). Without them the RPC defaulted to a week.
          windowHours: Number(p.windowHours ?? 168) || 168,
          shape: p.shape === 'first_to' ? 'first_to' : 'everyone_hits_target',
          tier,
        });
        resolveCoachProposal();
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
        resolveCoachProposal();
        router.replace(`/challenge-info/${created.id}`);
        return;
      }
      if (branch === 'duel') {
        const metric = (p.metric ?? 'lockin_time') as SocialChallengeRaceMetric;
        const windowHours = Number(p.windowHours ?? 168) || 168;
        if (p.opponentId) {
          // The create Q&A already asked who, so the duel is created here like every other branch.
          // A duel is inserted 'pending' (it is an invite), which set_challenge_scope accepts — so
          // the tier is the same second call it always was, swallowed on failure for the same
          // reason: an unscoped duel pays a smaller reward, never a wrong one, and losing an invite
          // the opponent already has over a tier that did not stick is the worse trade.
          const duel = await createH2HChallenge({
            opponentId: String(p.opponentId),
            raceMetric: metric,
            windowHours,
            circleId: p.watchCircleId ? String(p.watchCircleId) : null,
            publicName: String(p.label),
          });
          if (duel?.id) await setChallengeScope(duel.id, tier).catch(() => {});
          resolveCoachProposal();
          router.replace(`/challenge-info/${duel.id}`);
          return;
        }
        // Scored in Cindy's chat, which cannot see the friends list — so the opponent is the one
        // open question. The create Q&A asks exactly that and comes straight back here with it,
        // carrying her tier, reason and terms unchanged.
        router.replace({
          pathname: '/challenge/create',
          params: {
            shape: 'duel',
            publicName: String(p.label),
            tier,
            rationale: p.rationale ?? '',
            raceMetric: metric,
            windowHours: String(windowHours),
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
      // Third — the same first sync create.tsx does, for the same reason (0199): an auto-tracked
      // goal counts from the moment it was set, so it should start at its true zero now rather
      // than at whatever the next Challenges-tab focus happens to find. Without this a steps goal
      // built through Cindy sat at 0/10,000 until the user went and opened that one tab.
      //
      // Fire-and-forget, and deliberately NOT awaited: this screen replaces itself on the next
      // line, and routeChallengeSync no-ops for every type with no device source. A goal created
      // inside the creation quiet window never throws a reveal over the screen being dismissed.
      if (created) syncChallengeFromDevice(created).catch(() => {});
      resolveCoachProposal();
      router.replace('/(tabs)/challenges');
    } catch (e) {
      Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  // ── Colour: ONE per rarity, everywhere it is named ──
  //
  // The badge is the tier Cindy judged. The crate tile, its tag and the "what it pays" kicker take
  // the CRATE's own rarity — the same colour whenever the crate is the tier's (the auto-tracked
  // case), and honestly a different one when an honour claim pays a capped crate. Painting a capped
  // Furnace in the LEGENDARY gold would be the screen lying about the prize; the honour caveat below
  // is what explains the gap instead.
  const tierColor = TIER_COLOR[tier];
  const boxRarity = boxKey ? BOXES[boxKey].rarity : null;
  const crateColor = boxRarity && isDifficultyTier(boxRarity) ? TIER_COLOR[boxRarity] : tierColor;
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
  const rationale = p.rationale?.trim();

  return (
    // Headerless (registered in _layout.tsx): the native header was the iOS liquid-glass pill
    // reading "(cindy)". Mock 263 replaces it with the plain ‹ row every pushed page uses.
    <Screen padded={false}>
      <BackHeader title="Cindy's verdict" />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 1 · Cindy speaks. Her rationale VERBATIM when she gave one (see the header); either way
            she states the verdict, and the tier's generic line sits under the badge below. */}
        <View style={styles.cindyRow}>
          <View style={styles.cindyAvatar}>
            <EquippedFlameSvg width={22} height={27} />
          </View>
          <View style={styles.says}>
            <Text style={styles.saysText}>
              {rationale ? `${rationale} ` : ''}I&apos;m scoring this{' '}
              <Text style={[styles.saysTier, { color: tierColor }]}>{tierName}</Text>.
            </Text>
          </View>
        </View>

        {/* 2 · The goal, plainly. */}
        <View style={styles.goalBlock}>
          <Text style={styles.kicker}>THE GOAL</Text>
          <Text style={styles.goal}>{p.label}</Text>
        </View>

        {/* 3 · The tier — the emotional core. Its own tinted card so it reads as JUDGED, not as a
            row in a list. */}
        <View style={[styles.tierCard, { borderColor: `${tierColor}66`, backgroundColor: `${tierColor}1F` }]}>
          <Text style={styles.kicker}>CINDY SCORES IT</Text>
          <View style={styles.tierBadge}>
            <View style={[styles.tierDot, { backgroundColor: tierColor, shadowColor: tierColor }]} />
            <Text style={[styles.tierText, { color: tierColor, textShadowColor: `${tierColor}88` }]}>
              {tier.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.why}>{TIER_LINE[tier]}</Text>
        </View>

        {/* 4 · What it pays — the SERVER's crate and embers (previewScopedReward), never a local
            table. */}
        {preview ? (
          <View style={styles.pay}>
            <View style={[styles.crate, { borderColor: `${crateColor}88`, shadowColor: crateColor }]}>
              {boxKey ? <BoxArt boxKey={boxKey} size={40} /> : <EmberIcon size={26} />}
              {boxRarity ? (
                <View style={[styles.crateTag, { backgroundColor: crateColor }]}>
                  <Text style={styles.crateTagText}>{boxRarity.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.payMeta}>
              <Text style={[styles.payKicker, { color: crateColor }]}>WHAT IT PAYS</Text>
              <Text style={styles.payName}>{boxKey ? BOXES[boxKey].name : 'Embers only'}</Text>
              <View style={styles.emberRow}>
                <EmberIcon size={11} />
                <Text style={styles.emberText}>
                  <Text style={styles.emberStrong}>{preview.embers.toLocaleString('en-US')} embers</Text>
                  {branch === 'solo' ? '' : ' at the top band'}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.paySkeleton}>
            <ActivityIndicator color={Colors.amber} />
          </View>
        )}

        {/* 5 · The honour caveat, said BEFORE they commit, and only to an honour claim. A user who
            learns at the reveal that unverified pays a tier down has been surprised by a rule
            working exactly as designed. 0209: the tier is the EFFORT Cindy judged; the crate is what
            an unvouched claim PAYS. Only two friends lift it — a clip never settles anything by
            itself (0165). */}
        {claimLevel === 'honor' && preview?.discounted ? (
          <View style={styles.caveatRow}>
            <Ionicons name="people-outline" size={13} color={Colors.textTertiary} />
            <Text style={styles.caveat}>
              {tier.toUpperCase()} effort · earns {boxKey ? BOXES[boxKey].name : 'this'} on your word.
              {' '}Self-reported goals pay a capped tier; app-tracked ones pay the full tier.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* 6 · One action. Every branch's create is behind it, unchanged (`start` above). */}
      <View style={styles.footer}>
        <PrimaryButton label="Lock it in" onPress={start} loading={busy} disabled={busy || !preview} />
        <Pressable
          onPress={() => router.back()}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.adjust}>
          <Text style={styles.adjustText}>Adjust the goal</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.four },

  cindyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  cindyAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  says: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  saysText: { fontFamily: Fonts.body, fontSize: 13.5, lineHeight: 19, color: Colors.ink },
  saysTier: { fontFamily: Fonts.bodyBold },

  goalBlock: { alignItems: 'center', marginTop: Spacing.four },
  kicker: { fontFamily: Fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.4, color: Colors.textTertiary },
  goal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 21,
    lineHeight: 25,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 4,
  },

  tierCard: {
    marginTop: Spacing.four,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 15,
    alignItems: 'center',
  },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, marginBottom: 8 },
  tierDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  tierText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 24,
    letterSpacing: 1,
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 0 },
  },
  why: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18, color: Colors.muted, textAlign: 'center' },

  pay: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 16,
    padding: 13,
  },
  paySkeleton: {
    marginTop: 14,
    height: 80,
    borderRadius: 16,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crate: {
    width: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  crateTag: {
    position: 'absolute',
    top: -7,
    alignSelf: 'center',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  crateTagText: { fontFamily: Fonts.bodyBold, fontSize: 8, letterSpacing: 0.5, color: Colors.forgeBg },
  payMeta: { flex: 1, minWidth: 0 },
  payKicker: { fontFamily: Fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.2 },
  payName: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink, marginTop: 1, marginBottom: 3 },
  emberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emberText: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  emberStrong: { fontFamily: Fonts.bodyBold, color: Colors.amber },

  caveatRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 6, marginTop: 9 },
  caveat: { flexShrink: 1, fontFamily: Fonts.body, fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary },

  footer: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.three },
  adjust: { alignSelf: 'center', marginTop: 9, paddingVertical: 4 },
  adjustText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.muted },
});
