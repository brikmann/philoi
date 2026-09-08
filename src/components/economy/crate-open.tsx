import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Rect, Stop } from 'react-native-svg';

import { BoxArt } from '@/components/economy/box-art';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { BOXES, boxAccent, type BoxKey } from '@/lib/economy/boxes';
import { RARITY_COLOR, rarityGlow, type Rarity } from '@/lib/economy/rarity';
import { fireBoxOpen, fireReveal } from '@/lib/reward-feedback';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE CRATE OPEN — design-mocks/186-unbox-full-flow.html, CODE_PROMPT_unboxing_redesign.md.
//
// ONE COMPONENT, EVERY ENTRY POINT. The shop/inventory open, the rank-up box, a challenge or
// campfire reward crate and the Forge output all play THIS. The old flow had `BoxCrack` for the
// single open and `MultiDeal` for a batch, and the redesign is not a third: a ×10 is this same
// burst played ONCE, with the flip-reveal taking over at the frame the lid comes off.
//
// ─────────────────────────── THE ONE RULE THAT SHAPES ALL OF IT ───────────────────────────
//
// 🔴 THE BUILDUP BELONGS TO THE BOX. THE BURST BELONGS TO THE ITEM.
//
// This is task #84 and it is the difference between a reveal and a spoiler. Everything before the
// lid comes off — the crate art, the trim, the seam of light, how LONG the anticipation runs — is
// keyed to the BOX being opened, which the user already chose and already knows. Everything from
// the flash onwards — the pillar, the rays, the particles, the aura the item lands in, the sting —
// is keyed to the ITEM's rarity, which is the surprise.
//
// The previous BoxCrack got half of this right and paid for the other half. It carried a note from
// PUNCHLIST_14 §1 saying it "used to take a rarity prop and flash the tier colour through the rays,
// which spoiled the pull", and the fix at the time was to make the rays a fixed ember gold for
// every box and every pull. That removed the spoiler by removing the payoff too: a Mythic burst
// looked exactly like a Common one. Splitting the timeline at the lid restores the payoff without
// restoring the leak — nothing rarity-coloured is on screen until the moment the item is revealed,
// and at that moment it SHOULD be.
//
// So `itemRarity` is a prop here, and it is used strictly after `BURST_AT`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * How long the crate rattles before it gives, per BOX rarity.
 *
 * Keyed to the box, never to the pull — see the header. A Promethean Vault makes you wait because
 * it is a Vault, not because of what is in it; if this scaled with the item, the wait itself would
 * announce the Mythic before the lid moved, which is precisely the tell #84 exists to remove.
 */
const BUILDUP_MS: Record<Rarity, number> = {
  common: 520,
  uncommon: 640,
  rare: 800,
  epic: 1000,
  legendary: 1300,
  mythic: 1600,
};

/** The burst's own beats, from mock 186's keyframes. */
const FLASH_MS = 520;
const LID_MS = 640;
const BODY_FADE_MS = 560;
const RAYS_MS = 600;
const PARTICLE_MS = 800;
/** Lid-off → the reveal takes over. Mock 186 hands off to the shards at +780ms. */
const HANDOFF_MS = 780;

/** Reduced motion: a single cross-fade, no shake, no wait, no particles. */
const REDUCED_MS = 240;

/** How many sparks fly, by the ITEM's rarity — a Common pop vs a screen-filling Mythic. */
const PARTICLE_COUNT: Record<Rarity, number> = {
  common: 10,
  uncommon: 16,
  rare: 24,
  epic: 34,
  legendary: 44,
  mythic: 56,
};

/** Epic and above kick the screen. Below that a shake would be noise on a routine pull. */
const SHAKES: ReadonlySet<Rarity> = new Set<Rarity>(['epic', 'legendary', 'mythic']);

type Props = {
  /** Which crate is being opened — drives the art, the trim and the buildup length. */
  boxKey: BoxKey;
  /**
   * The rarity of what is INSIDE. Drives everything from the flash onwards, and nothing before it.
   *
   * Already decided server-side before this mounts: `open_loot_box` rolled, granted and spent the
   * box inside one transaction. Nothing here can change it — this is the flourish over a settled
   * outcome, which is also why a crash mid-animation cannot cost the pull.
   */
  itemRarity: Rarity;
  reduceMotion: boolean;
  /**
   * The lid-off frame. Where a batch open swaps to the shards, and where the caller may start
   * drawing the item — the burst persists behind it as the backdrop (mock 186).
   */
  onBurst?: () => void;
  /** The whole sequence is finished. */
  onDone: () => void;
  /**
   * Wait for a tap instead of opening on mount.
   *
   * Off by default because most entry points arrive already committed — you pressed Open on the
   * reward row, or bought the crate. The shop's own crate is where the tap is worth having.
   */
  tapToOpen?: boolean;
  /** "Opening ×10 · The Furnace". Hidden the moment the crate starts to give. */
  label?: string;
  size?: number;
};

export function CrateOpen({
  boxKey,
  itemRarity,
  reduceMotion,
  onBurst,
  onDone,
  tapToOpen = false,
  label,
  size = 150,
}: Props) {
  const { width, height } = useWindowDimensions();
  const accent = boxAccent(boxKey);
  const itemTint = RARITY_COLOR[itemRarity];
  const buildupMs = BUILDUP_MS[BOXES[boxKey].rarity];

  // One driver per visual channel rather than one timeline, so the reduced-motion path can simply
  // not touch most of them instead of having to unwind a sequence.
  const shake = useSharedValue(0);
  const seam = useSharedValue(0);
  const flash = useSharedValue(0);
  const core = useSharedValue(0);
  const lid = useSharedValue(0);
  const body = useSharedValue(1);
  const rays = useSharedValue(0);
  const spark = useSharedValue(0);
  const kick = useSharedValue(0);
  const hint = useSharedValue(1);

  // Fire-once guards. `onDone` arriving twice would advance a batch open two screens, and the
  // sting is the loudest thing in the app to double up.
  const startedRef = useRef(false);
  const stungRef = useRef(false);

  const burst = useCallback(() => {
    // 🔴 THE STING LANDS ON THE LID-OFF FRAME, not at the start and not at the end. It is the
    // rarity ladder (#85) — reveal-common through reveal-mythic — so a Mythic sounds like one, and
    // fireReveal carries the per-tier haptic with it. Respects the reward-SFX setting internally.
    if (!stungRef.current) {
      stungRef.current = true;
      fireReveal(itemRarity);
    }
    onBurst?.();
  }, [itemRarity, onBurst]);

  useEffect(() => {
    if (startedRef.current || tapToOpen) return;
    startedRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timeline per mount, by design
  }, []);

  function run() {
    if (reduceMotion) {
      // 🔴 STILL AUDIBLE, STILL A CROSS-FADE. Reduce-motion is a vestibular setting, not a mute:
      // the crate fades, the item's aura fades up, and the rarity sting still fires — the same
      // trade the old BoxCrack made and the same one the other reveals make.
      hint.value = withTiming(0, { duration: 120 });
      body.value = withTiming(0, { duration: REDUCED_MS });
      rays.value = withTiming(1, { duration: REDUCED_MS }, (finished) => {
        if (finished) {
          runOnJS(burst)();
          runOnJS(onDone)();
        }
      });
      return;
    }

    fireBoxOpen();
    hint.value = withTiming(0, { duration: 160 });

    // ── Buildup: rattle, and a seam of the BOX's own light growing brighter ──
    // 90ms per shake cycle, repeated to fill the box's buildup. Written as a repeat rather than a
    // long sequence so the count follows the duration automatically — a Vault gets ~17 cycles and
    // Kindling ~6 without a second table to keep in step with BUILDUP_MS.
    shake.value = withRepeat(
      withSequence(
        withTiming(-1, { duration: 45, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 45, easing: Easing.inOut(Easing.quad) })
      ),
      Math.max(2, Math.round(buildupMs / 90)),
      true
    );
    seam.value = withTiming(1, { duration: buildupMs, easing: Easing.in(Easing.quad) });

    // ── Burst, at the end of the buildup ──
    flash.value = withDelay(
      buildupMs,
      withSequence(
        withTiming(1, { duration: FLASH_MS * 0.2 }),
        withTiming(0, { duration: FLASH_MS * 0.8 })
      )
    );
    // THE LID CARRIES THE `burst` CALLBACK, because the lid coming off IS the burst: it is the
    // frame the sting has to land on and the frame a batch open swaps to its shards.
    lid.value = withDelay(
      buildupMs,
      // The overshoot is the lid tipping before it launches — mock 186's cubic-bezier(.3,1.2,.4,1).
      withTiming(1, { duration: LID_MS, easing: Easing.bezier(0.3, 1.2, 0.4, 1) }, (finished) => {
        if (finished) runOnJS(burst)();
      })
    );
    // ...and the core flare carries `onDone`, because it is the LONGEST of the burst animations
    // (HANDOFF_MS, mock 186's +780). Hanging the finish off the lid instead would end the sequence
    // while the rays and sparks were still in the air.
    core.value = withDelay(
      buildupMs,
      withTiming(1, { duration: HANDOFF_MS, easing: Easing.out(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    body.value = withDelay(buildupMs + 120, withTiming(0, { duration: BODY_FADE_MS, easing: Easing.out(Easing.quad) }));
    rays.value = withDelay(buildupMs, withTiming(1, { duration: RAYS_MS, easing: Easing.out(Easing.quad) }));
    spark.value = withDelay(buildupMs, withTiming(1, { duration: PARTICLE_MS, easing: Easing.out(Easing.cubic) }));

    if (SHAKES.has(itemRarity)) {
      // The screen kick is the one thing keyed to the ITEM that fires ON the burst frame rather
      // than after it — which is fine, because by then the flash is already up. It cannot leak
      // early: it is delayed by the full buildup like everything else in this block.
      kick.value = withDelay(
        buildupMs,
        withSequence(
          withTiming(1, { duration: 60 }),
          withTiming(-0.7, { duration: 70 }),
          withTiming(0.4, { duration: 70 }),
          withTiming(0, { duration: 90 })
        )
      );
    }

  }

  useEffect(() => {
    return () => {
      // A batch open unmounts this the instant the shards take over; a still-running repeat would
      // keep a worklet alive against a torn-down view.
      for (const v of [shake, seam, flash, core, lid, body, rays, spark, kick, hint]) cancelAnimation(v);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable identities
  }, []);

  // ─────────────────────────── styles ───────────────────────────

  const stageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: kick.value * 9 },
      { translateY: kick.value * -5 },
    ],
  }));

  const crateStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shake.value * 4 },
      { rotate: `${shake.value * 2.4}deg` },
    ],
  }));

  const lidStyle = useAnimatedStyle(() => ({
    opacity: 1 - lid.value,
    transform: [
      { translateY: interpolate(lid.value, [0, 0.3, 1], [0, -14, -size * 1.2]) },
      { rotate: `${interpolate(lid.value, [0, 0.3, 1], [0, -6, 34])}deg` },
      { scale: interpolate(lid.value, [0, 1], [1, 0.7]) },
    ],
  }));

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: body.value,
    transform: [{ scale: interpolate(body.value, [0, 0.7, 1], [0.72, 1.05, 1]) }],
  }));

  const seamStyle = useAnimatedStyle(() => ({
    opacity: seam.value * 0.9,
    transform: [{ scaleX: interpolate(seam.value, [0, 1], [0.4, 1]) }],
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: interpolate(core.value, [0, 0.4, 1], [0, 1, 0]),
    transform: [{ scale: interpolate(core.value, [0, 1], [0.3, 3]) }],
  }));

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.9 }));

  const raysStyle = useAnimatedStyle(() => ({ opacity: rays.value * 0.5 }));

  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));

  // Fixed angles and distances per spark, decided once. Randomising inside the animated style
  // would re-roll every frame and the sparks would jitter in place instead of flying outward.
  const sparks = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT[itemRarity] }, (_, i) => {
        const angle = (i / PARTICLE_COUNT[itemRarity]) * Math.PI * 2 + (i % 3) * 0.31;
        const dist = 70 + ((i * 37) % 150);
        return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
      }),
    [itemRarity]
  );

  const onPress = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  };

  const content = (
    <Animated.View style={[styles.stage, stageStyle]}>
      {/* The rarity ray field, in the ITEM's colour, and it PERSISTS — mock 186 keeps it as the
          backdrop the reveal happens on rather than flashing it and taking it away. */}
      <Animated.View
        style={[
          styles.rays,
          { width: width * 1.4, height: width * 1.4, backgroundColor: rarityGlow(itemRarity, 0.5) },
          raysStyle,
        ]}
        pointerEvents="none"
      />

      <Animated.View style={[{ width: size, height: size }, crateStyle]}>
        {/* Core flare — the light from INSIDE, so it takes the item's colour and appears only at
            the burst. Under the lid until the lid is gone. */}
        <Animated.View
          style={[
            styles.core,
            { backgroundColor: itemTint, shadowColor: itemTint, marginLeft: -size * 0.23, marginTop: -size * 0.23, width: size * 0.46, height: size * 0.46, borderRadius: size * 0.23 },
            coreStyle,
          ]}
          pointerEvents="none"
        />
        <Animated.View style={[StyleSheet.absoluteFill, bodyStyle]}>
          <CrateBody boxKey={boxKey} accent={accent} size={size} />
          {/* The seam: the box's OWN light building along the lid line. Box accent, not item
              rarity — this is the last frame before the surprise and must not carry it. */}
          <Animated.View
            style={[
              styles.seam,
              { top: size * 0.3, left: size * 0.13, width: size * 0.74, backgroundColor: accent, shadowColor: accent },
              seamStyle,
            ]}
            pointerEvents="none"
          />
        </Animated.View>
        <Animated.View style={[styles.lid, { width: size, height: size * 0.35 }, lidStyle]}>
          <CrateLid accent={accent} size={size} />
        </Animated.View>
      </Animated.View>

      {/* Sparks, in the item's colour and counted by its rarity. */}
      {sparks.map((s, i) => (
        <Spark key={i} progress={spark} dx={s.dx} dy={s.dy} color={itemTint} />
      ))}

      {label ? (
        <Animated.View style={[styles.hint, hintStyle]} pointerEvents="none">
          <Text style={styles.hintText}>{label}</Text>
        </Animated.View>
      ) : null}

      <Animated.View
        style={[styles.flash, { width, height }, flashStyle]}
        pointerEvents="none"
      />
    </Animated.View>
  );

  if (!tapToOpen) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${BOXES[boxKey].name}`}>
      {content}
    </Pressable>
  );
}

/** One spark. Its own component so each gets its own animated style off the shared progress. */
function Spark({
  progress,
  dx,
  dy,
  color,
}: {
  progress: SharedValue<number>;
  dx: number;
  dy: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateX: progress.value * dx },
      { translateY: progress.value * dy },
      { scale: 1 - progress.value },
    ],
  }));
  return (
    <Animated.View
      style={[styles.spark, { backgroundColor: color, shadowColor: color }, style]}
      pointerEvents="none"
    />
  );
}

// ─────────────────────────── the crate itself (mock 186) ───────────────────────────
//
// A metal body with the box's rarity trim, four rivets and a sigil medallion, plus a lid that
// comes off as its own node. Deliberately ONE silhouette parameterised by accent rather than six
// bespoke ones: the six existing `BoxArt` vectors are drawn as sealed objects — a bundle of logs,
// a vault — and none of them has a lid that could lift off. So the identity moves to the trim
// colour and to the SIGIL, which is the existing per-box art shrunk into the medallion. Every box
// still reads as itself, and every box can now be opened the same way.

function CrateBody({ boxKey, accent, size }: { boxKey: BoxKey; accent: string; size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 130 130">
        <Defs>
          <LinearGradient id={`crate-metal-${boxKey}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#34293f" />
            <Stop offset="1" stopColor="#1a1327" />
          </LinearGradient>
        </Defs>
        <Rect x="17" y="40" width="96" height="80" rx="13" fill={`url(#crate-metal-${boxKey})`} stroke={accent} strokeWidth={3} />
        <Line x1="17" y1="74" x2="113" y2="74" stroke={accent} strokeWidth={1.5} opacity={0.45} />
        <Circle cx="28" cy="50" r="2.6" fill={accent} />
        <Circle cx="102" cy="50" r="2.6" fill={accent} />
        <Circle cx="28" cy="110" r="2.6" fill={accent} />
        <Circle cx="102" cy="110" r="2.6" fill={accent} />
        <G>
          <Circle cx="65" cy="88" r="19" fill="#120c1f" stroke={accent} strokeWidth={2} />
        </G>
      </Svg>
      {/* The sigil, as the real box art rather than mock 186's emoji stand-in. Absolutely
          positioned over the medallion the SVG above draws, because BoxArt owns its own viewBox
          and nesting one Svg inside another is not portable on Android. */}
      <View
        style={[
          styles.sigil,
          { left: size * (65 / 130) - size * 0.11, top: size * (88 / 130) - size * 0.11, width: size * 0.22, height: size * 0.22 },
        ]}
        pointerEvents="none">
        <BoxArt boxKey={boxKey} size={size * 0.22} />
      </View>
    </View>
  );
}

function CrateLid({ accent, size }: { accent: string; size: number }) {
  return (
    <Svg width={size} height={size * 0.4} viewBox="0 0 130 52">
      <Rect x="15" y="18" width="100" height="26" rx="9" fill={accent} />
      <Rect x="15" y="18" width="100" height="26" rx="9" fill="#ffffff" opacity={0.14} />
      <Rect x="55" y="8" width="20" height="12" rx="5" fill={accent} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rays: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0,
  },
  core: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  seam: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  lid: {
    position: 'absolute',
    top: -4,
    left: 0,
    alignItems: 'center',
  },
  sigil: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  flash: {
    position: 'absolute',
    backgroundColor: '#ffffff',
  },
  hint: {
    position: 'absolute',
    bottom: -Spacing.six,
  },
  hintText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
  },
});
