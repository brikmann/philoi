import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { Logo } from '@/components/logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { signInWithGoogle } from '@/lib/auth/providers';

export default function SignInScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen dark style={styles.container}>
      <View style={styles.hero}>
        <FlameIcon size={96} />
        <Logo size={36} showFlame={false} />
        <Text style={styles.tagline}>Lock in — together.</Text>
        <Text style={styles.subtitle}>Philoi — Greek for your people.</Text>
      </View>

      <View style={styles.footer}>
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Continue with Google" onPress={handleGoogleSignIn} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    paddingVertical: Spacing.six,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  tagline: {
    fontFamily: Fonts.display,
    fontSize: 22,
    color: Colors.cream,
    marginTop: Spacing.two,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ember,
  },
  footer: {
    gap: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
  },
});
