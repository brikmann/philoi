import { memo, useEffect, useId, useState } from "react";
import {
  Dimensions,
  PixelRatio,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";

import { Colors } from "@/constants/theme";
import { useFlameRamp } from "@/lib/economy/flame-ramp";
import type { RewardCue } from "@/lib/sound";

// THE RAY FAN AND ITS TUNING TABLE, split out of reward-reveal.tsx so the unlock reveal can draw the
// same light without the two files importing each other (the reveal host renders the unlock reveal,
// and the unlock reveal draws these rays). reward-reveal.tsx re-exports everything here, so no
// existing import moved. See reward-reveal.tsx for the reveal language this belongs to.

export type RewardRevealKind =
  | "rank_up"
  | "pass_level"
  | "pass_prestige"
  | "daily_fire"
  | "challenge_solo"
  | "challenge_team"
  | "challenge_placement"
  | "relic_unlock"
  | "item_unlock";

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
  rank_up: {
    tint: Colors.ember,
    rays: 18,
    scale: 1.15,
    intensity: 0.9,
    cue: "rankup",
    eyebrow: "RANK UP",
    priority: 100,
  },
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
  pass_level: {
    tint: Colors.amber,
    rays: 14,
    scale: 1,
    intensity: 0.72,
    cue: "victory-short",
    eyebrow: "FLAME PASS",
    priority: 60,
  },
  // PRESTIGE (0232) — a level past L100 is ~36 hours of lock-in beyond a full pass, so it is the
  // rarest thing the track pays and reads like it: the full 'victory' cut (a prestige is claimed a
  // handful of times a season, so the tail has room), the widest fan short of a rank-up, and a
  // priority just under it.
  pass_prestige: {
    tint: Colors.amber,
    rays: 18,
    scale: 1.12,
    intensity: 0.88,
    cue: "victory",
    eyebrow: "FLAME PASS PRESTIGE",
    priority: 90,
  },
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
  daily_fire: {
    tint: Colors.coral,
    rays: 12,
    scale: 0.92,
    intensity: 0.66,
    cue: "victory",
    eyebrow: "TODAY'S FIRE",
    priority: 40,
  },
  challenge_solo: {
    tint: Colors.amber,
    rays: 13,
    scale: 0.96,
    intensity: 0.7,
    cue: "victory",
    eyebrow: "CHALLENGE WON",
    priority: 50,
  },
  challenge_team: {
    tint: Colors.sky,
    rays: 15,
    scale: 1.02,
    intensity: 0.74,
    cue: "victory",
    eyebrow: "TEAM CHALLENGE",
    priority: 55,
  },
  challenge_placement: {
    tint: Colors.ember,
    rays: 16,
    scale: 1.05,
    intensity: 0.78,
    cue: "victory",
    eyebrow: "PLACEMENT",
    priority: 58,
  },
  // A DISCIPLINE RELIC (0176). Second only to a rank-up, and above the pass level, because it is the
  // rarest thing in the app that is not a rank: ten hours of Study, fifty kilometres moved, and at
  // the top of every ladder the Crown. It waits behind a rank-up and goes ahead of everything else.
  //
  // ⚠️ `cue` IS NOT WHAT PLAYS HERE. The relic screen calls useRevealSting(rarity) instead, so the
  // sound is the six-step rarity ladder (#85) rather than one fixed fanfare — a Legendary Scroll and
  // a Mythic Crown must not land on the same sting, and rarity is the app's existing language for
  // "an item was revealed". This row keeps a cue anyway so no kind can be added to the table without
  // one, and so a caller that reaches for useRevealCue gets something sane rather than undefined.
  //
  // Amber rather than the item's rarity colour: `tint` is static per kind, the hero is a relic in a
  // GOLD aura in every mock, and gold is what "relic" reads as across the Trophy Hall. The rarity
  // still shows — on the chip, the row accent and the aura behind the art.
  relic_unlock: {
    tint: Colors.amber,
    rays: 16,
    scale: 1.08,
    intensity: 0.82,
    cue: "victory",
    eyebrow: "RELIC UNLOCKED",
    priority: 70,
  },
  // THE UNIVERSAL UNLOCK (mocks 251/254) — one cosmetic, shown as itself and in context. Like the
  // relic row, `cue` and `tint` are fallbacks only: the unlock reveal plays the item's own rarity
  // sting (useRevealSting) and lights the fan in the ITEM'S hue, passed as an explicit tint. It sits
  // between the pass level and the relic so a pass claim's card clears before its item takes the floor.
  item_unlock: {
    tint: Colors.amber,
    rays: 24,
    scale: 1.05,
    intensity: 0.8,
    cue: "victory",
    eyebrow: "UNLOCKED",
    priority: 65,
  },
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
  const [screen, setScreen] = useState(() => Dimensions.get("screen"));
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ screen: next }) =>
      setScreen(next),
    );
    return () => sub.remove();
  }, []);
  return screen;
}

// ─────────────────────────── the fan ───────────────────────────

/**
 * The reveals whose hero IS a flame, and which therefore take the equipped flame's colourway.
 *
 * 🔴 WHY THIS IS A SET AND NOT "ALWAYS". Noah: the reveal rays should be the same colour as the
 * currently-equipped flame. That is right wherever the light is coming off a flame — the fan is
 * meant to read as the fire's own glow thrown across the screen, which is the same argument
 * PersonalFlame's glow already makes for `ramp.outer`.
 *
 * It is wrong everywhere else, and forcing it would be a regression. The rank-up's hero is a RANK
 * BADGE struck in the tier's metal, and Gold under a violet fan reads as a rendering fault rather
 * than as a cosmetic; the duel king is bronze for the same reason. `pass_level` stays out too — it
 * is not in the scope Noah named and its hero is not a flame.
 *
 * So: the hue follows the flame on the four flame reveals, the rank-up passes its tier's metal
 * explicitly (`tint`, below — one row cannot hold ten metals), and REVEAL_TUNING keeps everything
 * that is not colour — ray count, scale, intensity, cue, eyebrow, priority — for all of them.
 */
const FLAME_HERO_KINDS: ReadonlySet<RewardRevealKind> =
  new Set<RewardRevealKind>([
    // The daily fire and the cleared-goal reveal both pull this row, and both put a flame on screen.
    "daily_fire",
    "challenge_solo",
    "challenge_team",
    "challenge_placement",
  ]);

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
  intensity,
  tint,
}: {
  kind: RewardRevealKind;
  size: number;
  /** Absolute offsets, when the caller is anchoring the fan on something other than its centre. */
  style?: StyleProp<ViewStyle>;
  /**
   * Peak opacity, overriding the row's own.
   *
   * Mock 170 settles the reveal fan at ~.34 — "present but subtle so the rewards keep supremacy".
   * REVEAL_TUNING's per-kind values run 0.66–0.9, which were tuned when the fan was the only thing
   * on the screen; behind a list of claimable rows the same fan competes with them. Overridden at
   * the reveal frame rather than edited in the table, because the table is also read by the shared
   * reveal CARD, where the fan IS the screen and the brighter value is still right.
   */
  intensity?: number;
  /**
   * The fan's colourway, overriding the row's flat `tint`.
   *
   * Exists for the rank-up, whose hero is struck in a different metal every time it fires. The
   * row can only hold one colour, so the fan behind Titan and the fan behind Divine were the same
   * ember gold — light that demonstrably did not come off the badge it was blooming from. A
   * caller that knows the hero's colour passes it; everyone else keeps the row's.
   */
  tint?: { inner: string; outer: string } | null;
}) {
  const id = `rays-${useId()}`;
  const tuning = REVEAL_TUNING[kind];
  // THE FAN IS THE FLAME'S OWN LIGHT. `useFlameRamp` is the single place that answers "what colour
  // is my flame" — it already resolves the equipped flame cosmetic, and an equipped FLARE overrides
  // it, so the fan follows both without knowing either rule. Called unconditionally (hooks may not
  // be called behind a branch); which kinds actually use the result is decided below.
  //
  // It is a `useSyncExternalStore` read off a module-level loadout store, so it needs no provider
  // and re-renders this fan the moment the user equips something else.
  const ramp = useFlameRamp();
  const flameLit = FLAME_HERO_KINDS.has(kind);
  // outer -> core, matching the flame's own body-to-heart direction: the fan is brightest where it
  // meets the flame and cools as it travels, which is what light actually does.
  // An explicit tint wins over both: it is the caller saying "the hero is THIS colour today",
  // which is strictly better information than either the row or the equipped flame.
  const rayInner = tint?.inner ?? (flameLit ? ramp.core : tuning.tint);
  const rayOuter = tint?.outer ?? (flameLit ? ramp.outer : tuning.tint);
  const reducedMotion = useReducedMotion();
  const bloom = useSharedValue(0);
  const spin = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    bloom.value = withTiming(1, {
      duration: reducedMotion ? 0 : BLOOM_MS,
      easing: Easing.out(Easing.cubic),
    });
    if (reducedMotion) return;
    spin.value = withRepeat(
      withTiming(1, { duration: SPIN_MS, easing: Easing.linear }),
      -1,
      false,
    );
    // Reversing repeat, so the fan swells and settles rather than snapping back at the seam.
    breathe.value = withRepeat(
      withTiming(1, {
        duration: BREATHE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    );
  }, [bloom, spin, breathe, reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity:
      bloom.value *
      (intensity ?? tuning.intensity) *
      (0.8 + breathe.value * 0.2),
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
      style={[
        styles.rays,
        {
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
        positionStyle,
      ]}
    >
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
          <RadialGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            cx={r}
            cy={r}
            r={r}
          >
            <Stop offset="0" stopColor={rayInner} stopOpacity={0.85} />
            <Stop offset="0.55" stopColor={rayOuter} stopOpacity={0.45} />
            <Stop offset="1" stopColor={rayOuter} stopOpacity={0} />
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
  intensity,
  tint,
}: {
  kind: RewardRevealKind;
  /** The hero the light comes off, in the root's coordinate space. Null centres the fan. */
  anchor?: { x: number; y: number } | null;
  /** The root's origin in window coordinates. Null falls back to filling the parent. */
  rootOffset?: { x: number; y: number } | null;
  /** Peak opacity override — see RewardRays. The reveal frame passes mock 170's .34. */
  intensity?: number;
  /** Colourway override — see RewardRays. The rank-up passes the new tier's metal. */
  tint?: { inner: string; outer: string } | null;
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
  const cx =
    anchor && rootOffset
      ? anchor.x + rootOffset.x + SCREEN_BLEED_PAD
      : width / 2;
  const cy =
    anchor && rootOffset
      ? anchor.y + rootOffset.y + SCREEN_BLEED_PAD
      : height / 2;
  // Measured against the padded box, so the corners that have to be covered are the layer's, which
  // are already outside the phone.
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy),
  );
  const size =
    2 * reach * CORNER_REACH_FACTOR * Math.max(1, REVEAL_TUNING[kind].scale);

  return (
    <View
      pointerEvents="none"
      style={[styles.raysBackdrop, bleed ?? styles.raysBackdropFill]}
    >
      <RewardRays
        kind={kind}
        size={size}
        intensity={intensity}
        tint={tint}
        // Absolute offsets override the backdrop's centring; without them the fan centres itself,
        // which is what the card reveal wants.
        style={bleed ? { left: cx - size / 2, top: cy - size / 2 } : null}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  rays: {
    position: "absolute",
  },
  // No edges here on purpose — the two branches supply their own complete rect, because a bleed
  // rect layered over a four-edge fill loses its width and height to the fill's right/bottom.
  // Clipped, so the oversized SVG never asks the compositor for pixels beyond the layer.
  raysBackdrop: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    zIndex: 0,
  },
  /** The pre-measurement frame, and the shared card's scrim, which is already the whole screen. */
  raysBackdropFill: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
