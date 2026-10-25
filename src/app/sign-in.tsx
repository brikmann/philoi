import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
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
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { trackAnonymous } from '@/lib/analytics';
import { clearAccountHint, getAccountHint, type AccountHint, type AccountHintProvider } from '@/lib/auth/account-hint';
import {
  isAccountUnavailableError,
  isAppleSignInAvailable,
  isSignInCancelled,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/auth/providers';
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

// Photo when the hint has one that still loads, initials when it doesn't — a remembered avatar_url
// can be a provider URL that has since expired.
function HintAvatar({ hint }: { hint: AccountHint }) {
  const [broken, setBroken] = useState(false);
  const initials = (hint.display_name || hint.handle)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  if (hint.avatar_url && !broken) {
    return <Image source={{ uri: hint.avatar_url }} style={styles.hintAvatar} onError={() => setBroken(true)} />;
  }
  return (
    <View style={[styles.hintAvatar, styles.hintAvatarFallback]}>
      <Text style={styles.hintInitials}>{initials || '?'}</Text>
    </View>
  );
}

const SIGN_IN_FOR: Record<AccountHintProvider, () => Promise<void>> = {
  google: signInWithGoogle,
  apple: signInWithApple,
};

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  // `undefined` while the hint and Apple availability are still being read, so the screen never
  // flashes the plain buttons and then swaps to "Welcome back" (or the reverse) a beat later.
  const [hint, setHint] = useState<AccountHint | null | undefined>(undefined);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    Promise.all([isAppleSignInAvailable(), getAccountHint()]).then(([apple, stored]) => {
      setAppleAvailable(apple);
      // An Apple hint on a device that can't run Sign in with Apple (Android) would make "Continue
      // as" a dead button, so it gets the plain screen — the hint stays for the device it was
      // written on.
      setHint(stored && (stored.provider !== 'apple' || apple) ? stored : null);
    });
  }, []);

  const welcomeBack = hint ?? null;
  useEffect(() => {
    if (welcomeBack) trackAnonymous('welcome_back_shown', { provider: welcomeBack.provider });
  }, [welcomeBack]);

  // One loading flag for both providers: two OS sheets racing each other is never what anyone meant.
  // `quietCancel` is the welcome-back screen's: backing out of the sheet there is not an error.
  async function run(signIn: () => Promise<void>, quietCancel = false) {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await signIn();
    } catch (e) {
      if (quietCancel && isSignInCancelled(e)) return;
      if (welcomeBack && isAccountUnavailableError(e)) {
        // The remembered account is deleted or barred — don't strand them greeting it.
        await clearAccountHint();
        setHint(null);
      }
      setError(getErrorMessage(e, 'Something went wrong — try again.'));
    } finally {
      setLoading(false);
    }
  }

  // No auto-submit, ever: "Continue as" is a deliberate tap, so nobody holding the phone gets
  // signed in by just opening the app. A different account coming back is accepted as-is —
  // auth-context overwrites the hint on the profile load.
  function handleContinue(remembered: AccountHint) {
    trackAnonymous('welcome_back_continue', { provider: remembered.provider });
    void run(SIGN_IN_FOR[remembered.provider], true);
  }

  async function handleNotYou() {
    trackAnonymous('welcome_back_switch');
    setError(null);
    await clearAccountHint();
    setHint(null);
  }

  if (hint === undefined) return <Screen style={styles.container} />;

  if (welcomeBack) {
    return (
      <Screen style={styles.container}>
        <View style={styles.spacer} />

        <HintAvatar hint={welcomeBack} />
        <Text style={styles.welcomeKicker}>Welcome back,</Text>
        <Text style={styles.welcomeHandle} numberOfLines={1}>
          @{welcomeBack.handle}
        </Text>

        <View style={styles.spacer} />

        {/* Philoi's own primary — no provider logo, no provider styling, so it imitates nobody's
            button. Which provider it relaunches is an implementation detail of the tap. */}
        <View style={styles.continueWrap}>
          <PrimaryButton
            label={`Continue as @${welcomeBack.handle}`}
            onPress={() => handleContinue(welcomeBack)}
            loading={loading}
          />
        </View>

        {/* The real branded buttons, the same ones the plain screen draws — Apple's own component,
            offered wherever Google is, so 4.8's equivalence holds here too. */}
        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={15}
            style={styles.appleBtn}
            onPress={() => void run(signInWithApple, true)}
          />
        )}
        <Pressable style={styles.googleBtn} onPress={() => void run(signInWithGoogle, true)} disabled={loading}>
          <Ionicons name="logo-google" size={18} color={Colors.cream} />
          <Text style={styles.googleBtnLabel}>Sign in with Google</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={() => void handleNotYou()} disabled={loading} hitSlop={8} style={styles.notYou}>
          <Text style={styles.notYouLabel}>Not you? Use another account</Text>
        </Pressable>
        <Text style={styles.fine}>By continuing you agree to our Terms &amp; Privacy Policy.</Text>
      </Screen>
    );
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

      {/* Sign in with Apple (Guideline 4.8): offered wherever Google is, at the same size and weight,
          and drawn with Apple's own button — the HIG allows only that or a close copy of it. */}
      {appleAvailable && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={15}
          style={styles.appleBtn}
          onPress={() => void run(signInWithApple)}
        />
      )}
      <Pressable style={styles.googleBtn} onPress={() => void run(signInWithGoogle)} disabled={loading}>
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
  appleBtn: {
    width: '100%',
    height: 50,
    marginBottom: Spacing.twelve,
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
  hintAvatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: Colors.disabled,
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  hintAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintInitials: {
    fontFamily: Fonts.bodyBold,
    fontSize: 36,
    color: Colors.ink,
  },
  welcomeKicker: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    marginTop: Spacing.three,
  },
  welcomeHandle: {
    fontFamily: Fonts.display,
    fontSize: 30,
    letterSpacing: 0.5,
    color: Colors.ink,
    marginTop: 4,
  },
  continueWrap: {
    width: '100%',
    marginBottom: Spacing.three,
  },
  notYou: {
    marginTop: Spacing.three,
  },
  notYouLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
    textDecorationLine: 'underline',
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
