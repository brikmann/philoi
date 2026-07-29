import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { FLAME_ASPECT_RATIO, FlameSvg } from '@/components/flame-icon';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { signInWithGoogle } from '@/lib/auth/providers';
import { getErrorMessage } from '@/lib/errors';

// design-mocks/01-splash.html's `@keyframes emb` — embers spawn full-size near the flame,
// drift up ~120px, and shrink to .3 scale as they fade, each on its own ~3s ease-out loop.
const EMBERS = [
  { delay: 0, xOffset: -20 },
  { delay: 600, xOffset: 14 },
  { delay: 1200, xOffset: -6 },
  { delay: 1800, xOffset: 22 },
  { delay: 2400, xOffset: -14 },
  { delay: 3000, xOffset: 8 },
];

function Ember({ delay, xOffset }: { delay: number; xOffset: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3000, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 0.85, 0]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -120]) },
      { translateX: interpolate(progress.value, [0, 1], [0, xOffset]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.3]) },
    ],
  }));

  return <Animated.View style={[styles.ember, style]} />;
}

// `.fl` — the flame gently flickers in place (scaleY 1→1.06 / scaleX 1→0.96, transform-origin
// near the base) on an 1.8s ease-in-out loop, independent of the embers.
function FlickeringFlame({ reduceMotion }: { reduceMotion: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduceMotion, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { scaleY: interpolate(progress.value, [0, 1], [1, 1.06]) },
      { scaleX: interpolate(progress.value, [0, 1], [1, 0.96]) },
    ],
    transformOrigin: '50% 90%' as const,
  }));

  return (
    <Animated.View style={style}>
      <FlameSvg width={132 * FLAME_ASPECT_RATIO} height={132} />
    </Animated.View>
  );
}

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(getErrorMessage(e, 'Something went wrong — try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.spacer} />

      <View style={styles.logoZone}>
        {!reduceMotion && EMBERS.map((e) => <Ember key={e.delay} delay={e.delay} xOffset={e.xOffset} />)}
        <FlickeringFlame reduceMotion={reduceMotion} />
      </View>

      <Text style={styles.name}>Philoi</Text>
      <Text style={styles.trans}>
        <Text style={styles.transGreek}>φίλοι</Text> · <Text style={styles.transPhonetic}>fee-loy</Text> · Ancient Greek
      </Text>
      <Text style={styles.def}>&quot;close friends bound by trust, affection, and shared effort&quot;</Text>

      <View style={styles.spacer} />

      <Pressable style={styles.googleBtn} onPress={handleGoogleSignIn} disabled={loading}>
        <Ionicons name="logo-google" size={18} color={Colors.cream} />
        <Text style={styles.googleBtnLabel}>{loading ? 'Connecting…' : 'Continue with Google'}</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.fine}>By continuing you agree to our Terms &amp; Privacy Policy.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
  },
  spacer: {
    flex: 1,
  },
  logoZone: {
    width: 132,
    height: 150,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  ember: {
    position: 'absolute',
    bottom: 50,
    left: '50%',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.amber,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 32,
    letterSpacing: 0.5,
    color: Colors.ink,
    marginTop: 6,
  },
  trans: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 11,
  },
  transGreek: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ember,
    letterSpacing: 1,
  },
  transPhonetic: {
    fontStyle: 'italic',
  },
  def: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.soloChipText,
    marginTop: 10,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 19.5,
    maxWidth: 230,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    width: '100%',
    backgroundColor: Colors.ink,
    borderRadius: 15,
    paddingVertical: 15,
    paddingHorizontal: 15,
  },
  googleBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.cream,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  fine: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: 13,
    lineHeight: 14.7,
  },
});
