import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceCard, SpaceTile, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';

const PAGES: Record<string, { title: string; url: string }> = {
  privacy: { title: 'Privacy Policy', url: 'https://philoi.app/privacy.html' },
  terms: { title: 'Terms of Service', url: 'https://philoi.app/terms.html' },
  'child-safety': { title: 'Child Safety Standards', url: 'https://philoi.app/child-safety.html' },
};

export default function LegalScreen() {
  const { page } = useLocalSearchParams<{ page?: string }>();
  const info = PAGES[page ?? 'privacy'] ?? PAGES.privacy;

  return (
    // The native header (root layout) carries the title; the body is one centred card.
    // No bottom edge: the global footer owns the bottom inset.
    <Screen padded={false} edges={['top', 'left', 'right']} style={styles.container}>
      <Stack.Screen options={{ title: info.title }} />
      <SpaceCard style={styles.content}>
        <SpaceTile tone="legend">
          <SettingsGlyph name="doc" size={18} color={Colors.legend} />
        </SpaceTile>
        <Text style={styles.title}>{info.title}</Text>
        <Text style={styles.body}>
          This policy is hosted at philoi.app. Tap the button below to open it in your browser.
        </Text>
        <SpaceButton
          label={`Open ${info.title}`}
          onPress={() => Linking.openURL(info.url)}
          leading={<UiGlyph name="external" size={16} color="#2A0F05" />}
          style={styles.button}
        />
        <Text style={styles.url}>{info.url}</Text>
      </SpaceCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    paddingHorizontal: SPACE_GUTTER,
  },
  content: {
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.five,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: Spacing.two,
  },
  url: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceFaint,
  },
});
