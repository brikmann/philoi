import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/components/logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase';

function normalizeHandle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export default function SetupHandleScreen() {
  const { session, refreshProfile } = useAuth();
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const normalized = normalizeHandle(handle);
    if (normalized.length < 3) {
      setError('Handles need at least 3 characters — letters, numbers, or _.');
      return;
    }

    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ handle: normalized })
      .eq('id', session!.user.id);

    if (updateError) {
      setError(updateError.code === '23505' ? 'That handle is taken — try another.' : updateError.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <Logo size={28} />
        <Text style={styles.title}>Pick your handle</Text>
        <Text style={styles.body}>This is how your circle finds and sees you. Choose once.</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="e.g. jordan23"
          value={handle}
          onChangeText={setHandle}
          maxLength={20}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Save my spot" onPress={handleSave} loading={loading} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    paddingVertical: Spacing.six,
  },
  header: {
    gap: Spacing.two,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.muted,
  },
  form: {
    gap: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
