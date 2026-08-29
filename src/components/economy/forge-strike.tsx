import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';

import { ItemArt } from '@/components/economy/item-art';
import { PhiloiIcon } from '@/components/ui/philoi-icon';
import { Colors } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { fireBoxOpen } from '@/lib/reward-feedback';

// The hammer strike (mock 155, frame 2) — the Forge's equivalent of BoxCrack, and built to the same
// contract: mount it, it plays, it calls onDone. Three beats over ~1.9s.
//
//   1. FALL     the inputs you fed it drop onto the anvil and vanish into it
//   2. STRIKE   the hammer comes down; white flash, sparks off the anvil face
//   3. SETTLE   the flash fades out into the reveal
//
// 🔴 It is deliberately NOT told what came out, and there is no output item in this file.
//
// That is PUNCHLIST_14 §1's lesson, inherited rather than relearned: BoxCrack used to take a
// `rarity` prop and flash the tier colour through its rays, which told you it was a Mythic before
// the item was ever shown and left the reveal with nothing to say. Mock 155 draws the forged item
// rising off the anvil, and building it that way would spoil the same beat for the same reason —
// so the item's entrance belongs to the reveal that follows, and the strike ends on white.
//
// The inputs, by contrast, are shown: you chose them, so there is nothing to spoil, and watching
// the three specific things you picked go into the fire is the whole emotional point of a sink.

const FALL_MS = 620;
const STRIKE_MS = 260;
const SETTLE_MS = 420;
const TOTAL_MS = FALL_MS + STRIKE_MS + SETTLE_MS;

/** Where each spark flies. Fixed rather than random so the burst is the same shape every strike. */
const SPARKS: { dx: number; dy: number }[] = [
  { dx: -46, dy: -44 },
  { dx: 44, dy: -40 },
  { dx: -56, dy: -14 },
  { dx: 52, dy: -8 },
  { dx: 0, dy: -60 },
  { dx: -24, dy: -56 },
  { dx: 28, dy: -52 },
];

type Props = {
  /** The items being consumed — drawn falling in. Up to five (the Common rung's ratio). */
  inputs: CatalogItem[];
  reduceMotion: boolean;
  onDone: () => void;
};

export function ForgeStrike({ inputs, reduceMotion, onDone }: Props) {
  const fall = useSharedValue(0);
  const swing = useSharedValue(0);
  const flash = useSharedValue(0);
  const burst = useSharedValue(0);
  const anvilHit = useSharedValue(0);

  useEffect(() => {
    // The cue fires even under reduced motion, same as BoxCrack: that setting is about vestibular
    // safety, not silence, and the strike landing is still the thing that happened.
    fireBoxOpen();

    if (reduceMotion) {
      flash.value = withTiming(1, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
      return;
    }

    fall.value = withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.quad) });

    // The hammer is already cocked at rest (-62°, per the mock) and comes down through the moment
    // the last input lands, so the strike reads as causing the flash rather than following it.
    swing.value = withDelay(
      FALL_MS - 120,
      withSequence(
        withTiming(1, { duration: 160, easing: Easing.in(Easing.cubic) }),
        withTiming(0.82, { duration: 90 }),
        withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) })
      )
    );

    anvilHit.value = withDelay(
      FALL_MS,
      withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 200 }))
    );

    burst.value = withDelay(FALL_MS, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));

    flash.value = withDelay(
      FALL_MS,
      withSequence(
        withTiming(1, { duration: 90 }),
        withTiming(0, { duration: STRIKE_MS + SETTLE_MS - 90 }, (finished) => {
          if (finished) runOnJS(onDone)();
        })
      )
    );
  }, [reduceMotion, onDone, fall, swing, flash, burst, anvilHit]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  // Rocks on impact rather than translating — an anvil is the one thing on screen that must not
  // look light.
  const anvilStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: anvilHit.value * 3 }, { scaleY: 1 - anvilHit.value * 0.06 }],
  }));

  const hammerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-62 + swing.value * 78}deg` }],
  }));

  return (
    <View style={styles.stage} pointerEvents="none">
      {/* The inputs, falling in. */}
      {inputs.map((item, i) => (
        <FallingInput key={`${item.id}-${i}`} item={item} index={i} count={inputs.length} fall={fall} />
      ))}

      {/* Sparks off the anvil face. */}
      {SPARKS.map((s, i) => (
        <Spark key={i} dx={s.dx} dy={s.dy} burst={burst} />
      ))}

      <Animated.View style={[styles.anvil, anvilStyle]}>
        <PhiloiIcon name="forge" size={78} color={Colors.muted} />
      </Animated.View>

      <Animated.View style={[styles.hammer, hammerStyle]}>
        <Svg width={30} height={52} viewBox="0 0 30 52">
          <Rect x={9} y={14} width={4.5} height={34} rx={2} fill={Colors.logBrown} />
          <Rect x={2} y={4} width={24} height={13} rx={3.5} fill="#9aa4b4" />
        </Svg>
      </Animated.View>

      {/* The white flash the strike ends on — and the last thing before the reveal takes over. */}
      <Animated.View style={[styles.flash, flashStyle]} />
    </View>
  );
}

/**
 * One input arcing down onto the anvil face and disappearing into it.
 *
 * Spread across the width by index so five (the Common rung) fan out the same way three do, rather
 * than needing a second layout for the wider recipe.
 */
function FallingInput({
  item,
  index,
  count,
  fall,
}: {
  item: CatalogItem;
  index: number;
  count: number;
  fall: SharedValue<number>;
}) {
  // Evenly spaced around centre: for 3 that's -58/0/58, for 5 it tightens to fit.
  const spread = count > 1 ? Math.min(58, 150 / (count - 1)) : 0;
  const startX = (index - (count - 1) / 2) * spread * 2;
  // Staggered so they land in sequence rather than as one block — the last one landing IS the cue
  // for the hammer.
  const delay = (index / Math.max(count, 1)) * 0.35;

  const style = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(1, (fall.value - delay) / (1 - delay)));
    return {
      opacity: t > 0.9 ? (1 - t) / 0.1 : 1,
      transform: [
        { translateX: startX * (1 - t) },
        { translateY: t * 150 },
        { scale: 1 - t * 0.6 },
      ],
    };
  });

  return (
    <Animated.View style={[styles.input, style]}>
      <ItemArt item={item} size={34} />
    </Animated.View>
  );
}

function Spark({ dx, dy, burst }: { dx: number; dy: number; burst: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: burst.value < 0.15 ? burst.value / 0.15 : 1 - (burst.value - 0.15) / 0.85,
    transform: [{ translateX: dx * burst.value }, { translateY: dy * burst.value }],
  }));
  return <Animated.View style={[styles.spark, style]} />;
}

const styles = StyleSheet.create({
  stage: {
    height: 280,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 40,
  },
  input: {
    position: 'absolute',
    bottom: 190,
  },
  anvil: {
    marginBottom: 4,
  },
  hammer: {
    position: 'absolute',
    bottom: 66,
    left: '52%',
    // The pivot is the butt of the handle, so the head swings through an arc instead of sliding.
    transformOrigin: '12px 92%',
  },
  spark: {
    position: 'absolute',
    bottom: 106,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.ember,
  },
  flash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    opacity: 0,
  },
});

export const FORGE_STRIKE_MS = TOTAL_MS;
