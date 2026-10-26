import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgramPicker } from '@/components/house/program-picker';
import { FirstRunSpine, SPINE_ROW_HEIGHT } from '@/components/tutorial/first-run-spine';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUniversities } from '@/lib/api/groups';
import { fetchProgramsForUniversity, setMyProgram } from '@/lib/api/house';
import { setMyIdentity } from '@/lib/api/identity';
import { getErrorMessage } from '@/lib/errors';
import { invalidateIdentityBadge } from '@/lib/house/identity-badges';
import { markOnboardingDone } from '@/lib/onboarding';
import { supabase } from '@/lib/supabase';
import { markTutorialDone } from '@/lib/tutorial';
import {
  findCachedUniversity,
  formatHintFor,
  resolveUniversityDomain,
  sampleEmailFor,
  shortSchoolName,
} from '@/lib/universities';
import type { ProgramRow } from '@/types/house';

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

// design-mocks/17-onboarding.html, reordered by design-mocks/239-tutorial-unified.html — all the
// onboarding steps live on this one screen, gated while `needsHandle || needsConsent` is true (see
// _layout.tsx). Keeping them in one component (rather than one route per step) is what lets
// Back actually work: it's just local `step` state, not navigation across a gate boundary a
// user shouldn't be able to re-enter once past it.
//
// ─────────────────────────────────── THE ORDER ───────────────────────────────────
//
//   1 username + display name, with the 18+/Terms consent folded into the bottom
//   2 who you are — what you wanna be, what you're working toward, what you're into (optional)
//   3 where you study   4 what you study (mock 291)
//
// …and then a patron claims you. The consent write at the end releases this screen, and _layout's
// ceremony gate takes a user with a program from Home straight into /house/claim ("You will represent
// <school> as a <program> student"). Nothing else sits in the run any more: the twenty-card tour is
// Settings → "Replay tutorial" only, and height, weight and campus verification moved out to the
// screens that already own them (body-metrics.tsx, campus.tsx) — setup asks only what the claim needs.
//
// Step 4 is Phase 1's PROGRAM field (ONBOARDING_FLOW_3phase.md) — data entry, not the ceremony. The
// program names the user's house (programs.patron_key); the patron is shown here only as what the
// pick implies, and it is revealed and pledged to in Phase 3 (/house/claim), the moment setup ends.
// The school comes FIRST because programs are listed per school (get_programs_for_university). The
// step is skipped entirely — not shown, not counted — when the school has no programs (today only
// Laurier and Waterloo have any), and quietly when the list can't be fetched (a server without 0257),
// since a missing house must never hold an account hostage. That user lands on Home and gets "Claim
// your house" later.
//
// 🔴 CONSENT IS ASKED ON STEP 1 BUT WRITTEN LAST. `has_consented` is what releases this gate — the
// moment it is true, _layout's Stack.Protected drops this screen. Writing it when step 1 is ticked
// would eject the user at the next profile refresh (step 1's own handle write) with who they are,
// their school and their program never asked. So step 1 only REQUIRES the two ticks; `enterPhiloi`
// writes them, from whichever step turns out to be the last one.
//
// The old standalone "Who sees your climb?" step is gone. `profiles.rank_visibility` defaults to
// 'public' in the column itself (0217), so dropping the screen changes nothing for a new account;
// the dial still lives in Settings.
//
// Step 2 is the OPTIONAL identity step (CODE_PROMPT_identity_profile.md "Onboarding tie-in", 0272):
// what you wanna be, what you're working toward, and up to eight interest tags (the same set
// /edit-identity edits) — so a new profile is never empty and grind-alike matching has something to
// read from day one. Second, straight after the name: it's about the person, and the school and
// program that follow are the paperwork the claim reads. "Skip for now" beside it. A failed save is
// swallowed: 0272 may not be live, and a headline must never hold an account hostage —
// /edit-identity and the profile's own prompt pick it up later.
type Step = 1 | 2 | 3 | 4;

/** The full run. A school with no programs drops the last step the moment that is known. */
const SETUP_STEPS = 4;

const PROGRAM_CONFIRM_NOTE = "Next, you'll meet your patron and pledge your loyalty.";

// The interest-tag limits, mirroring /edit-identity (and 0272's own checks).
const MAX_TAG = 24;
const MAX_TAGS = 8;

export default function SetupHandleScreen() {
  const { session, profile, refreshProfile } = useAuth();
  // Always step 1, even for a profile that already has a handle: the only account that reaches
  // this screen with one is a half-finished setup, and step 1 is where its consent is asked now.
  // The handle and name are pre-filled, so it costs one tap.
  const [step, setStep] = useState<Step>(1);

  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  // The last answered lookup, keyed by the handle it answered for. `availability` is DERIVED from it
  // below rather than set from the effect, so the effect only ever sets state from its async answer
  // (react-hooks/set-state-in-effect) and a stale answer for an older handle can never show.
  const [lookup, setLookup] = useState<{ handle: string; taken: boolean } | null>(null);

  const [universities, setUniversities] = useState<string[]>([]);
  const [universityQuery, setUniversityQuery] = useState('');
  const [university, setUniversity] = useState<string | null>(profile?.university ?? null);
  // Resolved the moment a school is tapped so the example@domain preview (mock 76A) is instant
  // for the ~20 cached schools; anything else falls back to Hipolabs in the background.
  const [universityDomain, setUniversityDomain] = useState<string | null>(profile?.university_domain ?? null);
  const [resolvingDomain, setResolvingDomain] = useState(false);

  const [ageChecked, setAgeChecked] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);

  // Each school's program list, keyed by name. Keyed (rather than one "current list") so a slow
  // answer for a school the user has since tapped away from can't overwrite the one they're on —
  // no effect-scoped cancel flag needed. An errored fetch is cached as [] — "no programs here".
  const [programsBySchool, setProgramsBySchool] = useState<Record<string, ProgramRow[]>>({});
  // The list step 4 is drawing, fixed when step 3 is left — so going Back and picking a different
  // school can't swap the picker's rows out from under it.
  const [programStep, setProgramStep] = useState<{ university: string; rows: ProgramRow[] } | null>(null);

  // Step 2's identity fields. Only non-empty ones are sent, so skipping — or re-entering setup
  // and leaving them blank — never clears anything saved since.
  const [careerGoal, setCareerGoal] = useState('');
  const [workingToward, setWorkingToward] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUniversities().then(setUniversities).catch(() => {});
  }, []);

  // Prefetch the moment a listed school is picked, so step 3's spine already knows whether a
  // program step is coming and the step itself opens with its list in hand.
  useEffect(() => {
    if (!university) return;
    loadPrograms(university);
    // loadPrograms is redefined every render; the worst a stale copy can do is miss the cache and
    // fetch once more, so the school is the only input that should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [university]);

  // Live "@handle available" check (PHILOI_UI_SPEC.md §21: "availability-checked and unique") —
  // debounced so we're not firing a query on every keystroke.
  useEffect(() => {
    const normalized = normalizeHandle(handle);
    if (normalized.length < 3) return;
    const timer = setTimeout(() => {
      supabase
        .from('profiles')
        .select('id')
        .eq('handle', normalized)
        .neq('id', session!.user.id)
        .maybeSingle()
        .then(({ data }) => setLookup({ handle: normalized, taken: Boolean(data) }));
    }, 400);
    return () => clearTimeout(timer);
  }, [handle, session]);

  const normalizedHandle = normalizeHandle(handle);
  const availability: Availability =
    normalizedHandle.length < 3
      ? 'idle'
      : lookup?.handle !== normalizedHandle
        ? 'checking'
        : lookup.taken
          ? 'taken'
          : 'available';
  // The consent gate is ASKED here (step 1) and written at the end — see the header.
  const consentChecked = ageChecked && termsChecked;
  const canContinueStep1 =
    normalizedHandle.length >= 3 && availability !== 'taken' && displayName.trim().length > 0 && consentChecked;

  const filteredUniversities = universities.filter((u) => u.toLowerCase().includes(universityQuery.toLowerCase()));
  // "not listed" fallback (PHILOI_UI_SPEC.md §21) — a school not yet seeded in the canonical
  // table can still be saved as free text rather than blocking onboarding.
  const notListed = universityQuery.trim().length > 0 && !universities.some((u) => u.toLowerCase() === universityQuery.trim().toLowerCase());
  // Not while the domain is still resolving: the school saves WITH its domain, which campus
  // verification (campus.tsx) reads later.
  const canContinueStudy = (Boolean(university) || notListed) && !resolvingDomain;
  // Known on step 3 only for a listed school whose prefetch has answered — the program step is last,
  // so nothing after it needs the answer fixed.
  const programsKnownAbsent = step === 3 && Boolean(university && programsBySchool[university]?.length === 0);
  const setupTotal = SETUP_STEPS - (programsKnownAbsent ? 1 : 0);

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

  /**
   * Save the handle and name, then on to who you are.
   *
   * Written HERE rather than with the school (where it used to ride) so a handle taken in the
   * meantime is reported on the step that owns the field, not three screens later. Safe to write
   * this early: it clears `needsHandle`, but `needsConsent` still holds the gate shut until
   * `enterPhiloi`.
   */
  async function handleContinueStep1() {
    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ handle: normalizedHandle, display_name: displayName.trim() })
      .eq('id', session!.user.id);

    if (updateError) {
      setError(updateError.code === '23505' ? 'That handle is taken — try another.' : updateError.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
    setStep(2);
  }

  /**
   * A school's programs, from the keyed cache or the server. Never throws: an error (offline, or a
   * server without get_programs_for_university) is cached as "no programs", which skips the step.
   */
  async function loadPrograms(name: string): Promise<ProgramRow[]> {
    const cached = programsBySchool[name];
    if (cached) return cached;
    let rows: ProgramRow[];
    try {
      rows = await fetchProgramsForUniversity(name);
    } catch (e) {
      console.warn('[onboarding] could not load programs — skipping the program step:', e);
      rows = [];
    }
    setProgramsBySchool((prev) => ({ ...prev, [name]: rows }));
    return rows;
  }

  /** Save the school, then pick a program — or, with none to pick, enter Philoi. */
  async function handleContinueStudy() {
    setLoading(true);
    setError(null);
    const resolvedUniversity = university ?? (universityQuery.trim() || null);
    // A free-text "not listed" school has no canonical domain, so it saves as null — verifiable
    // later only if it's added to the cache or Hipolabs knows it.
    const domain = university ? universityDomain : null;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ university: resolvedUniversity, university_domain: domain })
      .eq('id', session!.user.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    // A free-text school is looked up too — someone who typed Laurier's exact name still has a house.
    const rows = resolvedUniversity ? await loadPrograms(resolvedUniversity) : [];
    setProgramStep(resolvedUniversity && rows.length > 0 ? { university: resolvedUniversity, rows } : null);
    setLoading(false);
    if (rows.length > 0) setStep(4);
    else await enterPhiloi();
  }

  /**
   * Save the program, then enter Philoi — the patron claim follows from there.
   *
   * A failed save is NOT a dead end. The step is required only in the sense that a school with
   * programs doesn't offer a skip; letting a server error hold the whole account at step 4 would
   * make a house more load-bearing than the account. The miss is recoverable — the profile's
   * "Claim your house" card picks it up — so it warns and moves on.
   */
  async function handleConfirmProgram(program: ProgramRow) {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await setMyProgram(program.program_id);
      // The stack beside your own name ("Heir to Heracles · Kin · Laurier") is cached for 10 min.
      invalidateIdentityBadge(session.user.id);
      await refreshProfile();
    } catch (e) {
      console.warn('[onboarding] could not save program — continuing without one:', e);
    } finally {
      setLoading(false);
    }
    await enterPhiloi();
  }

  function addTag() {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag) return;
    // The server lowercases and dedupes too; doing it here keeps the chips honest about what saves.
    if (!interests.includes(tag) && interests.length < MAX_TAGS) setInterests([...interests, tag]);
    setTagDraft('');
  }

  /**
   * Save the identity fields, then on to where you study.
   *
   * Only what was answered is sent: an empty field is "not answered", not "clear it" — and a tag typed
   * but never "+ add"-ed still counts, since Continue is the obvious way to say "that one too". A
   * failed write is swallowed on purpose (see the header) — this is the optional step, and 0272 may
   * not be live.
   */
  async function handleContinueIdentity(persist: boolean) {
    const career = careerGoal.trim();
    const toward = workingToward.trim();
    const pending = tagDraft.trim().toLowerCase();
    const tags =
      pending && !interests.includes(pending) && interests.length < MAX_TAGS ? [...interests, pending] : interests;
    if (persist && (career || toward || tags.length > 0)) {
      setLoading(true);
      try {
        await setMyIdentity({
          ...(career ? { career_goal: career } : {}),
          ...(toward ? { working_toward: toward } : {}),
          ...(tags.length > 0 ? { interests: tags } : {}),
        });
      } catch (e) {
        console.warn('[onboarding] could not save identity — continuing without it:', e);
      } finally {
        setLoading(false);
      }
    }
    setStep(3);
  }

  /**
   * THE LAST WRITE — the consent ticked on step 1. This is what releases the gate: once the refresh
   * lands, _layout drops this screen onto Home, and its ceremony gate takes a user with a program
   * straight into the patron claim (/house/claim). One without stays on Home.
   */
  async function enterPhiloi() {
    if (!consentChecked || !session) return;
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
      // The flag _layout writes the instant this gate opens, written a beat early: its ceremony gate
      // waits on it, so having it already set is one fewer async hop spent on Home before the claim.
      await markOnboardingDone().catch(() => {});
      // The tour is offered from Settings now, never run here; marking it offered up front is what
      // lets the contextual coach-marks (which wait on this flag) speak from the first Home visit.
      await markTutorialDone(session.user.id).catch(() => {});
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your consent — try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen padded={false} style={styles.container}>
      {/* The same spine the tour draws (mock 239 "ONE SPINE"). Four until a school with no programs is
          picked — at which point the program step is known not to exist and stops being promised. */}
      <View style={styles.spineRow}>
        <FirstRunSpine total={setupTotal} filled={step} label={`SETUP ${step} / ${setupTotal}`} />
      </View>

      {step === 1 && (
        <View style={styles.step}>
          <Text style={styles.h}>Pick a username</Text>
          <Text style={styles.sub}>How your friends find you and your campfires know you. You can change it later.</Text>

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

          {/* The consent gate, folded in (mock 239). Required to continue; WRITTEN at the end — see
              the header for why it cannot be written here. */}
          <View style={styles.consentBlock}>
            <Pressable style={styles.agree} onPress={() => setAgeChecked((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: ageChecked }}>
              <View style={[styles.box, ageChecked && styles.boxOn]}>
                {ageChecked && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={styles.agreeLabel}>
                I confirm I am <Text style={styles.bold}>18 years of age or older</Text>
              </Text>
            </Pressable>

            <Pressable style={styles.agree} onPress={() => setTermsChecked((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: termsChecked }}>
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
                , including <Text style={styles.bold}>zero tolerance for objectionable content and abusive behaviour</Text>
              </Text>
            </Pressable>

            <Text style={styles.note}>
              We store your lock-ins, streaks and photos to run your campfires — and never sell your data. Camera and
              notifications are asked for later, in context.
            </Text>
          </View>
        </View>
      )}

      {step === 3 && (
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

      {/* What you study (mock 291) — only ever reached when the school has programs. The picker carries
          its own CTAs (a row tap picks; the confirm has "Looks right" / "Choose a different program"),
          so the shared nav keeps only Back here. Keyed by school so Back → a new school → Continue
          opens a fresh search rather than the last school's confirm. */}
      {step === 4 && programStep && (
        <View style={styles.step}>
          <ProgramPicker
            key={programStep.university}
            university={programStep.university}
            programs={programStep.rows}
            initialProgramId={profile?.program_id}
            onConfirm={(program) => void handleConfirmProgram(program)}
            saving={loading}
            confirmNote={PROGRAM_CONFIRM_NOTE}
          />
        </View>
      )}

      {/* OPTIONAL who-you-are (mock 283, CODE_PROMPT_identity_profile.md) — two fields, then the
          shared CTA. The prompt copy is the spec's: a statement of identity, not a form field. */}
      {step === 2 && (
        <View style={styles.step}>
          <Text style={styles.h}>What do you wanna be?</Text>
          <Text style={styles.sub}>What are you locking in for? It leads your profile — friends see it first.</Text>

          <Text style={styles.lbl}>What you wanna be</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.fieldInput}
              placeholder="future sports physio"
              placeholderTextColor={Colors.textTertiary}
              value={careerGoal}
              onChangeText={setCareerGoal}
              maxLength={60}
            />
          </View>

          <Text style={styles.lbl}>What are you working toward?</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.fieldInput}
              placeholder="first 100kg bench · ace orgo"
              placeholderTextColor={Colors.textTertiary}
              value={workingToward}
              onChangeText={setWorkingToward}
              maxLength={80}
            />
          </View>

          {/* What you're into — /edit-identity's tag picker, same limits, same save. */}
          <Text style={styles.lbl}>
            What you&apos;re into · {interests.length}/{MAX_TAGS}
          </Text>
          {interests.length > 0 && (
            <View style={styles.tags}>
              {interests.map((t) => (
                <Pressable
                  key={t}
                  style={styles.tag}
                  onPress={() => setInterests(interests.filter((x) => x !== t))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${t}`}>
                  <Text style={styles.tagText}>{t}</Text>
                  <Ionicons name="close" size={11} color={Colors.muted} />
                </Pressable>
              ))}
            </View>
          )}
          {interests.length < MAX_TAGS && (
            <View style={styles.field}>
              <TextInput
                style={styles.fieldInput}
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={addTag}
                placeholder="powerlifting, anatomy…"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                returnKeyType="done"
                submitBehavior="submit"
                maxLength={MAX_TAG}
              />
              <Pressable
                onPress={addTag}
                disabled={!tagDraft.trim()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add interest">
                <Text style={[styles.addTag, !tagDraft.trim() && styles.addTagOff]}>+ add</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.privacy}>
            <Ionicons name="people-outline" size={13} color={Colors.muted} />
            <Text style={styles.privacyText}>
              Friends-only to start. Change who sees it, or add more, from your profile anytime.
            </Text>
          </View>

          <Pressable
            onPress={() => void handleContinueIdentity(false)}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.skipStep}>
            <Text style={styles.skipStepText}>Skip for now</Text>
          </Pressable>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Step 4 carries its own CTAs (the picker's confirm has "Looks right" / "Choose a different
          program"), so the shared nav bar's primary sits it out — two competing primary buttons on
          one screen is how someone confirms without meaning to. Back still works. The identity
          step's Skip is a plain text link, not a second button, so it keeps the shared CTA. */}
      <View style={styles.nav}>
        {step > 1 && (
          <Pressable style={styles.back} onPress={() => setStep((s) => (s - 1) as Step)}>
            <Text style={styles.backLabel}>Back</Text>
          </Pressable>
        )}
        {step < 4 && (
          <View style={styles.nextWrap}>
            <PrimaryButton
              label={step === 3 && programsKnownAbsent ? 'Enter Philoi →' : 'Continue'}
              loading={loading}
              disabled={step === 1 ? !canContinueStep1 : step === 3 ? !canContinueStudy : false}
              onPress={() => {
                if (step === 1) handleContinueStep1();
                else if (step === 2) handleContinueIdentity(true);
                else handleContinueStudy();
              }}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Top and sides match tutorial.tsx's spine row exactly, so the spine does not move when the run
  // hands over from SETUP to TOUR.
  container: {
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
  },
  spineRow: {
    minHeight: SPINE_ROW_HEIGHT,
    justifyContent: 'center',
    marginBottom: 18,
  },
  consentBlock: {
    marginTop: 'auto',
    paddingTop: Spacing.three,
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
  // The identity step's "Skip for now" — a text link, not a second button.
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
  // The interest chips (edit-identity.tsx's), drawn in this screen's field colours.
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 7,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tagText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
  },
  addTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.amber,
  },
  addTagOff: {
    color: Colors.textTertiary,
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
