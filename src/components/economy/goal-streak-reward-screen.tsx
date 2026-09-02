import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ClaimBalancePill, asBoxKey, useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRow, type RewardRowSpec } from '@/components/economy/reward-rows';
import { StreakMeter } from '@/components/economy/streak-meter';
import { FullscreenRays, useRevealCue } from '@/components/economy/reward-reveal';
import { PersonalFlame } from '@/components/personal-flame';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import type { GoalDayAward } from '@/lib/api/challenges';

// The personal-goal / streak payout screen — design-mocks/103.
//
// The counterpart to mock 47: 47 pays out competition, this pays out consistency. Same reward-row
// language on purpose (the mock says so outright), because "you won 50 embers" and "you earned 235
// embers" are the same kind of statement and shouldn't be typeset as if they were different.
//
// STRIPPED TO A TITLE AND ONE ROW. What used to be here, and what Noah cut:
//
//   · a streak badge on the flame, an eyebrow, a headline ("Goal cleared, Noah."), a subline
//     repeating the goal and the streak, a breakdown line explaining the arithmetic, and a footer
//     CTA. Six pieces of text for one number.
//   · the breakdown in particular had a real argument behind it — "7 × 25 daily + 60 streak bonus"
//     is what makes a payout legible as earned rather than invented — and it is gone anyway,
//     because on the DAILY reveal there is no arithmetic to show. "+12 today (easy goal)" explains
//     a single figure by restating it.
//
// What is left is the payout and the thing that took it: the title names the goal you cleared, and
// the one row names what it paid with the Claim inside it. The flame and the rays carry the
// occasion, which is what they were always for.

type Props = {
  /** Exactly what the server said it paid — see economy_award_goal_day (0085). */
  award: GoalDayAward;
  /**
   * "10,000 steps" — the goal in its own words, and now the title.
   *
   * It already carries the target AND the metric: personalGoalTitle (lib/goal-types) formats a
   * steps goal as `${target.toLocaleString()} steps`. So the headline reads off this and nothing
   * had to be threaded through from the goal row.
   */
  goalLabel: string;
  onShare?: () => void;
  onClose: () => void;
  sharing?: boolean;
};

export function GoalStreakRewardScreen({ award, goalLabel, onShare, onClose, sharing = false }: Props) {
  const total = award.embers + award.milestone;
  const isMilestone = award.milestone > 0;

  // 🐛 THE BALANCE HAD NOWHERE TO LAND. Noah reported the ember balance not updating after finishing
  // a goal, and the wallet-refresh pub/sub only fixes that for screens carrying an `EmberPill` —
  // Shop, Inventory, Flame Pass, box/item detail. A goal completion lands the user HERE, on the
  // Challenges tab, and this tab has no pill at all. So there was no number on screen to move, and
  // "it didn't update" was really "it was never shown".
  //
  // The lock-in done screen already solved the same problem its own way (FlameMeterComplete takes
  // `embersBefore` and counts up to the new figure). This is the goal-side equivalent: say what was
  // paid AND what the wallet now holds, so the change is legible without a pill anywhere.
  //
  // Mounted here rather than in the parent on purpose. `useInventory` costs a get_inventory round
  // trip, and hanging it off the Challenges tab would pay that on every focus for a screen that
  // usually shows no reward at all; this component only ever mounts on a real payout. Its fetch runs
  // after the award has resolved (the parent only renders this once `awardGoalDay` came back), and
  // it re-renders again if the shared refresh lands later — see lib/economy/wallet-refresh.ts.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();
  // Withheld rather than guessed while the read is in flight: a total is a factual claim about the
  // ledger, and `embersBefore + total` would be this screen deriving a balance the server owns —
  // wrong the moment anything else moved the wallet in the same window. The pill in the top bar is
  // where it lands now; the wallet figure no longer appears as a string on the ember row, because
  // printing the answer above a counter that is about to count to it is what makes the counter
  // pointless.
  const wallet = walletLoading ? null : walletEmbers;
  const boxKey = asBoxKey(award.box);


  // Box into the bag, then embers into the balance, then the reveal closes itself. `onClose` is
  // reached through `dismiss` so the wallet refresh goes out however the screen is left.
  const {
    rootRef,
    originRef,
    pillRef,
    heroAnchor,
    rootOffset,
    busy,
    step,
    onCta,
    dismiss,
    displayBalance,
    pillStyle,
    layer,
  } = useRewardClaim({
    boxKey,
    boxName: 'your loot box',
    embers: total,
    walletEmbers: wallet,
    onDone: onClose,
  });

  // 🐛 THE MISSING BURST. challenges.tsx has always had two completion branches, and only one of
  // them celebrated: when the server actually PAID, `handleLogged` set `goalAward` and returned
  // early — straight past the `setCelebrating(true)` that fires the burst. So the louder outcome
  // (a real payout, this screen) played nothing, while the quieter one (already banked today) got
  // the animation. Owning the burst here rather than fixing the branch is what keeps it that way:
  // this screen cannot be shown without its own reveal.
  //
  // Fired from an effect, not inline, for the same reason check-in.tsx and challenges.tsx do it —
  // the ref only attaches after the first render, so calling on the render pass would no-op.
  // Empty deps: exactly once per mount, and the parent only ever mounts this on a fresh award.
  //
  // 🔒 PRESENTATION ONLY. The embers landed server-side before this screen existed; the burst
  // announces the payout, it does not create one. Reduce-motion and the sound/haptic preferences
  // are all honoured inside RewardBurst.fire().
  const burstRef = useRef<RewardBurstHandle>(null);
  useEffect(() => {
    burstRef.current?.fire();
  }, []);

  // 🔇 AND THE MISSING FANFARE. The burst above fixed the missing ANIMATION; the sound it plays is
  // 'settle', the quiet post-confirmation tick, and that was the entire audio of a cleared goal.
  // Meanwhile 'victory' had shipped and was wired into REVEAL_TUNING, where nothing bespoke read
  // it. This is the row's cue — 'victory-short' — playing on the reveal that earns it. The burst is
  // muted rather than removed so the two do not overlap; it keeps its Lottie and its haptic.
  useRevealCue('daily_fire');

  // AFTER the claim hook, not before it: the rows now read `step` to decide which of them carries
  // the Claim, so the thing that owns the sequence has to be declared first.
  const rows = useMemo<RewardRowSpec[]>(() => {
    const list: RewardRowSpec[] = [];
    // THE BOX ROW SURVIVES, even though Noah's answer is that daily goals pay embers only. It is a
    // field on GoalDayAward and a milestone could still carry one — and with the footer CTA gone,
    // an unrendered box row would leave its claim step with nothing to tap and the reveal unable to
    // advance past it. One conditional row is cheaper than a dead end.
    //
    // BOX FIRST, THEN EMBERS — the manifest reads in the order the claims run.
    if (award.box) {
      list.push({
        kind: 'box',
        title: 'Loot box',
        detail: `${award.streak}-day goal streak`,
        chip: { label: 'EARNED', color: Colors.amber },
        claim: step === 'box' ? { label: 'Claim', onPress: onCta, disabled: busy } : undefined,
        destination: '→ inventory',
      });
    }
    if (total > 0) {
      list.push({
        kind: 'embers',
        title: `+${total.toLocaleString('en-US')} Embers`,
        // NO CAPTION. "Daily goal · easy target" was a label on a screen whose entire argument is
        // that it is one number and one button, and the difficulty tier is not something anyone
        // came here to read. The streak meter above carries the only context that earns its place.
        detail: undefined,
        // The Claim sits exactly where "→ wallet" used to. Only on the row whose turn it is, so
        // there is never more than one claim on screen.
        claim: step === 'embers' ? { label: 'Claim', onPress: onCta, disabled: busy } : undefined,
        destination: '→ wallet',
      });
    }
    return list;
  }, [total, award.streak, award.box, step, onCta, busy]);

  // §A · IT HAS TO BUILD, NOT APPEAR. Noah: "a smooth animation into the rays like a rank-up — not
  // a static screen that just appears." Until now this screen was a hard cut: the modal faded and a
  // finished reveal was simply there. The rays already bloomed out of nothing (RewardRays), so the
  // one thing landing flat was the thing in front of them.
  //
  // The same curve the shared RevealCard uses — a back-eased overshoot to 1.04 and a settle — so
  // the goal reveal, the card reveal and the rank-up forge all build the same way rather than each
  // having its own idea of an entrance. Delayed 60ms behind the modal's own fade so the two are
  // sequential rather than fighting for the first frame.
  const reduceMotion = useReduceMotion();
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(
      60,
      withSequence(
        withTiming(1.04, { duration: reduceMotion ? 0 : 300, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(1, { duration: reduceMotion ? 0 : 160 })
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one build per mount
  }, []);
  const buildStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.9 + enter.value * 0.1 }],
  }));

  return (
    <View style={styles.root} ref={rootRef} collapsable={false}>
      {/* THE RAYS. This screen predates the shared reveal language, so a cleared goal used to show
          the flame on bare dark for the whole seven seconds. The first pass put a 260pt fan inside
          the crest, which fixed "no rays" and not "the rays don't go around the whole screen" — a
          fan that stops short of the edges reads as a halo stuck to the flame. Full-screen, behind
          everything, anchored on the MEASURED crest rather than on the middle of the phone, because
          the crest sits well above centre and the light has to come off it.

          `daily_fire` is the row FlameMeterComplete pulls too: this and the lock-in done screen are
          the same beat, the day's small payout. Tint, wedge count, intensity and reduce-motion all
          come from REVEAL_TUNING via the shared component. The RewardBurst below is a one-shot that
          fires and fades — it is not this. */}
      <FullscreenRays kind="daily_fire" anchor={heroAnchor} rootOffset={rootOffset} />
      <RewardBurst ref={burstRef} cue="settle" silent />

      {/* Close moved off the top-right corner to make room for the balance: the corner the embers
          fly to has to hold the thing they land in. */}
      <View style={styles.topbar}>
        <Pressable style={styles.close} onPress={dismiss} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={Colors.textTertiary} />
        </Pressable>
        <Animated.View style={pillStyle}>
          <ClaimBalancePill embers={displayBalance} innerRef={pillRef} lit={busy} />
        </Animated.View>
      </View>

      {/* The build wraps the CONTENT, never the rays: the fan is what the content builds INTO, and
          scaling it too would just be the whole screen zooming. */}
      <Animated.View style={[styles.buildLayer, buildStyle]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Mock 103's crest, minus the streak badge that used to sit on it. Reusing PersonalFlame
            rather than redrawing the mock's coal-bed SVG keeps this the user's OWN equipped flame
            — the thing they have been feeding all week is the thing that pays them.

            Also the origin of both flights and the anchor for the rays, hence the ref: the embers
            lift off the flame that earned them, not off the middle of the screen. */}
        <View style={styles.crest} ref={originRef} collapsable={false}>
          <PersonalFlame size={104} />
        </View>

        {/* ONE LINE, AND IT NAMES THE GOAL. "DAILY GOAL COMPLETE: 10,000 STEPS" — `goalLabel`
            already formats as target + metric, so this is the whole headline. The milestone
            variant keeps the streak in the same slot rather than adding a second line, which is
            where the badge that used to sit on the flame went. */}
        <Text style={styles.title}>
          {isMilestone ? `${award.streak}-DAY GOAL STREAK` : 'DAILY GOAL COMPLETE'}:{' '}
          {goalLabel.toUpperCase()}
        </Text>

        {/* §4 — the streak, as something with a next rung rather than a bare digit. Under the
            title and above the payout, because it is the reason the payout happened. */}
        <View style={styles.streak}>
          <StreakMeter streak={award.streak} />
        </View>

        <View style={styles.rewards}>
          {rows.map((row) => (
            <RewardRow key={`${row.kind}-${row.title}`} spec={row} />
          ))}
        </View>

        {/* KEPT, against "nothing else", and it is the one judgement call in this pass. It renders
            only when the server says the weekly ceiling actually clipped the payout — otherwise a
            smaller number than usual appears with nothing on screen to explain it, and with the
            breakdown gone there is now nothing else that could. One line to delete if Noah wants
            it out too. */}
        {award.capped ? (
          <Text style={styles.capped}>
            Weekly earning cap reached — the rest banks again next week.
          </Text>
        ) : null}
      </ScrollView>
      </Animated.View>

      {/* The footer CTA is gone — the claim moved into the ember row. What is left is Share, and
          the X in the top bar for a reveal with nothing to claim. */}
      <View style={styles.foot}>
        {onShare ? (
          <Pressable
            style={styles.shareBtn}
            onPress={onShare}
            disabled={sharing || busy}
            accessibilityRole="button">
            <Text style={styles.shareText}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
          </Pressable>
        ) : null}
      </View>

      {layer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Takes the ScrollView's place in the column, so the build is a transform on the same box rather
  // than a new layout step that would shift the footer.
  buildLayer: { flex: 1 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    // No top padding of its own: the safe-area inset above already clears the status bar, and the
    // extra 8 on top of it left the X and the balance floating in the middle of nothing. This row
    // sits directly under the system bar, which is where a close button belongs.
    paddingTop: 0,
    zIndex: 2,
  },
  close: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  crest: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Was `kick`, a 10.5pt eyebrow over a headline, then 14 when the headline went. It is the
  // headline now, so it is sized as one. The tracking comes DOWN as the size goes up — 1.1 was
  // right for a 10pt label and turns a 20pt line into something spaced-out and hard to read — and
  // it wraps rather than shrinking, because "DAILY GOAL COMPLETE: COLD PLUNGES" on two centred
  // lines reads better than one squeezed one.
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: 0.4,
    color: Colors.amber,
    textAlign: 'center',
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.two,
  },
  streak: {
    alignSelf: 'stretch',
    marginTop: Spacing.three,
  },
  rewards: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  capped: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.amber,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  foot: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  shareBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.twelve,
  },
  shareText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
