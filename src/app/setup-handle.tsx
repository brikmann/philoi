import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CampusVerification, CampusVerifiedPanel } from '@/components/campus-verification';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUniversities } from '@/lib/api/groups';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import {
  findCachedUniversity,
  formatHintFor,
  resolveUniversityDomain,
  sampleEmailFor,
  shortSchoolName,
} from '@/lib/universities';

const CONSENT_VERSION = '2026-06-30';
const PRIVACY_URL = 'https://philoi.app/privacy.html';
const TERMS_URL = 'https://philoi.app/terms.html';

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
// Step 3 is the OPTIONAL campus verification (UNI_VERIFICATION_SPEC.md §5). It's skipped
// entirely — not shown, not counted — when the chosen school has no known email domain, since
// there's nothing to send a code to. Never a blocker either way: skipping just leaves the two
// campus boards locked.
type Step = 1 | 2 | 3 | 4;

export default function SetupHandleScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>(profile?.handle ? 4 : 1);

  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [availability, setAvailability] = useState<Availability>('idle');

  const [universities, setUniversities] = useState<string[]>([]);
  const [universityQuery, setUniversityQuery] = useState('');
  const [university, setUniversity] = useState<string | null>(profile?.university ?? null);
  // Resolved the moment a school is tapped so the example@domain preview (mock 76A) is instant
  // for the ~20 cached schools; anything else falls back to Hipolabs in the background.
  const [universityDomain, setUniversityDomain] = useState<string | null>(profile?.university_domain ?? null);
  const [resolvingDomain, setResolvingDomain] = useState(false);

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

  // Strictly the live server flag (punchlist 6 §1) — there is no local "just verified" state to
  // go stale. The school has to match too: the flag on the profile belongs to the school stored
  // WITH it, so a user who backs up and picks a different school at step 2 must see the verify
  // form for the new one, not a badge earned at the old one.
  const campusVerified = Boolean(profile?.university_email_verified && profile?.university === university);

  // Only the cached schools can show a domain without a network call. Anything else shows "—",
  // which is honest: we don't know it yet, and it's resolved on select if Hipolabs does.
  function domainForRow(name: string): string {
    if (name === university && universityDomain) return universityDomain;
    return findCachedUniversity(name)?.domain ?? '—';
  }

  // Resolve the school's email domain as soon as one is picked. Cached schools answer
  // synchronously (no spinner, no wait); anything else asks Hipolabs. A null result is not an
  // error — it just means this school can't be verified, which skips the verify step entirely.
  async function pickUniversity(name: string) {
    setUniversity(name);
    setUniversityQuery(name);
    const cached = findCachedUniversity(name);
    if (cached) {
      setUniversityDomain(cached.domain);
      return;
    }
    setUniversityDomain(null);
    setResolvingDomain(true);
    try {
      setUniversityDomain(await resolveUniversityDomain(name));
    } finally {
      setResolvingDomain(false);
    }
  }

  async function handleContinueStep2() {
    setLoading(true);
    setError(null);
    const resolvedUniversity = university ?? (universityQuery.trim() || null);
    // A free-text "not listed" school has no canonical domain, so it saves as null — verifiable
    // later only if it's added to the cache or Hipolabs knows it.
    const domain = university ? universityDomain : null;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        handle: normalizedHandle,
        display_name: displayName.trim(),
        university: resolvedUniversity,
        university_domain: domain,
      })
      .eq('id', session!.user.id);

    if (updateError) {
      setError(updateError.code === '23505' ? 'That handle is taken — try another.' : updateError.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
    // No domain → nothing to verify against, so don't show a step that can only dead-end.
    setStep(domain ? 3 : 4);
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
      {/* Four segments only when verification is actually on this user's path — a school with no
          domain never sees that step, so showing a fourth dot would promise one that never comes. */}
      <OnboardingProgress step={step} total={universityDomain ? 4 : 3} />

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
                <Pressable style={[styles.uni, on && styles.uniOn]} onPress={() => pickUniversity(item)}>
                  <View style={[styles.uniIcon, on && styles.uniIconOn]}>
                    <Ionicons name="business-outline" size={14} color={on ? Colors.amber : Colors.muted} />
                  </View>
                  <Text style={styles.uniName} numberOfLines={1}>
                    {item}
                  </Text>
                  {/* The real domain, straight from the cache (mock 75A's right-hand column) —
                      "—" for a school nobody knows an address format for, which reads as
                      "can't verify this one" rather than looking broken. */}
                  <Text style={styles.uniDomain}>{domainForRow(item)}</Text>
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

          {/* Live example@domain the moment a school is picked (mock 76A) — so it's obvious
              WHICH address to reach for before the email field ever appears. */}
          {university && (universityDomain || resolvingDomain) && (
            <View style={styles.preview}>
              <Text style={styles.previewLabel}>
                Your {shortSchoolName(university)} email looks like
              </Text>
              {resolvingDomain ? (
                <Text style={styles.previewSample}>checking…</Text>
              ) : (
                <>
                  <Text style={styles.previewSample}>
                    {sampleEmailFor({ domain: universityDomain!, formatHint: formatHintFor(university) ?? undefined })}
                  </Text>
                  {formatHintFor(university) && (
                    <Text style={styles.previewHint}>
                      Format: {formatHintFor(university)}. Not sure? Just enter the email you actually use — the
                      code confirms it.
                    </Text>
                  )}
                </>
              )}
            </View>
          )}
        </View>
      )}

      {/* OPTIONAL campus verification (§5). Only ever reached when the school has a domain. */}
      {step === 3 && university && universityDomain && (
        <View style={styles.step}>
          {campusVerified ? (
            <CampusVerifiedPanel
              university={shortSchoolName(university)}
              onContinue={() => setStep(4)}
              continueLabel="Continue"
            />
          ) : (
            <CampusVerification
              university={shortSchoolName(university)}
              domain={universityDomain}
              verifyCtaLabel="Verify & unlock My Uni"
              onSkip={() => setStep(4)}
              onVerified={async () => {
                await refreshProfile();
              }}
            />
          )}
        </View>
      )}

      {step === 4 && (
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

      {/* Step 3 carries its own CTAs (Send code / Verify / Skip), so the shared nav bar sits it
          out entirely — two competing primary buttons on one screen is how someone taps
          "Continue" and skips verification without meaning to. Back still works. */}
      <View style={styles.nav}>
        {step > 1 && (
          <Pressable
            style={styles.back}
            onPress={() =>
              // Step 3 only exists for a school with a domain, so stepping back from consent has
              // to skip over it when there isn't one — otherwise Back lands on a blank screen.
              setStep((s) => (s === 4 && !universityDomain ? 2 : ((s - 1) as Step)))
            }>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
        )}
        {step !== 3 && (
          <View style={styles.nextWrap}>
            <PrimaryButton
              label={step === 4 ? 'Enter Philoi' : 'Continue'}
              loading={loading}
              disabled={step === 1 ? !canContinueStep1 : step === 2 ? !canContinueStep2 : !canContinueStep3}
              onPress={() => {
                if (step === 1) setStep(2);
                else if (step === 2) handleContinueStep2();
                else handleFinish();
              }}
            />
          </View>
        )}
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
  uniDomain: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  preview: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 4,
    marginTop: Spacing.two,
  },
  previewLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  previewSample: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.amber,
  },
  previewHint: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15.5,
    color: Colors.textTertiary,
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
