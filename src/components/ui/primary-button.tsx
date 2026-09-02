import { useEffect, useId, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors, EMBER_GRADIENT, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// THE primary button (DESIGN_LANGUAGE_EMBER §3). Ember-gradient fill, near-black bold label, soft
// ember glow, and an optional slow pulse on the ONE main action of a screen.
//
// Lock in · Collect · Post · Buy · Continue are all this button. What the rule is fixing: primary
// actions were previously a flat coral fill with cream text, which is legible but says nothing —
// the gradient plus near-black text is the one treatment that means "this is the action".
//
// The API is UNCHANGED from the pre-Ember version — `loading`, an optional `onPress` that receives
// the event, and the `cold` variant are all still here, because ~7 screens pass them and a restyle
// has no business breaking call sites. `pulse` and `ghost` are additive.
//
// `cold` is deliberately NOT restyled to the gradient: it is a STATE colour (the going-cold CTA in
// spec §7), not one of the blue/grey primaries §3 is abolishing.
//
// The gradient is SVG because neither expo-linear-gradient nor masked-view is installed, and adding
// a native module for a button fill would mean another prebuild.

type PrimaryButtonProps = {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'cold' | 'ghost';
  /** Slow breathing glow. Use on the ONE main action of a screen, never several at once. */
  pulse?: boolean;
  /**
   * Row-sized rather than slab-sized, for a CTA that lives INSIDE something — the claim in the
   * reward reveal's ember row.
   *
   * A size, not a second button. The reveal's claim was drawn with EmberFill and it read as
   * off-brand for a reason that is easy to miss: EmberFill defaults to a HORIZONTAL ramp and a
   * `Radius.pill` corner, while every primary CTA in the app is the same two stops at 135° with
   * `Radius.button`. Same colours, different treatment — which is exactly the drift a shared
   * primitive exists to stop. Routing that button back through this component means it cannot
   * drift again.
   */
  compact?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  pulse = false,
  compact = false,
}: PrimaryButtonProps) {
  // Gradient ids are global in react-native-svg — a shared literal renders every button after the
  // first as blank on Android.
  const gradId = `cta-${useId()}`;
  const reduceMotion = useReduceMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const glow = useSharedValue(1);

  const isDisabled = disabled || loading;
  const isCold = variant === 'cold';
  const isGhost = variant === 'ghost';
  const animate = pulse && !isDisabled && !reduceMotion && variant === 'primary';

  useEffect(() => {
    if (!animate) {
      glow.value = 1;
      return;
    }
    glow.value = withRepeat(
      withSequence(withTiming(1.04, { duration: 1400 }), withTiming(1, { duration: 1400 })),
      -1,
      true
    );
  }, [animate, glow]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }] }));

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // The ember gradient only paints on the default variant — cold and ghost keep their own fills.
  const showGradient = variant === 'primary' && !isDisabled && size.w > 0;

  const button = (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        isCold && styles.buttonCold,
        isGhost && styles.buttonGhost,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}>
      {showGradient ? (
        // Painted UNDER the label rather than as a background prop — RN has no gradient
        // backgrounds, and the SVG needs measured pixels, so it lands one layout pass late. The
        // solid coral beneath means the button is never transparent in that first frame.
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h}>
            <Defs>
              {/* 135° — top-left to bottom-right, per §3. */}
              <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={EMBER_GRADIENT[1]} />
                <Stop offset="1" stopColor={EMBER_GRADIENT[0]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} rx={Radius.button} fill={`url(#${gradId})`} />
          </Svg>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={isCold ? Colors.coldButtonText : isGhost ? Colors.muted : Colors.onEmber} />
      ) : (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            compact && styles.labelCompact,
            isCold && styles.labelCold,
            isGhost && styles.labelGhost,
            isDisabled && !isCold && !isGhost && styles.labelDisabled,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );

  return animate ? <Animated.View style={pulseStyle}>{button}</Animated.View> : button;
}

const styles = StyleSheet.create({
  buttonCompact: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    // No shadow at this size: an ember glow under a 34pt button inside a card reads as a smudge
    // rather than as lift.
    shadowOpacity: 0,
    elevation: 0,
  },
  labelCompact: {
    fontSize: 13.5,
  },
  button: {
    // Base fill under the SVG — see the note at the render site.
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    // Transparent hairline on every variant so the disabled state can paint its border without
    // the button growing 2px taller the moment it flips.
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 6,
  },
  buttonCold: {
    backgroundColor: Colors.coldChipBg,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  // Muted-on-brand (mock 98): the button keeps its shape and loses the fire, rather than
  // becoming a grey slab carrying a near-black label nobody can read.
  disabled: {
    backgroundColor: Colors.disabledSurface,
    borderColor: Colors.disabledBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    // Near-black ON the gradient (§3) — cream would halve the contrast against #FFD27A.
    color: Colors.onEmber,
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
  },
  labelCold: {
    color: Colors.coldButtonText,
  },
  // onEmber is near-black — legible burnt into the gradient, invisible on the disabled fill.
  labelDisabled: {
    color: Colors.disabledText,
  },
  labelGhost: {
    color: Colors.muted,
  },
});
