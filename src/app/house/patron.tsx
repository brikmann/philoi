import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PatronPicker } from '@/components/patron/patron-picker';
import { Screen } from '@/components/ui/screen';
import { SPACE_GUTTER, SpaceButton, SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { epicLockup, setMyPatron, type Patron } from '@/lib/api/patrons';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// ── YOUR PATRON (Phase 9, mocks 340 / 341) ──
//
// Change the persona you rep, from the profile's ✎ Edit sheet or its "Pick your patron" prompt. The
// same PatronPicker as onboarding's step 5. Independent of the program: any of the twelve, whatever
// you study. A tap picks, Save writes (set_my_patron, 0293) — no ceremony.

export default function PatronScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [picked, setPicked] = useState<Patron | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = picked?.key ?? profile?.patron_key ?? null;

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function save() {
    if (!session || !picked) return;
    setSaving(true);
    setError(null);
    try {
      await setMyPatron(session.user.id, picked.key);
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your patron — try again.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    leave();
  }

  return (
    <Screen padded={false} edges={['top']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SpaceHeader title="Your patron" onBack={leave} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sub}>Your patron is just your vibe — pick the one that fits. Your program rides beside it.</Text>
        <PatronPicker value={current} onChange={setPicked} />
        {picked ? (
          <Text style={styles.sub}>
            You’ll read as <Text style={styles.bold}>{epicLockup(picked.name, null)}</Text>
            {' — with your program beside it.'}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <SpaceButton
          label="Save patron"
          onPress={() => void save()}
          loading={saving}
          disabled={!picked || picked.key === profile?.patron_key}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 14,
  },
  body: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
  },
  bold: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
  },
  footer: {
    paddingHorizontal: SPACE_GUTTER,
    paddingTop: Spacing.two,
  },
});
