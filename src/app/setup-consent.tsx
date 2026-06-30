import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const CONSENT_VERSION = '2026-06-30';
const PRIVACY_URL = 'https://getphiloi.com/privacy';
const TERMS_URL = 'https://getphiloi.com/terms';

export default function SetupConsentScreen() {
  const { session, refreshProfile } = useAuth();
  const [ageChecked, setAgeChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = ageChecked && termsChecked;

  async function handleAgree() {
    if (!canProceed || !session) return;
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          has_consented: true,
          consented_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
        })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your consent — try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <FlameIcon size={48} />
        <Text style={styles.title}>Before you lock in</Text>
      </View>

      <View style={styles.checks}>
        <Pressable style={styles.checkRow} onPress={() => setAgeChecked((v) => !v)}>
          <View style={[styles.checkbox, ageChecked && styles.checkboxChecked]}>
            {ageChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            I confirm I am{' '}
            <Text style={styles.bold}>18 years of age or older.</Text>
            {'\n'}
            <Text style={styles.subLabel}>Philoi is for users 18 and older.</Text>
          </Text>
        </Pressable>

        <Pressable style={styles.checkRow} onPress={() => setTermsChecked((v) => !v)}>
          <View style={[styles.checkbox, termsChecked && styles.checkboxChecked]}>
            {termsChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            I agree to the{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Privacy Policy
            </Text>
            .
          </Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <PrimaryButton label="Agree and continue" onPress={handleAgree} loading={loading} disabled={!canProceed} />
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
    fontSize: 26,
    color: Colors.ink,
    textAlign: 'center',
  },
  checks: {
    gap: Spacing.three,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.input,
    borderWidth: 2,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: Colors.coral,
    borderColor: Colors.coral,
  },
  checkmark: {
    color: '#FFFFFF',
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
  },
  checkLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
    lineHeight: 22,
  },
  bold: {
    fontFamily: Fonts.bodyBold,
  },
  subLabel: {
    fontSize: 13,
    color: Colors.muted,
  },
  link: {
    color: Colors.coral,
    textDecorationLine: 'underline',
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
    textAlign: 'center',
  },
});
