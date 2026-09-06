import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { FLAME_ASPECT_RATIO, EquippedFlameSvg } from '@/components/flame-icon';
import { useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRevealFrame, type RowClaim } from '@/components/economy/reward-reveal-frame';
import { type RewardRowSpec } from '@/components/economy/reward-rows';
import { HexagonBadge } from '@/components/hexagon-badge';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useFlameRamp } from '@/lib/economy/flame-ramp';
import { postCheckInToCircle } from '@/lib/api/lock-ins';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { markFlameMeterCelebrated } from '@/lib/flame-meter-local';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm, fireFlameMeterComplete } from '@/lib/reward-feedback';
import type { GoalType, MyRank } from '@/types/database';

type FlameMeterCompleteProps = {
  displayName: string;
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  checkInId: string;
  xpEarned: number;
  bonusXp: number;
  bonusEmbers: number;
  embersBefore: number;
  day: string;
  rankBefore?: MyRank;
  rankAfter?: MyRank;
  circleId: string | null;
  circleName: string | null;
  onShare: () => void;
  sharing?: boolean;
  onDone: () => void;
};

// Continuous rising sparks off the celebration campfire — same staggered rise-and-fade pattern
// as rank-up-celebration.tsx's Ember, duplicated locally since the two components' fire
// positions/scales differ enough that sharing one would just be indirection.
const SPARKS = [
  { delay: 0, xOffset: -18 },
  { delay: 420, xOffset: 12 },
  { delay: 780, xOffset: -4 },
  { delay: 1150, xOffset: 20 },
];

function Spark({
  delay,
  xOffset,
  reduceMotion,
  colour,
}: {
  delay: number;
  xOffset: number;
  reduceMotion: boolean;
  /** The equipped flame's outer stop — a spark is a piece of the fire that threw it. */
  colour: string;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.75, 1], [0, 0.9, 0.5, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -78]) },
      { translateX: xOffset },
      { scale: interpolate(progress.value, [0, 1], [0.55, 1]) },
    ],
  }));

  if (reduceMotion) return null;
  return <Animated.View style={[styles.spark, { backgroundColor: colour }, style]} />;
}

// The once-a-day meter-fill celebration (PHILOI_UI_SPEC.md §13, design-mocks/27) — shown
// instead of the plain LockInDoneScreen recap when the session that just ended crosses the
// daily flame meter to 100%. See lock-in/index.tsx's handleStop for the crossing detection and
// the "rank-up wins" queueing rule (§11) that can delay this behind RankUpCelebration.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 THE DAILY FIRE WAS THE ODD ONE OUT. Noah, from an on-device run: "Daily fire isn't full-screen
// ray cover like the challenge screen, nor are the rewards positioned the same."
//
// Both halves were true, and both were this screen keeping the version of the reveal language it
// was born with while the others moved on:
//
//   · THE LIGHT. It drew `RewardRays size={280}` — a bounded 280pt fan, which reads as a halo stuck
//     to the flame rather than as light filling the screen. The challenge reveal had long since
//     moved to `FullscreenRays`, which measures to the farthest corner and escapes the safe-area
//     wrappers. It now gets that one, through the shared frame, so there is no size to keep in
//     sync.
//
//   · THE REWARDS. They were two chips — `+250 XP` and `+40 fire bonus` — plus an ember counter in
//     the corner that a spray of embers flew into on a 1500ms timer whether you asked or not. That
//     is a payout that HAPPENS AT you. Everywhere else in the app the same four currencies are a
//     manifest of RewardRows you claim. So the chips are rows now, each with its own Claim, and the
//     embers fly when you press the ember row rather than when a timer says so.
//
// WHAT IS DELIBERATELY KEPT: the roaring flame and its sparks, "You're on fire, {name}!", the
// DAILY FIRE COMPLETE pill, the rank bar, and Share / Post to the campfire / Done. This was a
// reframing of a screen that worked, not a replacement for it.
// ══════════════════════════════════════════════════════════════════════════════════════════════
export function FlameMeterComplete({
  displayName,
  goalType,
  goalDetail,
  durationSeconds,
  checkInId,
  xpEarned,
  bonusXp,
  bonusEmbers,
  embersBefore,
  day,
  rankBefore,
  rankAfter,
  circleId,
  circleName,
  onShare,
  sharing,
  onDone,
}: FlameMeterCompleteProps) {
  const reduceMotion = useReduceMotion();
  // The ring and the sparks are this screen's hero glow — the light the roaring flame throws — so
  // they follow the equipped flame for the same reason the ray fan behind them does.
  const ramp = useFlameRamp();
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Trim to the first token — display names are frequently "First Last", and the headline wants
  // the way you'd actually be spoken to. Falls back to the whole string if there's no space.
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  const [displayXp, setDisplayXp] = useState(rankBefore?.xp_into_tier ?? 0);
  const [plusVisible, setPlusVisible] = useState(false);

  const fireScale = useSharedValue(reduceMotion ? 1 : 0.4);
  const fireOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const roar = useSharedValue(0);
  const burst = useSharedValue(0);
  const headReveal = useSharedValue(reduceMotion ? 1 : 0);
  const pillReveal = useSharedValue(reduceMotion ? 1 : 0);
  const fillRatio = useSharedValue(rankBefore ? xpProgressRatio(rankBefore.xp_into_tier, rankBefore.xp_for_next_tier) : 0);

  // THE LEDGER'S OWN FIGURE, not `embersBefore + bonusEmbers`. The daily-fire bonus is granted
  // server-side by the stop RPC before this screen mounts, so a live wallet read already includes
  // it — and the hook derives the PRE-payout balance by subtracting what was paid. Deriving it the
  // other way round is the bug the goal reveal's `newBalance` note describes: it is wrong the
  // moment anything else moved the wallet in the same window. `embersBefore` stays a prop only
  // because it is the fallback while the read is in flight.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();

  // The campfire-pop beat: fires the once-a-day cue immediately (this screen only mounts once,
  // right after the crossing stop) and marks the AsyncStorage flag so the home flame-meter
  // widget's own fallback check doesn't replay it later.
  useEffect(() => {
    fireFlameMeterComplete();
    markFlameMeterCelebrated(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once mount effect
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const bezier = Easing.bezier(0.25, 0.55, 0.25, 1);
    fireOpacity.value = withTiming(1, { duration: 500, easing: bezier });
    fireScale.value = withTiming(1, { duration: 500, easing: bezier });
    roar.value = withDelay(
      500,
      withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 500 })), -1, true)
    );
    burst.value = withDelay(150, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));

    headReveal.value = withDelay(650, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    pillReveal.value = withDelay(900, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once mount effect
  }, [reduceMotion]);

  // 🔴 THE RANK BAR NOW BELONGS TO THE XP ROW'S CLAIM.
  //
  // It used to fill on a 1300ms timer — the screen paid you on a schedule, and by the time you had
  // read the headline the bar had already moved. This is the same fill, the same count-up and the
  // same `+N XP` plus-label, hung off `onXpClaimed` instead. XP has no flight of its own (see
  // RewardClaimKind: there is nowhere for it to fly on the two reveals that have no bar), so on
  // THIS screen the bar IS the flight, which is exactly what Noah asked the XP row to do.
  // NOT a useCallback: this writes to `fillRatio`, a Reanimated shared value, and a shared value
  // that is also a hook dependency is exactly what react-hooks/immutability rejects — the same
  // reason useRewardClaim's own `handleEmberLand` is a plain function. The identity is free here:
  // the hook stores this in a ref rather than depending on it.
  function handleXpClaimed() {
    if (!rankBefore || !rankAfter) return;
    const start = rankBefore.xp_into_tier;
    const end = rankAfter.xp_into_tier;
    setPlusVisible(true);
    fillRatio.value = reduceMotion
      ? xpProgressRatio(end, rankAfter.xp_for_next_tier)
      : withTiming(xpProgressRatio(end, rankAfter.xp_for_next_tier), {
          duration: 1000,
          easing: Easing.bezier(0.2, 0.7, 0.3, 1),
        });
    if (reduceMotion) {
      setDisplayXp(end);
      return;
    }
    const durationMs = 1000;
    const t0 = Date.now();
    const step = () => {
      const p = Math.min((Date.now() - t0) / durationMs, 1);
      setDisplayXp(Math.round(start + (end - start) * p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // The tick sound is fired by the hook itself, for every screen, so it is not repeated here.
  }

  // The session's XP and the daily-fire bonus are two separate grants — `postedCheckIn.xp_earned`
  // and `dailyFire.bonus_xp` — so they are added here rather than assumed to overlap, and the
  // split is named on the row's second line. One claimable XP row, because the rank bar it moves
  // is one bar.
  const totalXp = Math.round(xpEarned) + bonusXp;

  const claim = useRewardClaim({
    // The daily fire pays no box. The field is here so the shape matches the other three reveals
    // and a future streak crate needs no new wiring.
    boxKey: null,
    embers: bonusEmbers,
    xp: totalXp,
    walletEmbers: walletLoading ? embersBefore + bonusEmbers : walletEmbers,
    onXpClaimed: handleXpClaimed,
    onDone,
  });

  async function handlePost() {
    if (!circleId) {
      onDone();
      return;
    }
    setPosting(true);
    setError(null);
    try {
      await postCheckInToCircle(checkInId, circleId);
      fireConfirm();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post to the campfire — try again.'));
    } finally {
      setPosting(false);
    }
  }

  const fireStyle = useAnimatedStyle(() => ({
    opacity: fireOpacity.value,
    transform: [
      { scaleY: fireScale.value * (1 + roar.value * 0.11) },
      { scaleX: fireScale.value * (1 - roar.value * 0.05) },
    ],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 1], [0.85, 0]),
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.5, 2.6]) }],
  }));
  const headStyle = useAnimatedStyle(() => ({
    opacity: headReveal.value,
    transform: [{ translateY: interpolate(headReveal.value, [0, 1], [12, 0]) }],
  }));
  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillReveal.value,
    transform: [{ translateY: interpolate(pillReveal.value, [0, 1], [12, 0]) }],
  }));
  const barStyle = useAnimatedStyle(() => ({ width: `${fillRatio.value * 100}%` }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: withDelay(300, withTiming(plusVisible ? 1 : 0, { duration: 400 })) }));

  const atMaxRank = rankAfter ? rankAfter.xp_for_next_tier <= 0 : false;

  // Destructured immediately, for both reasons the challenge screen's own note gives: the hook's
  // measurement refs taint `claim.x` reads during render, and the object is new every render.
  const { claimed, claimFor } = claim;
  const rows = useMemo<RewardRowSpec[]>(
    () => buildRows(bonusEmbers, Math.round(xpEarned), bonusXp, totalXp, { claimed, claimFor }),
    [bonusEmbers, xpEarned, bonusXp, totalXp, claimed, claimFor]
  );

  return (
    <RewardRevealFrame
      claim={claim}
      // The row the goal reveal pulls too: this and the cleared-goal screen are the same beat, the
      // day's small payout. Tint, wedge count and intensity all come from REVEAL_TUNING.
      kind="daily_fire"
      heroStyle={styles.fireZone}
      hero={
        <>
          <Animated.View
            pointerEvents="none"
            style={[styles.burst, { borderColor: ramp.outer }, burstStyle]}
          />
          <Animated.View style={fireStyle}>
            {/* The roaring flame at mock 92's daily-fire size (punchlist 17 P3) — 78 was small
                enough that the celebration's hero read as an icon rather than a roar. Equipped
                rather than brand-orange, so the hero, the ring, the sparks and the ray fan behind
                them are all one fire. */}
            <EquippedFlameSvg width={150 * FLAME_ASPECT_RATIO} height={150} />
          </Animated.View>
          {SPARKS.map((s) => (
            <Spark
              key={s.delay}
              delay={s.delay}
              xOffset={s.xOffset}
              reduceMotion={reduceMotion}
              colour={ramp.outer}
            />
          ))}
        </>
      }
      rows={rows}
      below={
        <>
          {rankBefore && rankAfter && (
            // BELOW THE ROWS, per the parity pass — the manifest sits in the same place on all four
            // reveals and the context that explains it follows underneath.
            <View style={styles.rankRow}>
              <HexagonBadge tier={rankAfter.tier} division={rankAfter.division} size={40} />
              <View style={styles.rankCol}>
                <View style={styles.rankTop}>
                  <Text style={styles.rankTier} numberOfLines={1}>
                    {formatRankTier(rankAfter.tier, rankAfter.division)}
                  </Text>
                  <View style={styles.rankTopRight}>
                    <Animated.Text style={[styles.rankPlus, plusStyle]}>+{Math.round(xpEarned)} XP</Animated.Text>
                    <Text style={styles.rankNum}>{displayXp.toLocaleString()}</Text>
                    <Text style={styles.rankMax}>
                      {atMaxRank ? ' max' : ` / ${Math.round(rankAfter.xp_for_next_tier).toLocaleString()}`}
                    </Text>
                  </View>
                </View>
                <View style={styles.trk}>
                  <Animated.View style={[styles.trkFill, barStyle]} />
                </View>
              </View>
            </View>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </>
      }
      footer={
        <View style={styles.actions}>
          <Pressable style={styles.shareBtn} onPress={onShare} disabled={sharing || claim.busy}>
            {sharing ? (
              <ActivityIndicator color={Colors.ink} />
            ) : (
              <>
                <Ionicons name="share-social" size={16} color={Colors.ink} />
                <Text style={styles.shareBtnLabel}>Share to your story</Text>
              </>
            )}
          </Pressable>
          <View style={styles.subacts}>
            <Pressable onPress={handlePost} disabled={posting}>
              <Text style={styles.postLink}>{posting ? 'Posting…' : `Post to ${circleName ?? 'the campfire'}`}</Text>
            </Pressable>
            <Pressable onPress={onDone} disabled={posting}>
              <Text style={styles.doneLink}>Done</Text>
            </Pressable>
          </View>
        </View>
      }>
      {/* White with the name in ember, NOT a flat gold line (§2). The old all-#FFD27A headline
          is the "no yellow" this fixes: gold on deep purple reads as a warning colour at 24px,
          and it flattened the one word that should carry the warmth — theirs. First name only;
          a full "Noah Brikman" in a celebration headline reads like a form field. */}
      <Animated.Text style={[styles.headline, headStyle]}>
        You&apos;re on fire, <Text style={styles.headlineName}>{firstName}</Text>!
      </Animated.Text>
      <Animated.View style={[styles.donePill, pillStyle]}>
        <Text style={styles.donePillText}>DAILY FIRE COMPLETE</Text>
      </Animated.View>

      {/* The session recap. It used to be a top-bar strip opposite the ember counter; the frame's
          top bar is the close button and the balance pill now — the corner the embers fly to has to
          hold the thing they land in — so the recap moves under the title, which is where the other
          reveals put their "what this was" line anyway. */}
      <View style={styles.recap}>
        <DisciplineIcon name={GOAL_TYPE_GLYPH[goalType]} size={12} color={Colors.amber} />
        <Text style={styles.recapText} numberOfLines={1}>
          {GOAL_TYPE_META[goalType].label}
          {goalDetail ? ` · ${goalDetail}` : ''} · {formatDurationClock(durationSeconds)}
        </Text>
      </View>
    </RewardRevealFrame>
  );
}

function buildRows(
  bonusEmbers: number,
  sessionXp: number,
  bonusXp: number,
  totalXp: number,
  claim: RowClaim
): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];

  // EMBERS FIRST, THEN XP — the order "Claim all" runs, and the same order the challenge reveal
  // lists them in. These two were `xpchip` / `xpchipBonus`, a pair of pills with no controls.
  if (bonusEmbers > 0) {
    rows.push({
      kind: 'embers',
      title: 'Embers',
      detail: 'Daily fire bonus',
      value: `+${bonusEmbers.toLocaleString('en-US')}`,
      claim: claim.claimFor('embers'),
      claimed: Boolean(claim.claimed.embers),
      destination: '→ wallet',
    });
  }
  if (totalXp > 0) {
    rows.push({
      kind: 'xp',
      title: 'XP earned',
      // The split, stated. The two chips this replaces were the only place the fire bonus was named
      // and it would be a real loss to fold it silently into one number — "+290 XP" with no
      // explanation is the payout looking arbitrary, which is the thing the goal reveal's deleted
      // breakdown line was originally defending against.
      detail:
        bonusXp > 0
          ? `${sessionXp.toLocaleString('en-US')} for the session · ${bonusXp.toLocaleString('en-US')} daily fire bonus`
          : 'This session',
      value: `+${totalXp.toLocaleString('en-US')}`,
      claim: claim.claimFor('xp'),
      claimed: Boolean(claim.claimed.xp),
    });
  }
  return rows;
}

const styles = StyleSheet.create({
  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.two,
  },
  recapText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  burst: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  fireZone: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 90,
  },
  spark: {
    position: 'absolute',
    bottom: 14,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.amber,
  },
  headline: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 24,
    textAlign: 'center',
    color: '#FFFFFF',
    marginTop: Spacing.two,
  },
  headlineName: {
    color: Colors.ember,
  },
  donePill: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: Spacing.two,
  },
  donePillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ember,
  },
  rankRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: Spacing.three,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
  },
  rankCol: {
    flex: 1,
    minWidth: 0,
  },
  rankTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  rankTier: {
    flexShrink: 0,
    marginRight: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  rankTopRight: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  rankPlus: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
    marginRight: 6,
  },
  rankNum: {
    fontFamily: Fonts.display,
    fontSize: 11.5,
    color: Colors.ink,
  },
  rankMax: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  trk: {
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    marginTop: 7,
  },
  trkFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  actions: {
    width: '100%',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.coral,
    borderRadius: 14,
    padding: 14,
  },
  shareBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  subacts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  postLink: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.amber,
  },
  doneLink: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
});
