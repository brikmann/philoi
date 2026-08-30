import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { RewardRays } from '@/components/economy/reward-reveal';
import { HexagonBadge } from '@/components/hexagon-badge';
import { EmberIcon } from '@/components/economy/ember-icon';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { postCheckInToCircle } from '@/lib/api/lock-ins';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { markFlameMeterCelebrated } from '@/lib/flame-meter-local';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm, fireEmberLand, fireFlameMeterComplete, fireXpTick } from '@/lib/reward-feedback';
import type { GoalType, MyRank } from '@/types/database';

// Fly timings match design-mocks/27's JS choreography: 5 embers, 150ms apart, starting only
// after the celebration's own rise-in beats have settled (1500ms).
const FLY_COUNT = 5;
const FLY_START_DELAY = 1500;
const FLY_STAGGER = 150;
const FLY_DURATION = 850;

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

function Spark({ delay, xOffset, reduceMotion }: { delay: number; xOffset: number; reduceMotion: boolean }) {
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
  return <Animated.View style={[styles.spark, style]} />;
}

type Point = { x: number; y: number };

// One flying ember collection particle — arcs from the campfire to the ember counter via a
// raised midpoint (same "control point" trick as the mock's Web Animations API keyframes),
// landing calls onLand (bumps the counter + plays the tick).
function EmberFly({ index, from, to, onLand }: { index: number; from: Point; to: Point; onLand: () => void }) {
  const progress = useSharedValue(0);
  const midX = (from.x + to.x) / 2 + (index - FLY_COUNT / 2) * 8;
  const midY = Math.min(from.y, to.y) - 46;

  useEffect(() => {
    const delay = FLY_START_DELAY + index * FLY_STAGGER;
    progress.value = withDelay(delay, withTiming(1, { duration: FLY_DURATION, easing: Easing.out(Easing.cubic) }));
    const landTimer = setTimeout(onLand, delay + FLY_DURATION);
    return () => clearTimeout(landTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot flight per mount
  }, []);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    // Quadratic bezier through (from, mid, to) — gives the arc the mock's midpoint gives it.
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * midY + t * t * to.y;
    return {
      opacity: interpolate(t, [0, 0.12, 0.85, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: x - 4 },
        { translateY: y - 4 },
        { scale: interpolate(t, [0, 0.12, 1], [0.4, 1, 0.35]) },
      ],
    };
  });

  // The crisp ember token, not a plain amber dot — these are the currency landing in the
  // balance, and §4 makes that token the only thing that ever depicts an ember.
  return (
    <Animated.View pointerEvents="none" style={[styles.flyEmber, style]}>
      <EmberIcon size={11} />
    </Animated.View>
  );
}

// The once-a-day meter-fill celebration (PHILOI_UI_SPEC.md §13, design-mocks/27) — shown
// instead of the plain LockInDoneScreen recap when the session that just ended crosses the
// daily flame meter to 100%. See lock-in/index.tsx's handleStop for the crossing detection and
// the "rank-up wins" queueing rule (§11) that can delay this behind RankUpCelebration.
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
  const [reduceMotion, setReduceMotion] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embers, setEmbers] = useState(embersBefore);
  // Trim to the first token — display names are frequently "First Last", and the headline wants
  // the way you'd actually be spoken to. Falls back to the whole string if there's no space.
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  const [flightGeo, setFlightGeo] = useState<{ from: Point; to: Point } | null>(null);
  const [displayXp, setDisplayXp] = useState(rankBefore?.xp_into_tier ?? 0);
  const [plusVisible, setPlusVisible] = useState(false);

  const fireScale = useSharedValue(reduceMotion ? 1 : 0.4);
  const fireOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const roar = useSharedValue(0);
  const burst = useSharedValue(0);
  const headReveal = useSharedValue(reduceMotion ? 1 : 0);
  const pillReveal = useSharedValue(reduceMotion ? 1 : 0);
  const xplineReveal = useSharedValue(reduceMotion ? 1 : 0);
  const bump = useSharedValue(0);
  const fillRatio = useSharedValue(rankBefore ? xpProgressRatio(rankBefore.xp_into_tier, rankBefore.xp_for_next_tier) : 0);

  const overlayRef = useRef<View>(null);
  const fireRef = useRef<View>(null);
  const counterRef = useRef<View>(null);
  const landedCount = useRef(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

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
    xplineReveal.value = withDelay(1100, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once mount effect
  }, [reduceMotion]);

  // Rank bar — same fill-from-before-to-after treatment as LockInDoneScreen, just started a
  // little later so it reads as part of this screen's own reveal sequence, not competing with it.
  useEffect(() => {
    if (!rankBefore || !rankAfter) return;
    const start = rankBefore.xp_into_tier;
    const end = rankAfter.xp_into_tier;
    const delay = reduceMotion ? 0 : 1300;
    const timer = setTimeout(() => {
      setPlusVisible(true);
      fireXpTick();
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
      let raf: ReturnType<typeof requestAnimationFrame>;
      const step = () => {
        const p = Math.min((Date.now() - t0) / durationMs, 1);
        setDisplayXp(Math.round(start + (end - start) * p));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  // Reduced motion: skip the flight entirely and land the final balance immediately (matches
  // FlameMeter's own "static per tier" reduced-motion fallback). Depends on reduceMotion itself
  // (not just mount) since AccessibilityInfo's check resolves asynchronously shortly after mount.
  useEffect(() => {
    if (reduceMotion) setEmbers(embersBefore + bonusEmbers);
  }, [reduceMotion, embersBefore, bonusEmbers]);

  // Measure the fire + ember-counter positions (in window coordinates) once laid out, so the
  // flying embers can arc between two real on-screen points rather than guessed percentages —
  // this screen's layout isn't fixed enough (recap pill width varies) to hardcode safely.
  useEffect(() => {
    if (reduceMotion) return;
    const raf = requestAnimationFrame(() => {
      overlayRef.current?.measureInWindow((ox, oy) => {
        fireRef.current?.measureInWindow((fx, fy, fw, fh) => {
          counterRef.current?.measureInWindow((cx, cy, cw, ch) => {
            setFlightGeo({
              from: { x: fx + fw / 2 - ox, y: fy + fh * 0.4 - oy },
              to: { x: cx + cw * 0.25 - ox, y: cy + ch / 2 - oy },
            });
          });
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  function handleEmberLand() {
    landedCount.current += 1;
    bump.value = withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 260 }));
    fireEmberLand();
    setEmbers(landedCount.current >= FLY_COUNT ? embersBefore + bonusEmbers : (prev) => prev + 1);
  }

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
  const xplineStyle = useAnimatedStyle(() => ({
    opacity: xplineReveal.value,
    transform: [{ translateY: interpolate(xplineReveal.value, [0, 1], [12, 0]) }],
  }));
  const counterBumpStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + bump.value * 0.35 }],
  }));
  const barStyle = useAnimatedStyle(() => ({ width: `${fillRatio.value * 100}%` }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: withDelay(300, withTiming(plusVisible ? 1 : 0, { duration: 400 })) }));

  const atMaxRank = rankAfter ? rankAfter.xp_for_next_tier <= 0 : false;

  return (
    <View style={styles.container} ref={overlayRef} collapsable={false}>
      <View style={styles.topbar}>
        <View style={styles.recap}>
          <DisciplineIcon name={GOAL_TYPE_GLYPH[goalType]} size={12} color={Colors.amber} />
          <Text style={styles.recapText} numberOfLines={1}>
            {GOAL_TYPE_META[goalType].label}
            {goalDetail ? ` · ${goalDetail}` : ''} · {formatDurationClock(durationSeconds)}
          </Text>
        </View>
        <View ref={counterRef} collapsable={false} style={styles.emberCount}>
          <View style={styles.emberAv}>
            <EmberIcon size={11} />
          </View>
          <Animated.Text style={[styles.emberN, counterBumpStyle]}>{embers}</Animated.Text>
        </View>
      </View>

      <View style={styles.celebrate}>
        {/* The rays, from the shared reveal language. This screen already SHOWED its reward — the
            fire-bonus chip and the ember counter flying up — and was the one payout with no rays at
            all, which is the mirror image of the rank-up's problem. Tinted and sized from
            REVEAL_TUNING.daily_fire, so it moves with the rest of the family. */}
        <RewardRays kind="daily_fire" size={280} />
        <Animated.View pointerEvents="none" style={[styles.burst, burstStyle]} />
        <View ref={fireRef} collapsable={false} style={styles.fireZone}>
          <Animated.View style={fireStyle}>
            {/* The roaring flame at mock 92's daily-fire size (punchlist 17 P3) — 78 was small enough
                that the celebration's hero read as an icon rather than a roar. */}
            <FlameSvg width={150 * FLAME_ASPECT_RATIO} height={150} />
          </Animated.View>
          {SPARKS.map((s) => (
            <Spark key={s.delay} delay={s.delay} xOffset={s.xOffset} reduceMotion={reduceMotion} />
          ))}
        </View>

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

        <Animated.View style={[styles.xpline, xplineStyle]}>
          <View style={styles.xpchip}>
            <Text style={styles.xpchipText}>+{Math.round(xpEarned)} XP</Text>
          </View>
          <View style={[styles.xpchip, styles.xpchipBonus]}>
            <Text style={[styles.xpchipText, styles.xpchipBonusText]}>+{bonusXp} fire bonus</Text>
          </View>
        </Animated.View>

        {rankBefore && rankAfter && (
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
      </View>

      {!reduceMotion &&
        flightGeo &&
        Array.from({ length: FLY_COUNT }, (_, i) => (
          <EmberFly key={i} index={i} from={flightGeo.from} to={flightGeo.to} onLand={handleEmberLand} />
        ))}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.shareBtn} onPress={onShare} disabled={sharing}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  recap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recapText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  emberCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  emberAv: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emberN: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ember,
  },
  celebrate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
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
  },
  donePillText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ember,
  },
  xpline: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  xpchip: {
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  xpchipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  xpchipBonus: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: '#F2A33C66',
  },
  xpchipBonusText: {
    color: Colors.amber,
  },
  rankRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: Spacing.two,
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
  flyEmber: {
    position: 'absolute',
    top: 0,
    left: 0,
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
