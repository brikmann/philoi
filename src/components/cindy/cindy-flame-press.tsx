import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';

// THE FLAME'S PRESS STATE (CINDY_SPEC, mock 117 · cindy_tap_ring_pulse).
//
// Tap = chat, hold = voice, and the flame itself is the whole hit target — a chat button sitting
// NEXT to her would say she is something other than the flame. This wrapper exists so that press
// behaviour is defined once and is identical on every surface the flame appears on (home today,
// the header flame and the lock-in flame next), rather than three screens each re-deriving a
// bounce.
//
// It renders the rings and owns the gesture; it does NOT render the flame. Callers pass whichever
// flame belongs on their surface as children, so this composes with PersonalFlame, SessionFlame or
// a bare EquippedFlameSvg without knowing about any of them.

/** Mock: rings fire ~140ms apart, each ~0.9s of expand + fade. */
const RING_STAGGER_MS = 140;
const RING_DURATION_MS = 900;
/** How far past the flame a ring travels before it dies. */
const RING_MAX_SCALE = 2.1;

type CindyFlamePressProps = {
  /** Diameter of the ring field. Match the flame's visual size. */
  size: number;
  /** Tap — opens the text chat. */
  onTap: () => void;
  /** Hold — opens voice. Omitted means hold does nothing and the rings only fire once. */
  onHold?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
  children: React.ReactNode;
};

export function CindyFlamePress({
  size,
  onTap,
  onHold,
  disabled = false,
  accessibilityLabel = 'Talk to Cindy',
  style,
  children,
}: CindyFlamePressProps) {
  const scale = useSharedValue(1);
  // One progress value per ring: 0 = at the flame and opaque, 1 = expanded and gone.
  const r0 = useSharedValue(0);
  const r1 = useSharedValue(0);
  const r2 = useSharedValue(0);
  const rings = [r0, r1, r2];

  const stopRings = useCallback(() => {
    'worklet';
    [r0, r1, r2].forEach((r) => {
      cancelAnimation(r);
      r.value = 0;
    });
  }, [r0, r1, r2]);


  function ripple(repeating: boolean) {
    rings.forEach((r, i) => {
      cancelAnimation(r);
      r.value = 0;
      const travel = withTiming(1, { duration: RING_DURATION_MS, easing: Easing.out(Easing.quad) });
      r.value = withDelay(
        i * RING_STAGGER_MS,
        // Hold pulses continuously; a tap fires the set once and stops. -1 repeats forever, and
        // the false keeps it from playing backwards on alternate runs — a ring that shrinks back
        // into the flame reads as inhaling rather than radiating.
        repeating ? withRepeat(travel, -1, false) : travel,
      );
    });
  }

  function handlePressIn() {
    if (disabled) return;
    // Squash then overshoot then settle — she wakes up rather than just scaling.
    scale.value = withSequence(
      withTiming(0.9, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(1.06, { damping: 9, stiffness: 220 }),
      withSpring(1, { damping: 14, stiffness: 180 }),
    );
    ripple(false);
  }

  function handlePressOut() {
    if (disabled) return;
    // Only the continuous (hold) pulse needs stopping. A tap's rings are already finishing on
    // their own, and killing them here would clip the animation the moment the finger lifts.
    if (onHold) stopRings();
  }

  function handleLongPress() {
    if (disabled || !onHold) return;
    ripple(true);
    onHold();
  }

  // A press that is still held when the component unmounts (navigation fires on tap) would leave
  // a repeating animation running against a detached node.
  useEffect(
    () => () => {
      cancelAnimation(scale);
      cancelAnimation(r0);
      cancelAnimation(r1);
      cancelAnimation(r2);
    },
    // Empty on purpose. useSharedValue returns a stable ref for the life of the component, so
    // there is nothing here that can change; listing them instead makes the compiler treat the
    // handlers below as modifying an effect dependency, which it refuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared values are stable refs
    [],
  );

  const flameStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={disabled ? undefined : onTap}
      onLongPress={handleLongPress}
      delayLongPress={280}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={onHold ? 'Tap to chat, hold to talk' : undefined}
      style={[styles.wrap, style]}>
      {/* Rings sit BEHIND the flame and must never eat the touch. */}
      <View pointerEvents="none" style={[styles.ringField, { width: size, height: size }]}>
        {rings.map((r, i) => (
          <Ring key={i} progress={r} size={size} />
        ))}
      </View>
      <Animated.View style={flameStyle}>{children}</Animated.View>
    </Pressable>
  );
}

function Ring({ progress, size }: { progress: SharedValue<number>; size: number }) {
  const style = useAnimatedStyle(() => ({
    // Starts a little inside the flame so it appears to come off her, not out of thin air.
    transform: [{ scale: 0.55 + progress.value * (RING_MAX_SCALE - 0.55) }],
    // Fades across the whole travel; never fully opaque, since three overlapping rings at full
    // strength read as a target reticle rather than heat.
    //
    // At EXACT rest (progress === 0) the ring is fully invisible — otherwise an idle ring sits
    // permanently over the flame at 0.42 (a static "circle" in front of it). It was hidden behind
    // the small home flame but peeked past the taller lock-in flame. A ripple animates progress
    // off 0 immediately, so the tap/hold ripple is unaffected; only the resting frame is cleared.
    opacity: progress.value === 0 ? 0 : (1 - progress.value) * 0.42,
  }));
  return (
    <Animated.View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringField: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: Colors.ember,
  },
});
