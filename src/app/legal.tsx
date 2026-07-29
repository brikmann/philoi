import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';

const PAGES: Record<string, { title: string; url: string }> = {
  privacy: { title: 'Privacy Policy', url: 'https://getphiloi.com/privacy' },
  terms: { title: 'Terms of Service', url: 'https://getphiloi.com/terms' },
  'child-safety': { title: 'Child Safety Standards', url: 'https://getphiloi.com/child-safety' },
};

export default function LegalScreen() {
  const { page } = useLocalSearchParams<{ page?: string }>();
  const info = PAGES[page ?? 'privacy'] ?? PAGES.privacy;

  return (
    <Screen style={styles.container}>
      <Stack.Screen options={{ title: info.title }} />
      <View style={styles.content}>
        <Text style={styles.body}>
          This policy is hosted at getphiloi.com. Tap the button below to open it in your browser.
        </Text>
        <Pressable style={styles.button} onPress={() => Linking.openURL(info.url)}>
          <Text style={styles.buttonLabel}>Open {info.title}</Text>
        </Pressable>
        <Text style={styles.url}>{info.url}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  body: {
    fontFamily: Fonts.body,
    color: Colors.muted,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Colors.coral,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 16,
  },
  buttonLabel: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 16,
  },
  url: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
});
