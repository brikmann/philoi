import { memo, useEffect, useId, useState } from 'react';
import {
  Dimensions,
  PixelRatio,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound, type RewardCue } from '@/lib/sound';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE RAYS — one reveal language for every reward the app pays out.
//
// Six things can pay you: a rank-up, a pass level, the daily fire, and the three challenge
// settlements. Before this, each one had drawn its own rays or none at all — `rank-up-celebration`,
// `challenge-reward-screen`, `box-crack` and `forge-strike` each carry their own fan of wedges, and
// pass-level claims paid silently with no reveal whatsoever. Four implementations of one idea drift
// by definition; this is the one they can share.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. Every figure on screen is read from a result
// the server already wrote — the unseen-rewards RPC, the claim's return, the rank-up event. A
// reveal that awarded on presentation would pay twice for one event, which is the exact bug the
// challenge settlement watcher's header warns about.
//
// WHAT IS DELIBERATELY NOT HERE: the rank-up celebration. It stays its own 1,500-line component
// with tier ladders, anthems and per-tier signatures, because the brief is explicit that rank-up
// stays the biggest and reducing it to this primitive would be a downgrade, not a unification. It
// shares the QUEUE below instead, which is the part that actually needed to be common.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type RewardRevealKind =
  | 'rank_up'
  | 'pass_level'
  | 'daily_fire'
  | 'challenge_solo'
  | 'challenge_team'
  | 'challenge_placement';

/** One "what you got" line. `icon` picks the glyph; `label` is already formatted for display. */
export type RewardLine = {
  kind: 'embers' | 'box' | 'xp' | 'cosmetic' | 'rank';
  label: string;
};

export type RewardRevealEvent = {
  kind: RewardRevealKind;
  /** The headline — "Level 12 claimed", "Today's fire is lit". */
  title: string;
  /** One quiet line under it. Optional. */
  subtitle?: string;
  /** What the server actually paid. Empty renders the reveal with no reward block. */
  rewards: RewardLine[];
};

// ─────────────────────────── THE TUNING TABLE ───────────────────────────
//
// Everything Noah will want to move on device is one row of this. Per event: how hard the rays
// read, what colour they are, how big the whole thing sits, and which cue fires.
//
// `priority` is the queue's ordering key, not a visual property — see enqueue(). Higher wins, and
// rank-up is highest so a session that ends as a rank-up AND a daily fire plays the small one first
// and the crescendo last.
export const REVEAL_TUNING: Record<
  RewardRevealKind,
  {
    tint: string;
    /** Wedges in the fan. More reads as brighter and busier at the same opacity. */
    rays: number;
    /** Overall size multiplier on the fan. Rank-up is the biggest by design. */
    scale: number;
    /** Peak opacity of the fan. */
    intensity: number;
    cue: RewardCue;
    /** The small caps label above the title. */
    eyebrow: string;
    priority: number;
  }
> = {
  // Present for completeness and for the queue's ordering. The rank-up celebration draws itself;
  // this row's visual fields are unused by it today, and are here so that if it is ever folded in
  // it lands in the same table as everything else rather than in a second one.
  rank_up: { tint: Colors.ember, rays: 18, scale: 1.15, intensity: 0.9, cue: 'rankup', eyebrow: 'RANK UP', priority: 100 },
  // The four win rows now carry the real fanfare (#185) instead of 'settle'/'spark' — the quiet
  // Post-confirmation tick and the per-ember landing blip, which were only ever standing in
  // because no bespoke win cue existed. Winning a duel sounded quieter than opening a common box.
  //
  // WHICH CUT, AND WHY IT IS A FIELD: 'victory-short' (2.53s) on the frequent row, 'victory'
  // (3.84s) on the rare ones. A pass level gets claimed many times a season and a four-second
  // tail would still be ringing after the card is gone; a settled challenge happens once and
  // should get the whole thing. Both cuts are loaded, so A/B-ing on device is editing the cue
  // here — no asset swap, no rebuild.
  // ⚠️ STILL ON THE CHOPPED CUT, deliberately left for Noah to call. The measurement above applies
  // here too — a claimed pass level ends mid-phrase at full volume, exactly as the daily fire did —
  // but 'victory-short' on the frequent row is a stated decision, not an oversight, and the fix
  // that keeps it is re-trimming the ASSET (a fade to silence over its last ~400ms) rather than
  // swapping the row. Changing this line is the other option and takes one word.
  pass_level: { tint: Colors.amber, rays: 14, scale: 1, intensity: 0.72, cue: 'victory-short', eyebrow: 'FLAME PASS', priority: 60 },
  // ON THE UNIVERSAL VICTORY, not 'ignite'. This row used to argue that the daily fire is the day's
  // small beat rather than a win, and that was a fair reading of the ladder — but it left the one
  // reveal a user sees EVERY day as the only one with no fanfare, so the app's most frequent payout
  // was also its quietest. One victory identity across daily fire, challenges and pass levels; this
  // is the row that was outside it.
  //
  // 🐛 AND THE FULL CUT, NOT THE SHORT ONE. This shipped as 'victory-short' on the reasoning that a
  // daily cue cannot carry a four-second tail. Noah then heard it "cut off ~halfway; it needs to
  // stretch fully", and nothing in the playback path was stopping it — the players are per-cue,
  // nothing calls stopRewardSound on a victory cue, and the audio session is only reconfigured by
  // the duck-to-music write. IT IS THE ASSET. Measured:
  //
  //     victory-fanfare.mp3        3.81s — last 0.3s: mean −91.0 dB  (digital silence; it decays)
  //     victory-fanfare-short.mp3  2.50s — last 0.3s: mean −17.0 dB, peak −6.1 dB
  //
  // The whole-file mean of the short cut is −14.8 dB, so its final 300ms are running at very close
  // to full programme level: the file does not end, it STOPS, mid-phrase, at full volume. That is
  // not a short cue, it is a truncated one, and no amount of playback plumbing can make it resolve.
  //
  // 'victory' is the only cut that actually finishes. Its length is the price of ringing out.
  daily_fire: { tint: Colors.coral, rays: 12, scale: 0.92, intensity: 0.66, cue: 'victory', eyebrow: "TODAY'S FIRE", priority: 40 },
  challenge_solo: { tint: Colors.amber, rays: 13, scale: 0.96, intensity: 0.7, cue: 'victory', eyebrow: 'CHALLENGE WON', priority: 50 },
  challenge_team: { tint: Colors.sky, rays: 15, scale: 1.02, intensity: 0.74, cue: 'victory', eyebrow: 'TEAM CHALLENGE', priority: 55 },
  challenge_placement: { tint: Colors.ember, rays: 16, scale: 1.05, intensity: 0.78, cue: 'victory', eyebrow: 'PLACEMENT', priority: 58 },
};

/** How long the rays take to bloom in, and how long one full rotation takes. */
const BLOOM_MS = 620;
// 22s read as STOPPED on device (Noah: "the rays don't fire"). The fan is rotationally symmetric —
// twelve identical wedges map onto themselves every 30°, so the only thing an eye can catch is the
// sweep, and at 16°/s across a 260pt fan there was nothing to catch. Faster, and paired with the
// breath below, because rotation alone cannot carry a symmetric shape.
const SPIN_MS = 16000;
/** One in-out cycle of the slow swell that keeps the fan alive between rotations. */
const BREATHE_MS = 2600;

/**
 * How far outside the device screen the ray layer itself is drawn, on every side.
 *
 * 🐛 THE RAYS REACHED THE BOTTOM AND NOT THE TOP. Two things conspired, and the padding fixes the
 * second one for good:
 *
 *   1. `left`/`top` alone do not size an absolute box in Yoga when the base style also sets
 *      `right`/`bottom` — those win and `width`/`height` are ignored. So the bleed was pinning the
 *      layer's far edges to the PARENT's edges, which are the inset ones. That is fixed below by
 *      giving the measured branch its own complete rect instead of layering it over the fallback.
 *
 *   2. `measureInWindow` reports window coordinates, and a window is not always the screen. Where
 *      the app is not drawing edge-to-edge, the window origin sits BELOW the status bar, so
 *      `-rootOffset.y` lands the layer at the window top with a status-bar-high dark strip above
 *      it — while the bottom, measured against a taller `screen.height`, overshot and looked
 *      right. Exactly the asymmetry Noah saw.
 *
 * Rather than chase the difference between window and screen on two platforms and three Android
 * configurations, the layer is simply drawn bigger than either. It is clipped and it paints
 * nothing but rays, so overshooting costs a few offscreen pixels and guarantees no gap.
 */
const SCREEN_BLEED_PAD = 200;

/**
 * How far past the farthest corner the fan reaches, as a multiple of that distance.
 *
 * NOT a hair past it. The wedges fade to fully transparent at their tips, so a fan that merely
 * TOUCHES the corners has nothing left by the time it gets there — which is the same dark corner
 * Noah photographed, arrived at a different way. At 1.65 the corner sits around 60% of the way out,
 * where the gradient still carries about a third of its opacity, so the light reaches the edge of
 * the phone with colour in it and finishes fading off-screen.
 */
const CORNER_REACH_FACTOR = 1.65;

/**
 * The DEVICE screen, not the window.
 *
 * `useWindowDimensions` is the app's drawable area, which on Android excludes the system bars
 * unless the app is edge-to-edge — so sizing off it is how a fan ends exactly at the status bar.
 * The 'change' event carries both, and screen is the one that means "the whole phone".
 */
function useDeviceScreen(): { width: number; height: number } {
  const [screen, setScreen] = useState(() => Dimensions.get('screen'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ screen: next }) => setScreen(next));
    return () => sub.remove();
  }, []);
  return screen;
}

/**
 * Play a reveal's tuned cue once, on mount, gated on the SFX preference.
 *
 * Extracted because the cue table only ever reached the SHARED CARD. The two bespoke reveals —
 * the goal-complete screen and the challenge settlement screen — draw their own UI and so never
 * ran this line: the goal screen played `RewardBurst`'s quiet 'settle' tick and nothing else, and
 * the challenge screen, the loudest payout in the app, was silent. `victory` has been sitting in
 * three rows of REVEAL_TUNING with nothing reading them.
 *
 * Fire-once per mount, which is why `kind` is not a dep: both presenters key their screen on the
 * settlement so a second queued reveal is a fresh mount, and re-firing a fanfare because a parent
 * re-rendered with a different kind would double the sound rather than replace it.
 *
 * NOT the rank-up. It keeps its own tier ladder and its anthem — see the header.
 */
export function useRevealCue(kind: RewardRevealKind): void {
  useEffect(() => {
    if (getRewardPreferencesSync().reward_sfx_enabled) playRewardSound(REVEAL_TUNING[kind].cue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fanfare per mount
  }, []);
}

// ─────────────────────────── the fan ───────────────────────────

/**
 * The rays themselves — a fan of soft wedges behind the card, blooming out once and then turning
 * slowly forever.
 *
 * Wedges rather than lines, and each one fades to nothing at its outer end, because a hard-ended
 * spoke reads as a diagram. The slow rotation is what stops the fan reading as a static starburst
 * sticker; it is deliberately far slower than anything else on screen so it never competes with
 * the numbers it is behind.
 */
/**
 * MEMOISED, and it matters more than it looks. This draws `tuning.rays` <Path> nodes into an SVG
 * sized to the whole screen, and it is mounted inside a reveal whose balance counter re-renders it
 * while embers are in the air. Without this, every counter tick rebuilt sixteen paths and handed
 * react-native-svg a fresh tree to diff — which is what made the claim animation stutter. Nothing
 * here depends on anything but its three props.
 */
export const RewardRays = memo(function RewardRays({
  kind,
  size,
  style: positionStyle,
}: {
  kind: RewardRevealKind;
  size: number;
  /** Absolute offsets, when the caller is anchoring the fan on something other than its centre. */
  style?: StyleProp<ViewStyle>;
}) {
  const id = `rays-${useId()}`;
  const tuning = REVEAL_TUNING[kind];
  const reducedMotion = useReducedMotion();
  const bloom = useSharedValue(0);
  const spin = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    bloom.value = withTiming(1, { duration: reducedMotion ? 0 : BLOOM_MS, easing: Easing.out(Easing.cubic) });
    if (reducedMotion) return;
    spin.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
    // Reversing repeat, so the fan swells and settles rather than snapping back at the seam.
    breathe.value = withRepeat(
      withTiming(1, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [bloom, spin, breathe, reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: bloom.value * tuning.intensity * (0.8 + breathe.value * 0.2),
    transform: [
      { scale: (0.72 + bloom.value * 0.28) * (1 + breathe.value * 0.025) },
      { rotate: `${spin.value * 360}deg` },
    ],
  }));

  // 🔴 CRASH GUARD (Sentry: "Canvas: trying to draw too large (…)bitmap" @ SvgView.onDraw).
  // react-native-svg rasterises this whole <Svg> to ONE Android bitmap sized `drawSize × density`.
  // The full-screen callers pass ~2× the screen diagonal (~2400–2900dp); at density 2.75 that's a
  // ~6700px² = 179MB bitmap, past Android's ~100MB RecordingCanvas cap AND the GPU's max texture
  // dimension — so the reveal crashed the instant it mounted. Clamp the RASTER size so the backing
  // bitmap can never exceed ~36MB / 3000px-per-side on any device; the fan still radiates from the
  // centre and covers the screen (a 3000px raster is >screen-diagonal at every real density). The
  // layer box keeps the requested `size` so positioning/anchoring is unchanged.
  const MAX_RAY_PX = 3000;
  const drawSize = Math.min(size, MAX_RAY_PX / PixelRatio.get());
  const r = drawSize / 2;
  const half = Math.PI / tuning.rays / 2.6;

  return (
    <Animated.View
      pointerEvents="none"
      // Box keeps the caller's `size` so the host's left/top anchoring is unchanged; the clamped
      // <Svg> is centred inside it, so the fan stays centred on the same point — only the RASTER
      // is capped.
      style={[styles.rays, { width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style, positionStyle]}>
      <Svg width={drawSize} height={drawSize} pointerEvents="none">
        <Defs>
          {/* RADIAL, IN USER SPACE — not the linear gradient this started as.
              A LinearGradient defaults to objectBoundingBox units, so it was measured against each
              WEDGE's own box: the wedge pointing down faded outward correctly, the one pointing up
              faded INWARD, and the horizontal ones faded across their own thickness. At 260pt that
              read as texture and nobody noticed. Full-screen it would read as half the spokes being
              brightest at the screen edge, which is the opposite of light coming off the hero. One
              gradient over the whole fan makes every wedge fade the same way: bright at the centre,
              gone before the tip. */}
          <RadialGradient id={id} gradientUnits="userSpaceOnUse" cx={r} cy={r} r={r}>
            <Stop offset="0" stopColor={tuning.tint} stopOpacity={0.85} />
            <Stop offset="1" stopColor={tuning.tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {Array.from({ length: tuning.rays }, (_, i) => {
          const a = (i / tuning.rays) * Math.PI * 2;
          // A thin triangle from the centre out — its far edge is where the gradient has already
          // reached zero, so there is no visible end to the spoke.
          const x1 = r + Math.cos(a - half) * r;
          const y1 = r + Math.sin(a - half) * r;
          const x2 = r + Math.cos(a + half) * r;
          const y2 = r + Math.sin(a + half) * r;
          return (
            <Path
              key={i}
              d={`M ${r} ${r} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
              fill={`url(#${id})`}
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
});

/**
 * The fan as a TRUE full-bleed backdrop — corner to corner, under the status bar, under the home
 * indicator, behind the header and the footer.
 *
 * WHY THIS IS NOT JUST `StyleSheet.absoluteFill`. Both reveals are presented several layers inside
 * a `SafeAreaView` — the goal reveal sits in the Challenges tab's `Screen` AND its own, the
 * challenge reveal in the watcher's — and an absolutely-filled child fills its PARENT, which is the
 * inset box. That is the dark band under the status bar and behind the Claim button in Noah's
 * screenshot: the fan was full-screen-sized and then clipped to the safe area by its ancestors.
 *
 * `rootOffset` is where the reveal's own root sits in the window (`measureInWindow` on the root,
 * which useRewardClaim already runs for the flights). Offsetting the layer by minus that, at the
 * device screen's size, lands it exactly over the whole phone no matter how many inset wrappers it
 * is nested in — and it needs no cooperation from the three call sites, which is the point. Nothing
 * in that chain sets `overflow: 'hidden'`, so the layer is free to paint outside its parent.
 *
 * SIZE IS DERIVED, NOT GUESSED. A fixed multiple of the long edge leaves dark triangles whenever
 * the anchor is off-centre, which is exactly the "converges below the flame, dark top corners"
 * report: the fan was sized for a centred origin and then anchored on a hero sitting high. This
 * measures the distance from the actual origin to the FARTHEST corner and makes the radius that.
 * Per-kind `scale` can only ever enlarge it, so rank-up stays the biggest fan in the app and no
 * row can shrink one back into a halo.
 */
export const FullscreenRays = memo(function FullscreenRays({
  kind,
  anchor,
  rootOffset,
}: {
  kind: RewardRevealKind;
  /** The hero the light comes off, in the root's coordinate space. Null centres the fan. */
  anchor?: { x: number; y: number } | null;
  /** The root's origin in window coordinates. Null falls back to filling the parent. */
  rootOffset?: { x: number; y: number } | null;
}) {
  const screen = useDeviceScreen();

  // Before the measurement lands (one frame) this is a plain absolute fill of the parent, which is
  // the old inset behaviour for that frame and correct for the shared card, whose scrim IS the
  // whole screen.
  //
  // A COMPLETE rect, not an override on top of the fallback: `styles.raysBackdrop` pins all four
  // edges, and left+right together make Yoga ignore `width` (same for top+bottom and `height`), so
  // layering the two silently kept the parent's inset far edges. See SCREEN_BLEED_PAD.
  const width = screen.width + SCREEN_BLEED_PAD * 2;
  const height = screen.height + SCREEN_BLEED_PAD * 2;
  const bleed = rootOffset
    ? {
        left: -rootOffset.x - SCREEN_BLEED_PAD,
        top: -rootOffset.y - SCREEN_BLEED_PAD,
        width,
        height,
      }
    : null;

  // The fan's origin inside the layer — the hero, shifted by the same padding the layer was, so
  // the light still comes off the flame and not off a point 200pt above it.
  const cx = anchor && rootOffset ? anchor.x + rootOffset.x + SCREEN_BLEED_PAD : width / 2;
  const cy = anchor && rootOffset ? anchor.y + rootOffset.y + SCREEN_BLEED_PAD : height / 2;
  // Measured against the padded box, so the corners that have to be covered are the layer's, which
  // are already outside the phone.
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy)
  );
  const size = 2 * reach * CORNER_REACH_FACTOR * Math.max(1, REVEAL_TUNING[kind].scale);

  return (
    <View pointerEvents="none" style={[styles.raysBackdrop, bleed ?? styles.raysBackdropFill]}>
      <RewardRays
        kind={kind}
        size={size}
        // Absolute offsets override the backdrop's centring; without them the fan centres itself,
        // which is what the card reveal wants.
        style={bleed ? { left: cx - size / 2, top: cy - size / 2 } : null}
      />
    </View>
  );
});

const REWARD_GLYPH: Record<RewardLine['kind'], string> = {
  embers: '🔥',
  box: '🎁',
  xp: '✦',
  cosmetic: '◆',
  rank: '⚔',
};

// ─────────────────────────── the card ───────────────────────────

function RevealCard({ event, onDismiss }: { event: RewardRevealEvent; onDismiss: () => void }) {
  const tuning = REVEAL_TUNING[event.kind];
  const reducedMotion = useReducedMotion();
  const enter = useSharedValue(0);

  // Gated on the same pref the reward burst reads — a reveal is exactly as opt-out-able as every
  // other celebration in the app. Shared with the two bespoke reveals, which is the point of it.
  useRevealCue(event.kind);

  useEffect(() => {
    enter.value = withDelay(
      60,
      withSequence(
        withTiming(1.04, { duration: reducedMotion ? 0 : 300, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(1, { duration: reducedMotion ? 0 : 160 })
      )
    );
  }, [enter, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.9 + enter.value * 0.1 }],
  }));

  return (
    <Pressable style={styles.scrim} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss reward">
      <FullscreenRays kind={event.kind} />
      <Animated.View style={[styles.card, cardStyle]}>
        <Text style={[styles.eyebrow, { color: tuning.tint }]}>{tuning.eyebrow}</Text>
        <Text style={styles.title}>{event.title}</Text>
        {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}

        {event.rewards.length > 0 && (
          <View style={styles.rewards}>
            {event.rewards.map((line, i) => (
              <View key={`${line.kind}-${i}`} style={styles.rewardRow}>
                <Text style={styles.rewardGlyph}>{REWARD_GLYPH[line.kind]}</Text>
                <Text style={styles.rewardLabel}>{line.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.dismiss}>Tap to continue</Text>
      </Animated.View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLOOR — one celebration on screen at a time, across presenters that render nothing alike.
//
// The queue below owns the shared card, but two of the six rewards do not use it: the rank-up
// celebration is 1,500 lines of tier ladders and anthems, and the challenge reveal is its own
// full-screen result screen. Both are right to stay bespoke, and both used to present themselves
// the instant they had something — so a lock-in that ended as a rank-up AND settled a challenge
// stacked two modals, and adding the pass-level card would have made three.
//
// So the arbiter does not own RENDERING, it owns PERMISSION. Every presenter asks for the floor
// and draws only while it holds it. That is what lets a component keep its own UI, its own state
// and its own share sheet while still taking its turn.
//
// Ordering is the crescendo again: the LOWEST priority holds the floor first, so the small payouts
// clear and the rank-up is what you are left looking at.
//
// Listeners are notified on a microtask, not synchronously. A synchronous notify inside
// requestFloor would land the resulting setState in the caller's effect body, which is the
// cascading-render lint error this repo already carries in two dozen files.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

type FloorWaiter = { id: string; priority: number };

let waiters: FloorWaiter[] = [];
const floorListeners = new Set<() => void>();

function notifyFloor(): void {
  queueMicrotask(() => {
    for (const listener of floorListeners) listener();
  });
}

function floorHolder(): string | null {
  if (waiters.length === 0) return null;
  return [...waiters].sort((a, b) => a.priority - b.priority)[0].id;
}

/**
 * Ask for the floor, or update the priority of a request already in flight.
 *
 * The update matters: RewardRevealHost's kind changes as its own queue advances, so the same
 * waiter can legitimately want a different priority without releasing and re-requesting (which
 * would let another presenter cut in between the two calls).
 */
function requestFloor(id: string, priority: number): void {
  const existing = waiters.find((w) => w.id === id);
  if (existing) {
    if (existing.priority === priority) return;
    waiters = waiters.map((w) => (w.id === id ? { ...w, priority } : w));
  } else {
    waiters = [...waiters, { id, priority }];
  }
  notifyFloor();
}

function releaseFloor(id: string): void {
  if (!waiters.some((w) => w.id === id)) return;
  waiters = waiters.filter((w) => w.id !== id);
  notifyFloor();
}

/**
 * Hold the floor while `wants` is true. Returns whether this caller may draw right now.
 *
 * A presenter with something to show but no floor renders nothing and keeps waiting — it does not
 * lose the event, because `wants` stays true until it has actually been shown and dismissed.
 */
export function useRevealFloor(kind: RewardRevealKind, wants: boolean): boolean {
  const id = useId();
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const sync = () => setGranted(floorHolder() === id);
    floorListeners.add(sync);
    if (wants) requestFloor(id, REVEAL_TUNING[kind].priority);
    else releaseFloor(id);
    return () => {
      // Unsubscribe BEFORE releasing, so this component's own listener cannot be called back for a
      // notify it triggered on the way out.
      floorListeners.delete(sync);
      releaseFloor(id);
    };
  }, [id, kind, wants]);

  return granted;
}

// ─────────────────────────── the queue ───────────────────────────
//
// One reveal at a time, app-wide.
//
// Before this there were two independent presenters — RankUpWatcher and ChallengeSettlementWatcher
// — each with its own `pending` slot and no knowledge of the other. A lock-in that ended as a
// rank-up AND settled a challenge showed both at once, stacked. Anything new would have been a
// third.

/** Queue entries carry an id so the card can be keyed without mutating anything during render. */
type QueuedReveal = RewardRevealEvent & { id: number };

let enqueueImpl: ((event: RewardRevealEvent) => void) | null = null;
let nextRevealId = 0;

/**
 * Queue a reward reveal from anywhere. No-ops if the host is not mounted (before sign-in), which
 * matches how showRankUp() behaves and means a caller never has to check.
 */
export function showRewardReveal(event: RewardRevealEvent): void {
  enqueueImpl?.(event);
}

/**
 * Mounted once, in the root layout, beside the other watchers.
 *
 * Ordering is by REVEAL_TUNING.priority and it is a CRESCENDO, not arrival order: the small
 * payouts play first and the rank-up last, because ending on the biggest is the whole reason to
 * sequence them rather than show them at once. Ties keep arrival order, so two challenges settle in
 * the order the server returned them.
 */
export function RewardRevealHost() {
  const [queue, setQueue] = useState<QueuedReveal[]>([]);

  useEffect(() => {
    enqueueImpl = (event) => {
      // The id is assigned HERE and used as the card's key. RankUpWatcher solves the same problem
      // with a token bumped at presentation time; doing that here would mean mutating a ref during
      // render, which React Compiler's purity rule rejects — and rightly, since a memo is free to
      // re-run. Without a changing key React reuses the card instance, so the second reveal in a
      // queue plays no sound and never replays its entrance.
      nextRevealId += 1;
      const queued: QueuedReveal = { ...event, id: nextRevealId };
      setQueue((current) => {
        const next = [...current, queued];
        // Stable sort by priority ascending — smallest first, crescendo last.
        return next
          .map((e, i) => ({ e, i }))
          .sort((a, b) => REVEAL_TUNING[a.e.kind].priority - REVEAL_TUNING[b.e.kind].priority || a.i - b.i)
          .map(({ e }) => e);
      });
    };
    return () => {
      enqueueImpl = null;
    };
  }, []);

  const current = queue[0] ?? null;
  // The host is just another presenter — it waits its turn behind a rank-up like everyone else.
  const hasFloor = useRevealFloor(current?.kind ?? 'daily_fire', current !== null);

  return (
    <Modal
      visible={current !== null && hasFloor}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setQueue((q) => q.slice(1))}>
      {current && hasFloor ? (
        <RevealCard key={current.id} event={current} onDismiss={() => setQueue((q) => q.slice(1))} />
      ) : (
        <View />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,16,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  rays: {
    position: 'absolute',
  },
  // No edges here on purpose — the two branches supply their own complete rect, because a bleed
  // rect layered over a four-edge fill loses its width and height to the fill's right/bottom.
  // Clipped, so the oversized SVG never asks the compositor for pixels beyond the layer.
  raysBackdrop: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 0,
  },
  /** The pre-measurement frame, and the shared card's scrim, which is already the whole screen. */
  raysBackdropFill: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    minWidth: 260,
    gap: Spacing.two,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 21,
    color: Colors.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
  },
  rewards: {
    marginTop: Spacing.two,
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.selectedBg,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rewardGlyph: {
    fontSize: 16,
  },
  rewardLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    flex: 1,
  },
  dismiss: {
    marginTop: Spacing.three,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
});
