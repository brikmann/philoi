import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { GOAL_TYPE_GLYPH } from '@/lib/goal-types';
import type { GoalType } from '@/types/database';

// "Bright cream, large, and legible against the flame" (PHILOI_UI_SPEC.md §13's "goal-as-fuel
// object" — a flaming dumbbell for Gym, flaming pen for Study, etc.) — this exact hex isn't a
// shared brand token, just this one tool-icon's required contrast color.
const TOOL_COLOR = '#FFF3DC';

// How often the flame visibly "grows" a stage — a new pulse/pop, not a literal log sprite.
const STAGE_INTERVAL_SECONDS = 5 * 60;
const MAX_STAGE = 6; // caps visual growth so a multi-hour session doesn't overflow the layout

// Staggered rise-and-fade embers drifting off the flame — the ambient "still burning" signal
// between stage-ups, so the flame doesn't read as static during the 5-minute gaps.
const EMBERS = [
  { delay: 0, xOffset: -18 },
  { delay: 550, xOffset: 10 },
  { delay: 1100, xOffset: -4 },
  { delay: 1650, xOffset: 22 },
];

function Ember({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false)
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 0.75, 1], [0, 1, 0.5, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -74]) },
      { translateX: xOffset },
      { scale: interpolate(progress.value, [0, 1], [0.6, 1]) },
    ],
  }));

  return <Animated.View style={[styles.ember, style]} />;
}

export type LockInFlameParticipant = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

type LockInFlameProps = {
  goalType: GoalType | string;
  elapsedSeconds: number;
  participants?: LockInFlameParticipant[];
};

export function LockInFlame({ goalType, elapsedSeconds, participants = [] }: LockInFlameProps) {
  // `?? 'flame'` still resolves — the brand flame is part of the mock-163 set now (see
  // discipline-icon.tsx), so a goal type this build doesn't know still gets a glyph from the
  // same hand rather than an Ionicons stand-in.
  const toolGlyph = GOAL_TYPE_GLYPH[goalType as GoalType] ?? 'flame';
  const stage = Math.min(Math.floor(elapsedSeconds / STAGE_INTERVAL_SECONDS), MAX_STAGE);

  const breathe = useSharedValue(1);
  const pop = useSharedValue(1);
  const shockwave = useSharedValue(0);

  useEffect(() => {
    // Continuous breathing glow — runs regardless of stage, gives the flame life even
    // between stage-ups.
    breathe.value = withRepeat(withSequence(withTiming(1.08, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true);
  }, [breathe]);

  useEffect(() => {
    // A little "pop" whenever a new stage is reached — the "logs being added" moment —
    // plus a shockwave ring expanding outward for a bigger, harder-to-miss beat every 5 minutes.
    if (stage > 0) {
      pop.value = 1;
      pop.value = withSequence(withSpring(1.35), withSpring(1));
      shockwave.value = 0;
      shockwave.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) });
    }
  }, [stage, pop, shockwave]);

  const intensity = 0.35 + stage * 0.11; // 0.35 -> ~1.0 across the stage range
  const scale = 1 + stage * 0.08;

  const flameStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathe.value * pop.value * scale }],
  }));

  const shockwaveStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shockwave.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(shockwave.value, [0, 1], [1, 2.4]) }],
  }));

  return (
    <View style={styles.container}>
      <View style={[styles.glow, { opacity: intensity, transform: [{ scale: 1.6 + stage * 0.15 }] }]} />
      <Animated.View pointerEvents="none" style={[styles.shockwave, shockwaveStyle]} />
      {EMBERS.map((e) => (
        <Ember key={e.delay} delay={e.delay} xOffset={e.xOffset} />
      ))}
      <Animated.View style={[styles.flameWrap, flameStyle]}>
        <FlameSvg width={(150 + stage * 6) * FLAME_ASPECT_RATIO} height={150 + stage * 6} />
        <View style={styles.toolIcon}>
          <DisciplineIcon name={toolGlyph} size={40 + stage * 3} color={TOOL_COLOR} />
        </View>
      </Animated.View>

      {participants.length > 0 && (
        <Animated.View layout={LinearTransition.springify().damping(16)} style={styles.participants}>
          {participants.slice(0, 6).map((p) => (
            <Animated.View
              key={p.user_id}
              entering={ZoomIn.springify().damping(12)}
              exiting={ZoomOut.duration(200)}
              style={styles.avatarRing}
            >
              {p.avatar_url ? (
                <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{p.display_name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </Animated.View>
          ))}
          {participants.length > 6 && <Text style={styles.overflowCount}>+{participants.length - 6}</Text>}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Colors.amber,
  },
  shockwave: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: Colors.amber,
  },
  ember: {
    position: 'absolute',
    bottom: 30,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  flameWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolIcon: {
    position: 'absolute',
    bottom: 22,
  },
  participants: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: -Spacing.one,
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: Colors.cream,
    borderRadius: 20,
    marginLeft: -Spacing.one,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarFallback: {
    backgroundColor: Colors.plum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: Colors.cream,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
  overflowCount: {
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
    marginLeft: Spacing.two,
  },
});
