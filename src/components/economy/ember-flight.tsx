import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EmberIcon } from '@/components/economy/ember-icon';

// ONE ember collection particle: an arc from wherever the payout was announced to wherever the
// balance is shown, landing with a callback so the counter can tick and the tick cue can play.
//
// Lifted out of flame-meter-complete.tsx (design-mocks/27's flight choreography) rather than
// re-drawn, because the sell reward (mock 100 frame 2) asks for exactly the same motion aimed at a
// different chip. The two call sites differ only in timing and in what they aim at, so those are
// props and the maths is not — a second hand-rolled arc is how the two would drift apart.
//
// The arc comes from a quadratic bezier through a RAISED midpoint, which is what the mock's Web
// Animations keyframes give it: embers rise before they curve into the chip, instead of sliding
// along a straight line like a cursor.

export type FlightPoint = { x: number; y: number };

type EmberFlightProps = {
  /** This particle's position in the burst — spreads the midpoints so the arcs fan out. */
  index: number;
  /** How many particles are in the burst, so the fan is centred on the middle one. */
  count: number;
  from: FlightPoint;
  to: FlightPoint;
  /** Coordinates are relative to whatever container this renders into. */
  delay: number;
  duration: number;
  size?: number;
  /** Lateral gap between neighbouring arcs at their apex. */
  spread?: number;
  /** How far above the straighter path the apex sits. */
  lift?: number;
  onLand?: () => void;
};

export const EmberFlight = memo(function EmberFlight({
  index,
  count,
  from,
  to,
  delay,
  duration,
  size = 11,
  spread = 8,
  lift = 46,
  onLand,
}: EmberFlightProps) {
  const progress = useSharedValue(0);
  const midX = (from.x + to.x) / 2 + (index - count / 2) * spread;
  const midY = Math.min(from.y, to.y) - lift;

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    const landTimer = setTimeout(() => onLand?.(), delay + duration);
    return () => clearTimeout(landTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot flight per mount
  }, []);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * midY + t * t * to.y;
    return {
      opacity: interpolate(t, [0, 0.12, 0.85, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { scale: interpolate(t, [0, 0.12, 1], [0.4, 1, 0.35]) },
      ],
    };
  });

  // Memoised: twelve of these fly while the balance counter re-renders the reveal underneath them.
  // Their props are fixed for the life of the flight, so every one of those renders was pure waste
  // — and twelve wasted SVG reconciliations per counter tick is what a stutter is made of.
  //
  // The crisp ember token, not a plain amber dot — these are the currency landing in the balance,
  // and §4 makes that token the only thing that ever depicts an ember.
  return (
    <Animated.View pointerEvents="none" style={[styles.ember, style]}>
      <EmberIcon size={size} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  ember: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
