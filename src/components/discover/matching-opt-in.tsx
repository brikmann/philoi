import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ErrorLine } from '@/components/discover/kit';
import { Icon } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { setMyMatchSettings } from '@/lib/api/matchmaking';
import { getErrorMessage } from '@/lib/errors';

// Matching consent (0275). The engine is mutual: you only see people who opted in, and only they
// see you. Two shapes:
//   • MatchingOptIn — the card a browse page shows when you're not discoverable yet.
//   • MatchingSwitch — onboarding's visible switch (mock 378/379: "friends-matching ON by default").
//     It starts ON and says what that means right beside it; nothing is saved until the person
//     taps the step's own button, so the default is a choice they can see and flip — never a
//     silent opt-in.

export const MATCHING_EXPLAINER =
  'You’ll show up for people who turned matching on too — and only them. Change it anytime in Settings.';

export function MatchingOptIn({ onEnabled }: { onEnabled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await setMyMatchSettings({ discoverable: true });
      onEnabled();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't turn matching on."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Icon name="compass" size={18} color={Colors.navEmber2} />
        <Text style={styles.title}>Turn on matching to see people like you</Text>
      </View>
      <Text style={styles.body}>{MATCHING_EXPLAINER}</Text>
      <PrimaryButton label="Turn on matching" loading={busy} onPress={enable} />
      <ErrorLine message={error} />
    </View>
  );
}

export function MatchingSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={styles.switchRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="Match me with people like me">
      <View style={styles.flex}>
        <Text style={styles.switchTitle}>Match me with people like me</Text>
        <Text style={styles.switchBody}>{MATCHING_EXPLAINER}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.spacePanel2, true: Colors.navEmber }}
        thumbColor={Colors.ink}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    marginTop: Spacing.two,
    marginBottom: Spacing.twelve,
    padding: Spacing.three,
    gap: Spacing.twelve,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  body: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 19, color: Colors.muted },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: Spacing.three,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  switchTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink },
  switchBody: { marginTop: 2, fontFamily: Fonts.body, fontSize: 12, lineHeight: 17, color: Colors.spaceDim },
});
