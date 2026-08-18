import * as Linking from 'expo-linking';
import { StyleSheet, Text, View } from 'react-native';

import { FlameLogo } from '@/components/ui/flame-logo';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';

const SUPPORT_EMAIL = 'support@getphiloi.com';

// Reached via the Stack.Protected guard in _layout.tsx when profile.is_disabled is true — set
// only by admin_disable_account() (schema.sql) after a confirmed moderation action. There's
// nothing to fix from here; this just explains what happened and offers a way to sign out /
// appeal, matching how setup-handle.tsx blocks the rest of the app for its own gate.
export default function AccountDisabledScreen() {
  const { signOut } = useAuth();

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <FlameLogo size={48} />
        <Text style={styles.title}>Your account has been disabled</Text>
        <Text style={styles.body}>
          This happened after a review of a report against your account. If you think this is a
          mistake, contact{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
            {SUPPORT_EMAIL}
          </Text>
          .
        </Text>
      </View>

      <SecondaryButton label="Sign out" onPress={() => signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    gap: Spacing.four,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  link: {
    color: Colors.coral,
    textDecorationLine: 'underline',
  },
});
