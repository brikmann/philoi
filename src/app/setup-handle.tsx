import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { CampusVerification, CampusVerifiedPanel } from '@/components/campus-verification';
import { DEFAULT_HEIGHT_CM, HeightRuler } from '@/components/onboarding/height-ruler';
import { DEFAULT_WEIGHT_KG, WeightRuler, type WeightUnit } from '@/components/onboarding/weight-ruler';
import { OnboardingProgress } from '@/components/ui/onboarding-progress';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUniversities } from '@/lib/api/groups';
import { setMyHeightCm, setMyWeightKg } from '@/lib/api/relics';
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

// design-mocks/17-onboarding.html — all the onboarding steps (username, school, height, campus,
// consent) live on this one screen, gated while `needsHandle || needsConsent` is true (see
// _layout.tsx). Keeping them in one component (rather than one route per step) is what lets
// Back actually work: it's just local `step` state, not navigation across a gate boundary a
// user shouldn't be able to re-enter once past it.
//
// Step 3 is the OPTIONAL height estimate (design-mocks/128). Migration 0119 shipped the whole
// server half of this — the `height_cm` column, `stride_m_for` (height/100 × 0.42, falling back to
// a 0.75 m adult average) and the `set_my_height_cm` RPC — and its own header says "until the
// onboarding step collects one". Nothing ever did: `setMyHeightCm` in lib/api/relics.ts had zero
// call sites, so every user in the app is on the fallback stride and Noah's "height estimation
// didn't render" was simply a step that had never been built. Skippable by design, because the
// fallback is a real answer and the distance relic must not be gated behind a measurement.
//
// Step 4 is the OPTIONAL weight estimate (design-mocks/188) — the other half of the same
// question, and the one DIFFICULTY_SCOPING.md §"Fitness is IPSATIVE" has been waiting on. Height
// feeds a stride; weight is the DENOMINATOR Cindy scores a load goal against, so "squat 300" is
// read as ~1.9× a 160 lb lifter rather than as 300 raw pounds. Until this step existed the
// tutorial's Personal-goals card promised per-bodyweight scoring the app could not compute.
// Skippable for the same reason height is, though the fallback is worse: no weight means Cindy
// asks once or scores off the demographic anchors.
//
// Step 5 is the OPTIONAL campus verification (UNI_VERIFICATION_SPEC.md §5). It's skipped
// entirely — not shown, not counted — when the chosen school has no known email domain, since
// there's nothing to send a code to. Never a blocker either way: skipping just leaves the two
// campus boards locked.
type Step = 1 | 2 | 3 | 4 | 5 | 6;

export default function SetupHandleScreen() {
  const { session, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>(profile?.handle ? 6 : 1);

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

  // Pre-filled from the profile so re-entering onboarding shows what was saved rather than
  // resetting to the default and quietly re-writing it. `height_cm` is `numeric` server-side, so it
  // can come back as a string through PostgREST — coerced here, once, instead of inside the picker.
  const [heightCm, setHeightCm] = useState<number>(() => {
    const saved = Number(profile?.height_cm);
    return Number.isFinite(saved) && saved > 0 ? Math.round(saved) : DEFAULT_HEIGHT_CM;
  });
  const [heightTouched, setHeightTouched] = useState(false);

  // Same pre-fill rule as height, and the same `numeric`-through-PostgREST coercion. `weight_unit`
  // is a display preference rather than a second quantity — the stored figure is always kilograms —
  // so a returning user gets the ruler drawn in the unit they last chose, showing the value they
  // last saved.
  const [weightKg, setWeightKg] = useState<number>(() => {
    const saved = Number(profile?.weight_kg);
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WEIGHT_KG;
  });
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(profile?.weight_unit ?? 'lb');
  const [weightTouched, setWeightTouched] = useState(false);

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
  // The consent gate, on the last step — the two body-metric steps in between validate nothing.
  const canFinish = ageChecked && termsChecked;

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
    // Height is next for everyone — it depends on nothing and gates nothing.
    setStep(3);
  }

  /** Where the weight step leads. No domain → nothing to verify against, so don't show a step
   * that can only dead-end. Height always leads to weight: the two are one question. */
  const afterWeight: Step = universityDomain ? 5 : 6;

  /**
   * Save the height and move on.
   *
   * SKIPPING IS A REAL PATH, not a shortcut past a required field: with no height the server uses
   * a 0.75 m adult-average stride (0119), so the cost is accuracy on one relic ladder and nothing
   * else. `heightTouched` is what tells the two apart — an untouched picker sitting on its default
   * is not a measurement, and writing it would turn "I skipped" into a claim about the user's body.
   *
   * A failed write is swallowed on purpose. This is the optional step; blocking onboarding on it
   * would make an estimate more load-bearing than the account itself, and Settings can set a
   * height later.
   */
  async function handleContinueHeight(persist: boolean) {
    if (persist && heightTouched) {
      setLoading(true);
      try {
        await setMyHeightCm(heightCm);
        await refreshProfile();
      } catch (e) {
        console.warn('[onboarding] could not save height:', e);
      } finally {
        setLoading(false);
      }
    }
    setStep(4);
  }

  /**
   * Save the weight and move on.
   *
   * SAME SKIP CONTRACT AS HEIGHT, and it matters more here. `weightTouched` is set only by a
   * SCROLL — WeightRuler reports a unit switch with source 'unit' precisely so that toggling
   * lb⇄kg out of curiosity cannot turn the default 160 lb into a claim about this person's body.
   * A skipped weight is a real, supported state: Cindy asks once or scopes off the demographic
   * anchors (DIFFICULTY_SCOPING.md), which is worse than knowing but is never wrong.
   *
   * The unit IS written even on an untouched step, because a unit preference is a statement about
   * how the user reads numbers rather than about their body — and it is what makes Settings open
   * in kg for someone who never gave us a weight at all.
   *
   * A failed write is swallowed for the same reason height's is: this is the optional step, and
   * blocking onboarding on it would make an estimate more load-bearing than the account.
   */
  async function handleContinueWeight(persist: boolean) {
    if (persist && weightTouched) {
      setLoading(true);
      try {
        await setMyWeightKg(weightKg, weightUnit);
        await refreshProfile();
      } catch (e) {
        console.warn('[onboarding] could not save weight:', e);
      } finally {
        setLoading(false);
      }
    }
    setStep(afterWeight);
  }

  async function handleFinish() {
    if (!canFinish || !session) return;
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
      {/* Six segments only when verification is actually on this user's path — a school with no
          domain never sees that step, so showing a sixth dot would promise one that never comes.
          Both body-metric steps are on everyone's path, so they always count. */}
      <OnboardingProgress step={step} total={universityDomain ? 6 : 5} />

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

      {/* OPTIONAL height (design-mocks/128, recopied by 188). Framed as what it actually does —
          it estimates a stride so walking can be scored in kilometres — and never as a
          requirement, because the server has a perfectly good default for anyone who walks past
          it. Mock 188 names the second use too, so the pair of steps reads as one question. */}
      {step === 3 && (
        <View style={styles.step}>
          <Text style={styles.h}>How tall are you?</Text>
          <Text style={styles.sub}>
            Turns your steps into kilometres — and helps Cindy scope your fitness goals fairly.
          </Text>

          <View style={styles.rulerPicker}>
            <HeightRuler
              value={heightCm}
              onChange={(cm) => {
                setHeightCm(cm);
                setHeightTouched(true);
              }}
            />
          </View>

          <Pressable
            onPress={() => handleContinueHeight(false)}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.skipStep}>
            <Text style={styles.skipStepText}>Skip — we&apos;ll use an average</Text>
          </Pressable>
        </View>
      )}

      {/* OPTIONAL weight (design-mocks/188) — the ipsative denominator.
          The subtitle says what it BUYS the user ("a big lift means more, the lighter you are")
          rather than what we do with it, because the honest objection to being asked your weight
          is "why do you want it", and DIFFICULTY_SCOPING.md is explicit that this ethos has to be
          said out loud everywhere goal-setting happens rather than buried in a privacy policy. */}
      {step === 4 && (
        <View style={styles.step}>
          <Text style={styles.h}>And your weight?</Text>
          <Text style={styles.sub}>
            So Cindy scores your fitness goals fairly — a big lift means more, the lighter you are.
          </Text>

          <View style={styles.rulerPicker}>
            <WeightRuler
              value={weightKg}
              unit={weightUnit}
              onUnitChange={setWeightUnit}
              onChange={(kg, source) => {
                setWeightKg(kg);
                // Only a scroll is a measurement. A unit switch moves the value to stay on a tick
                // and must not count as one — see handleContinueWeight.
                if (source === 'scroll') setWeightTouched(true);
              }}
            />
          </View>

          {/* The promise this screen has to make to earn the answer, and it is exactly the promise
              the app keeps: no profile surface renders weight, and no reward path can read it. */}
          <View style={styles.privacy}>
            <Ionicons name="lock-closed" size={13} color={Colors.muted} />
            <Text style={styles.privacyText}>
              Private — only used to scope your goals. Never shown on your profile. Edit anytime in
              Settings.
            </Text>
          </View>

          <Pressable
            onPress={() => handleContinueWeight(false)}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.skipStep}>
            <Text style={styles.skipStepText}>Skip for now</Text>
          </Pressable>
        </View>
      )}

      {/* OPTIONAL campus verification (§5). Only ever reached when the school has a domain. */}
      {step === 5 && university && universityDomain && (
        <View style={styles.step}>
          {campusVerified ? (
            <CampusVerifiedPanel
              university={shortSchoolName(university)}
              onContinue={() => setStep(6)}
              continueLabel="Continue"
            />
          ) : (
            <CampusVerification
              university={shortSchoolName(university)}
              domain={universityDomain}
              verifyCtaLabel="Verify & unlock My Uni"
              onSkip={() => setStep(6)}
              onVerified={async () => {
                await refreshProfile();
              }}
            />
          )}
        </View>
      )}

      {step === 6 && (
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

      {/* Step 5 carries its own CTAs (Send code / Verify / Skip), so the shared nav bar sits it
          out entirely — two competing primary buttons on one screen is how someone taps
          "Continue" and skips verification without meaning to. Back still works.
          The two rulers' Skips are plain text links, not second buttons, so they keep the
          shared CTA. */}
      <View style={styles.nav}>
        {step > 1 && (
          <Pressable
            style={styles.back}
            onPress={() =>
              // Step 5 only exists for a school with a domain, so stepping back from consent has
              // to skip over it when there isn't one — otherwise Back lands on a blank screen.
              setStep((s) => (s === 6 && !universityDomain ? 4 : ((s - 1) as Step)))
            }>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
        )}
        {step !== 5 && (
          <View style={styles.nextWrap}>
            <PrimaryButton
              label={step === 6 ? 'Enter Philoi' : 'Continue'}
              loading={loading}
              // Steps 3 and 4 have nothing to validate — every position on either ruler is inside
              // its column's range by construction, and both are skippable, so neither is ever
              // disabled.
              disabled={
                step === 1
                  ? !canContinueStep1
                  : step === 2
                    ? !canContinueStep2
                    : step === 3 || step === 4
                      ? false
                      : !canFinish
              }
              onPress={() => {
                if (step === 1) setStep(2);
                else if (step === 2) handleContinueStep2();
                else if (step === 3) handleContinueHeight(true);
                else if (step === 4) handleContinueWeight(true);
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
  // Either ruler takes the whole middle of its step and centres itself in it (the `.picker` in
  // mocks 128 and 188), so the readout sits at eye level rather than pinned under the question.
  rulerPicker: {
    flex: 1,
    justifyContent: 'center',
  },
  // Shared by both rulers — the height step and the weight step are the same layout with a
  // different question, and mock 188 draws them as a pair.
  skipStep: {
    alignSelf: 'center',
    paddingVertical: Spacing.twelve,
  },
  skipStepText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  // Mock 188's lock chip. Sits under the ruler and above the CTA, so the promise is on screen at
  // the moment the answer is given rather than one tap earlier.
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.input,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginTop: Spacing.four,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 14,
    color: Colors.muted,
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
