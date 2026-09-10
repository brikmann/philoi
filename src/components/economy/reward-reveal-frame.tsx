import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ClaimBalancePill, type useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRow, type RewardRowSpec } from '@/components/economy/reward-rows';
import { FullscreenRays, type RewardRevealKind } from '@/components/economy/reward-reveal';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

/** Mock 170's fan opacity, shared by all four reveals so none of them can drift brighter. */
const REVEAL_RAY_OPACITY = 0.34;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE REVEAL SHELL — one frame, four payouts.
//
// WHAT THIS IS FOR. Four screens celebrate a payout: a settled challenge, a cleared daily goal, a
// crossed daily fire meter and a division bump. They are the same event photographed four ways —
// light off a hero, a headline, a manifest of what you won, a way to take it — and they had four
// implementations. So they drifted, exactly the way four copies do: the challenge screen grew the
// full-screen ray fan and the daily fire kept a 280pt halo; the challenge and goal screens grew
// reward rows and the rank-up kept "+100 embers · Ignition Crate" as a string. Every one of Noah's
// three reports is a diff between two of these files rather than a bug in any of them.
//
// The fix that lasts is not fixing the three — it is having one frame, so the next thing added to a
// reveal is added to all of them at once. `FullscreenRays` + `ClaimBalancePill` + `RewardRow` +
// `useRewardClaim` were already four shared pieces; what was missing was the thing that ASSEMBLES
// them, which is the part each screen was re-deciding.
//
// WHAT IT DELIBERATELY DOES NOT OWN. The hero and the headline, because that is the entire
// difference between a division bump and a step goal, and a frame that templated those would be
// four screens wearing one costume. It owns the geometry, the light, the manifest and the way out.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// §0 · THE TWO-STEP REVEAL (mock 170), and why it is in the frame rather than in three screens.
//
// Noah: don't dump a scrolling pile of rewards — a box AND embers AND XP AND a cosmetic title —
// because it buries the moment and looks cheap. He is describing a real failure mode: the thing
// the user actually did (won the duel, crossed the division) arrives on screen at the same instant
// as four things they now have to tap, and the achievement loses to the loot.
//
// So the reveal is two faces of one screen, the way Season End does it:
//
//   STEP 1 · STATUS   the placement / rank / crown / flame, centred, with the eyebrow, headline
//                     and status line. No rows at all. The footer offers "See rewards".
//   STEP 2 · REWARDS  a giant white "YOUR REWARDS" flashes in at the top while the row list fades
//                     up into the centre. The footer becomes "Claim all", then "Done".
//
// It lives HERE because the transition is the part that would drift: three screens each owning a
// stage flag, a flash animation and a fade would be three subtly different reveals within a month.
// A wrapper passes a `status` node and a `rows` list and gets the choreography for free.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Everything `useRewardClaim` hands back. Passed whole rather than as fifteen props. */
export type RewardClaim = ReturnType<typeof useRewardClaim>;

/**
 * The slice of the claim that a `buildRows` function reads.
 *
 * Narrower than `RewardClaim` on purpose. The full object carries the three measurement refs, and
 * the React Compiler treats any render-time read off a ref-carrying object as a ref access; it is
 * also a fresh object on every render, so a row list memoised on it would rebuild ~16 times a
 * second while the balance counter ticks. Row builders take these four fields — each individually
 * stable — so the memo actually holds for the length of a flight.
 */
export type RowClaim = {
  claimed: RewardClaim['claimed'];
  busy?: RewardClaim['busy'];
  claimFor: RewardClaim['claimFor'];
  /** Fire one kind directly — what a box row's Open runs before it navigates. */
  claimOne?: RewardClaim['claim'];
};

type Props = {
  /** The claim hook, already constructed by the screen with its own payload. */
  claim: RewardClaim;
  /** Which reveal this is — drives the ray tint, count and intensity from REVEAL_TUNING. */
  kind: RewardRevealKind;
  /**
   * Whether the full-screen fan paints at all.
   *
   * A prop rather than always-on because of the one place it must NOT be: the challenge screen
   * gates it on `intensity.level >= 3`, since the spec is explicit that a weak result gets embers,
   * not blaze, and a full-screen ray blast behind "NEEDS IGNITION" would be the app cheering a
   * loss. The gate stays at the call site that owns the tier; the frame just does as it is told.
   */
  rays?: boolean;
  /**
   * The thing the light comes off and the rewards fly out of. Gets `originRef`, so it is also what
   * the rays anchor on — the fan has to bloom from the flame, not from the middle of the phone.
   */
  hero: ReactNode;
  /** The hero's box, when it needs a fixed one (the challenge burst is a 200pt square). */
  heroStyle?: StyleProp<ViewStyle>;
  /**
   * Eyebrow, headline, sublines — whatever this particular payout calls itself.
   *
   * This is STEP ONE's content. It is what the moment IS, so it is shown alone first and then
   * stood down once the rewards come up; a headline competing with a claim button is the thing the
   * two-step exists to prevent.
   */
  children?: ReactNode;
  /**
   * Skip straight to the rewards.
   *
   * For a reveal with a status worth pausing on but nothing to pause FOR — no box, no embers, no
   * XP — the "See rewards" button would promise a second screen that turns out to be empty. The
   * frame decides this itself from `rows`; the prop is only for a caller that wants the old
   * single-screen behaviour back.
   */
  singleStep?: boolean;
  /** What was won. Built by the screen from the SERVER's payload, never re-derived here. */
  rows: RewardRowSpec[];
  /** Streak meter, rank bar, the weekly-cap note — context that sits under the manifest. */
  below?: ReactNode;
  /** Extra footer content under the CTA: Share, Post to the campfire. */
  footer?: ReactNode;
  /** Hide the footer CTA on a reveal whose rows are the only controls. */
  cta?: boolean;
  /** Hide the top bar on a reveal that draws its own (the rank-up keeps its share header). */
  topBar?: boolean;
};

export function RewardRevealFrame({
  claim,
  kind,
  rays = true,
  hero,
  heroStyle,
  children,
  rows,
  below,
  footer,
  cta = true,
  topBar = true,
  singleStep = false,
}: Props) {
  // DESTRUCTURED ONCE, at the top. `claim` carries the three measurement refs, and the React
  // Compiler's ref rule taints the whole object with them — every `claim.busy` scattered through
  // the JSX below then reads as "accessing a ref during render". Pulling the values out here is the
  // same shape every call site used when each screen built this frame by hand, and it keeps the
  // hook's fifteen outputs travelling as one prop rather than fifteen.
  const {
    rootRef,
    originRef,
    pillRef,
    heroAnchor,
    rootOffset,
    busy,
    ctaLabel,
    onCta,
    dismiss,
    displayBalance,
    pillStyle,
    layer,
  } = claim;
  // §A · IT HAS TO BUILD, NOT APPEAR. Noah: "a smooth animation into the rays like a rank-up — not
  // a static screen that just appears." A back-eased overshoot to 1.04 and a settle, delayed 60ms
  // behind the presenting modal's own fade so the two are sequential rather than fighting for the
  // first frame. This lived in three files with three identical copies of the curve; it is the
  // clearest example of what the frame is for.
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

  // ── §0 · the two faces ───────────────────────────────────────────────────────────────────────
  //
  // A reveal with nothing to claim never enters step two — see `singleStep`. Everything else opens
  // on the status and waits to be asked.
  const hasRewards = !singleStep && rows.length > 0;
  const [showRewards, setShowRewards] = useState(!hasRewards);

  // The giant white header, and the rows coming up under it. Both are one-shot: this drives the
  // ENTRANCE into step two, not a loop, so once it has played it holds at rest.
  //
  // 🐛 STARTS AT 1 WHEN THERE IS NO STEP ONE. `revealT` is what the flash and the fade-up read, so
  // a reveal that opens straight on its rewards — `singleStep`, or a payout with nothing to claim —
  // would mount its rows at opacity 0 with nothing scheduled to move them. The initial value has to
  // agree with the initial stage.
  const revealT = useSharedValue(hasRewards ? 0 : 1);
  const startRewards = () => {
    setShowRewards(true);
    revealT.value = 0;
    revealT.value = withTiming(1, {
      duration: reduceMotion ? 0 : 620,
      easing: Easing.out(Easing.cubic),
    });
  };

  // Mock 170's `flashIn`: up from -10px at 0.86, overshoot to 1.08, settle. The brightness ramp in
  // the mock is a CSS filter with no React Native equivalent, so the flash is carried by scale and
  // a text shadow that is already at full strength — the overshoot is what reads as the flash.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(revealT.value, [0, 0.25, 1], [0, 1, 0.95]),
    transform: [
      { translateY: interpolate(revealT.value, [0, 0.4, 1], [-10, 0, 0]) },
      { scale: interpolate(revealT.value, [0, 0.4, 0.62, 1], [0.86, 1.08, 1, 1]) },
    ],
  }));

  // `fadeUp`, delayed behind the flash the way the mock stages them (0.34s of a 1s flash).
  const rowsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(revealT.value, [0, 0.34, 1], [0, 0, 1]),
    transform: [{ translateY: interpolate(revealT.value, [0, 0.34, 1], [16, 16, 0]) }],
  }));

  return (
    <View style={styles.root} ref={rootRef} collapsable={false}>
      {/* Behind the WHOLE frame, under the status bar and the footer — see FullscreenRays for why
          this needs `rootOffset` to escape the safe-area wrappers every caller nests it in. */}
      {rays ? (
        <FullscreenRays
          kind={kind}
          anchor={heroAnchor}
          rootOffset={rootOffset}
          // Mock 170: the fan converges on the hero at ~.34 — present, but the rewards keep
          // supremacy. The per-kind values in REVEAL_TUNING (0.66–0.9) were set when the fan had
          // the screen to itself; behind a list of claimable rows they fight it.
          intensity={REVEAL_RAY_OPACITY}
        />
      ) : null}

      {/* Close sits opposite the balance: the corner the embers fly to has to hold the thing they
          land in, so the X gave it up. */}
      {topBar ? (
        <View style={styles.topbar}>
          <Pressable style={styles.close} onPress={dismiss} hitSlop={12} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={Colors.textTertiary} />
          </Pressable>
          <Animated.View style={pillStyle}>
            <ClaimBalancePill embers={displayBalance} innerRef={pillRef} lit={busy} />
          </Animated.View>
        </View>
      ) : null}

      {/* The build wraps the CONTENT, never the rays: the fan is what the content builds INTO, and
          scaling it too would just be the whole screen zooming. */}
      <Animated.View style={[styles.buildLayer, buildStyle]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={heroStyle ?? styles.hero} ref={originRef} collapsable={false}>
            {hero}
          </View>

          {/* STEP ONE. Stood down rather than unmounted once the rewards are up: the hero above it
              is the flights' measured origin and the rays' anchor, and remounting the column around
              it would move both mid-animation.

              🐛 GATED ON `hasRewards`, NOT ON `showRewards` ALONE. `showRewards` starts TRUE for a
              reveal that has no second face — `rows` empty, or `singleStep` — because there is no
              step two to walk to. Reading it by itself therefore stood step one down before it had
              ever been drawn, and the relic reveal (the only caller that passes `rows={[]}`) shipped
              with no eyebrow, no name, no threshold and no lore: an icon and two buttons. Children
              are only ever stood down for the face that REPLACES them, which is the row list. */}
          {hasRewards && showRewards ? null : children}

          {/* The header announces a list; with no list it would be announcing nothing. */}
          {showRewards && rows.length > 0 ? (
            <>
              {/* The giant white header. Inside the scrolling column rather than pinned to the top
                  of the card, which is what keeps it clear of the balance pill on every screen size
                  — the mock's absolute `top:92px` is a fixed-height artboard's luxury. */}
              <Animated.View style={flashStyle} pointerEvents="none">
                <Text style={styles.bigHeader}>YOUR REWARDS</Text>
              </Animated.View>

              <Animated.View style={[styles.rewards, rowsStyle]}>
                {rows.map((row) => (
                  <RewardRow key={`${row.kind}-${row.title}`} spec={row} />
                ))}
              </Animated.View>
            </>
          ) : null}

          {below}
        </ScrollView>
      </Animated.View>

      <View style={styles.foot}>
        {/* WAS THE ONLY CONTROL, IS NOW THE SHORTCUT. Every row carries its own claim, so this is
            "Claim all" while anything is left and the way out once nothing is — not a button you
            tap once per reward. Disabled while a flight is in the air so a second tap cannot skip
            one. */}
        {cta ? (
          showRewards ? (
            <PrimaryButton label={ctaLabel} onPress={onCta} disabled={busy} />
          ) : (
            // STEP ONE'S ONLY BUTTON. The rewards exist and are already granted; this asks to be
            // shown them, it does not claim anything.
            <PrimaryButton label="See rewards" onPress={startRewards} />
          )
        ) : null}
        {footer}
      </View>

      {layer}
    </View>
  );
}

/**
 * The frame's own headline block — eyebrow, headline, subline — for the callers that want the
 * challenge screen's typography rather than their own.
 *
 * Separate from the frame so a screen can pass anything as `children`; the rank-up's hex badge and
 * "ONE RANK CLOSER" are not this shape and should not have to pretend to be.
 */
export function RevealHeadline({
  eyebrow,
  eyebrowColor,
  headline,
  subline,
}: {
  eyebrow?: string | null;
  eyebrowColor?: string;
  headline: string;
  subline?: string | null;
}) {
  return (
    <>
      {eyebrow ? (
        <Text style={[styles.eyebrow, eyebrowColor ? { color: eyebrowColor } : null]}>{eyebrow}</Text>
      ) : null}
      <Text style={styles.headline}>{headline}</Text>
      {subline ? <Text style={styles.subline}>{subline}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // Takes the ScrollView's place in the column, so the build is a transform on the same box rather
  // than a new layout step that would shift the footer.
  buildLayer: {
    flex: 1,
  },
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
    gap: 2,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    marginTop: Spacing.two,
    color: Colors.amber,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 23,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 29,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  rewards: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  // Mock 170's `.bighdr` — 23px, 3.5 tracking, white, with the warm glow behind it.
  bigHeader: {
    fontFamily: Fonts.bodyBold,
    fontSize: 23,
    letterSpacing: 3.5,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: Spacing.two,
    textShadowColor: 'rgba(255,222,150,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 20,
  },
  foot: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
});
