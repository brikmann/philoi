import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUniversities } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

const CONSENT_VERSION = '2026-06-30';
const PRIVACY_URL = 'https://getphiloi.com/privacy';
const TERMS_URL = 'https://getphiloi.com/terms';

function normalizeHandle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

type Availability = 'idle' | 'checking' | 'available' | 'taken';

// design-mocks/17-onboarding.html — all three onboarding steps (username, school, consent)
// live on this one screen, gated while `needsHandle || needsConsent` is true (see
// _layout.tsx). Keeping them in one component (rather than one route per step) is what lets
// Back actually work: it's just local `step` state, not navigation across a gate boundary a
// user shouldn't be able to re-enter once past it.
export default function SetupHandleScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(profile?.handle ? 3 : 1);

  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [availability, setAvailability] = useState<Availability>('idle');

  const [universities, setUniversities] = useState<string[]>([]);
  const [universityQuery, setUniversityQuery] = useState('');
  const [university, setUniversity] = useState<string | null>(profile?.university ?? null);

  const [ageChecked, setAgeChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUniversities().then(setUniversities).catch(() => {});
  }, []);

  // Live "@handle available" check (PHILOI_UI_SPEC.md §21: "availability-checked and unique") —
  // debounced so we're not firing a query on every keystroke.
  useEffect(() => {
    const normalized = normalizeHandle(handle);
    if (normalized.length < 3) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    const timer = setTimeout(() => {
      supabase
        .from('profiles')
        .select('id')
        .eq('handle', normalized)
        .neq('id', session!.user.id)
        .maybeSingle()
        .then(({ data }) => setAvailability(data ? 'taken' : 'available'));
    }, 400);
    return () => clearTimeout(timer);
  }, [handle, session]);

  const normalizedHandle = normalizeHandle(handle);
  const canContinueStep1 = normalizedHandle.length >= 3 && availability !== 'taken' && displayName.trim().length > 0;

  const filteredUniversities = universities.filter((u) => u.toLowerCase().includes(universityQuery.toLowerCase()));
  // "not listed" fallback (PHILOI_UI_SPEC.md §21) — a school not yet seeded in the canonical
  // table can still be saved as free text rather than blocking onboarding.
  const notListed = universityQuery.trim().length > 0 && !universities.some((u) => u.toLowerCase() === universityQuery.trim().toLowerCase());
  const canContinueStep2 = Boolean(university) || notListed;
  const canContinueStep3 = ageChecked && termsChecked;

  async function handleContinueStep2() {
    setLoading(true);
    setError(null);
    const resolvedUniversity = university ?? (universityQuery.trim() || null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ handle: normalizedHandle, display_name: displayName.trim(), university: resolvedUniversity })
      .eq('id', session!.user.id);

    if (updateError) {
      setError(updateError.code === '23505' ? 'That handle is taken — try another.' : updateError.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
    setStep(3);
  }

  async function handleFinish() {
    if (!canContinueStep3 || !session) return;
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
    <Screen padded={false} style={styles.container}>
      <OnboardingProgress step={step} />

      {step === 1 && (
        <View style={styles.step}>
          <Text style={styles.h}>Pick a username</Text>
          <Text style={styles.sub}>How your campfires know you.</Text>

          <Text style={styles.lbl}>Username</Text>
          <View style={styles.field}>
            <Text style={styles.pre}>@</Text>
            <TextInput
              style={styles.fieldInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="jordan23"
              placeholderTextColor={Colors.textTertiary}
              value={handle}
              onChangeText={setHandle}
              maxLength={20}
            />
            {availability === 'available' && (
              <View style={styles.ok}>
                <Ionicons name="checkmark" size={12} color={Colors.green} />
                <Text style={styles.okText}>available</Text>
              </View>
            )}
            {availability === 'taken' && <Text style={styles.taken}>taken</Text>}
          </View>

          <Text style={styles.lbl}>Display name</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.fieldInput}
              placeholder="Jordan"
              placeholderTextColor={Colors.textTertiary}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={40}
            />
          </View>
        </View>
      )}

      {step === 2 && (
        <View style={styles.step}>
          <Text style={styles.h}>Where do you study?</Text>
          <Text style={styles.sub}>So we can group your campus and classes.</Text>

          <View style={styles.search}>
            <Ionicons name="search" size={14} color={Colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search your university"
              placeholderTextColor={Colors.textTertiary}
              value={university ?? universityQuery}
              onChangeText={(text) => {
                setUniversity(null);
                setUniversityQuery(text);
              }}
              maxLength={80}
            />
          </View>

          <FlatList
            data={filteredUniversities}
            keyExtractor={(item) => item}
            style={styles.unilist}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = university === item;
              return (
                <Pressable
                  style={[styles.uni, on && styles.uniOn]}
                  onPress={() => {
                    setUniversity(item);
                    setUniversityQuery(item);
                  }}>
                  <View style={[styles.uniIcon, on && styles.uniIconOn]}>
                    <Ionicons name="business-outline" size={14} color={on ? Colors.amber : Colors.muted} />
                  </View>
                  <Text style={styles.uniName}>{item}</Text>
                  {on && <Ionicons name="checkmark" size={16} color={Colors.coral} />}
                </Pressable>
              );
            }}
            ListFooterComponent={
              notListed ? (
                <Pressable style={[styles.uni, !university && styles.uniOn]} onPress={() => setUniversity(null)}>
                  <View style={styles.uniIcon}>
                    <Ionicons name="add" size={14} color={Colors.muted} />
                  </View>
                  <Text style={styles.uniName}>Use &quot;{universityQuery.trim()}&quot; (not listed)</Text>
                </Pressable>
              ) : null
            }
          />
        </View>
      )}

      {step === 3 && (
        <View style={styles.step}>
          <Text style={styles.h}>One last thing</Text>
          <Text style={styles.sub}>Then you&apos;re in.</Text>

          <View style={styles.consent}>
            <Text style={styles.consentText}>
              Philoi stores your lock-ins, streaks, and photos to run your campfires with your friends. We never
              sell your data.
            </Text>
          </View>

          <Pressable style={styles.agree} onPress={() => setAgeChecked((v) => !v)}>
            <View style={[styles.box, ageChecked && styles.boxOn]}>
              {ageChecked && <Text style={styles.check}>✓</Text>}
            </View>
            <Text style={styles.agreeLabel}>
              I confirm I am <Text style={styles.bold}>18 years of age or older</Text>
            </Text>
          </Pressable>

          <Pressable style={styles.agree} onPress={() => setTermsChecked((v) => !v)}>
            <View style={[styles.box, termsChecked && styles.boxOn]}>
              {termsChecked && <Text style={styles.check}>✓</Text>}
            </View>
            <Text style={styles.agreeLabel}>
              I agree to the{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
                Terms
              </Text>{' '}
              &amp;{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
                Privacy Policy
              </Text>
            </Text>
          </Pressable>

          <Text style={styles.note}>Camera and notifications are asked for later, in context — not now.</Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.nav}>
        {step > 1 && (
          <Pressable style={styles.back} onPress={() => setStep((s) => (s - 1) as 1 | 2)}>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
        )}
        <View style={styles.nextWrap}>
          <PrimaryButton
            label={step === 3 ? 'Enter Philoi' : 'Continue'}
            loading={loading}
            disabled={step === 1 ? !canContinueStep1 : step === 2 ? !canContinueStep2 : !canContinueStep3}
            onPress={() => {
              if (step === 1) setStep(2);
              else if (step === 2) handleContinueStep2();
              else handleFinish();
            }}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
    paddingHorizontal: 15,
    paddingBottom: 14,
  },
  step: {
    flex: 1,
    minHeight: 0,
  },
  h: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 5,
    marginBottom: 16,
  },
  lbl: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 12,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  fieldInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13.5,
    color: Colors.ink,
  },
  pre: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.textTertiary,
  },
  ok: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  okText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.green,
  },
  taken: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 13,
    color: Colors.ink,
  },
  unilist: {
    marginTop: 8,
    flex: 1,
  },
  uni: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 2,
  },
  uniOn: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  uniIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uniIconOn: {
    backgroundColor: Colors.achieverBg,
  },
  uniName: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  consent: {
    backgroundColor: Colors.card,
    borderRadius: 13,
    padding: 13,
    marginBottom: 14,
  },
  consentText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.soloChipText,
    lineHeight: 18.75,
  },
  agree: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: Spacing.three,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  boxOn: {
    borderColor: Colors.coral,
    backgroundColor: Colors.coral,
  },
  check: {
    color: Colors.ink,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
  },
  agreeLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  bold: {
    fontFamily: Fonts.bodySemiBold,
  },
  link: {
    color: Colors.coral,
    textDecorationLine: 'underline',
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 12,
    lineHeight: 15.4,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    marginTop: Spacing.two,
  },
  nav: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  back: {
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
  },
  nextWrap: {
    flex: 1,
  },
});
