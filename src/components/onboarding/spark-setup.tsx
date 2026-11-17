import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FirstRunSpine, SPINE_ROW_HEIGHT } from '@/components/tutorial/first-run-spine';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { Colors, EMBER_GRADIENT, Fonts, Spacing } from '@/constants/theme';
import { fetchUniversities } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { markInterestsPending } from '@/lib/interests-flow';
import { CONSENT_VERSION, markOnboardingDone, PRIVACY_URL, TERMS_URL } from '@/lib/onboarding';
import { supabase } from '@/lib/supabase';
import { markTutorialDone } from '@/lib/tutorial';
import { findCachedUniversity, resolveUniversityDomain } from '@/lib/universities';

// ─────────────────────────── GYM SPARK · SETUP 1 of 2 (mock 404) ───────────────────────────
//
// Username + availability, display name, school, one 18+/Terms tick, Continue — one page. Rendered
// by app/setup-handle.tsx when GYM_SPARK is on; the legacy five-step run lives there unchanged.
//
// ONE WRITE, AND IT IS THE LAST ONE. Handle, name, school and consent go up in a single profiles
// update. `has_consented` is what releases setup-handle's Stack.Protected gate (needsConsent), so
// writing it together with everything else is what makes this page atomic: a taken handle (23505)
// writes nothing, and a success drops the user onto `/` with every field in place. The same three
// first-run flags the legacy `enterPhiloi` sets are set here, before the refresh that opens the
// gate — onboarding done, the tour marked offered (it's replay-only), and interests PENDING, which
// is what makes _layout's interests gate send `/` on to /interests: setup page 2 of 2.
//
// The keyboard: everything — Continue included — lives in one ScrollView inside Screen's
// KeyboardAvoidingView, so the button always sits BELOW the consent line in flow and can never be
// drawn over the Terms text, on a small screen or with the keyboard up.

function normalizeHandle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

type Availability = 'idle' | 'checking' | 'available' | 'taken';

/** How many school matches to list under the search at once — the list lives inside the page scroll. */
const MAX_UNI_ROWS = 6;

export function SparkSetupScreen() {
  const { session, profile, refreshProfile } = useAuth();

  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  // The last answered lookup, keyed by the handle it answered for — `availability` is derived, so a
  // stale answer for an older handle can never show (same shape as the legacy screen).
  const [lookup, setLookup] = useState<{ handle: string; taken: boolean } | null>(null);

  const [universities, setUniversities] = useState<string[]>([]);
  const [universityQuery, setUniversityQuery] = useState('');
  const [university, setUniversity] = useState<string | null>(profile?.university ?? null);
  const [universityDomain, setUniversityDomain] = useState<string | null>(profile?.university_domain ?? null);
  const [resolvingDomain, setResolvingDomain] = useState(false);
  // Searching shows the list; a picked school collapses to the selected card (tap it to change).
  const [searching, setSearching] = useState(!profile?.university);

  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUniversities().then(setUniversities).catch(() => {});
  }, []);

  // Live "@handle available" — debounced so it isn't a query per keystroke.
  useEffect(() => {
    const normalized = normalizeHandle(handle);
    if (normalized.length < 3 || !session) return;
    const timer = setTimeout(() => {
      supabase
        .from('profiles')
        .select('id')
        .eq('handle', normalized)
        .neq('id', session.user.id)
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

  const q = universityQuery.trim().toLowerCase();
  const matches = q === '' ? [] : universities.filter((u) => u.toLowerCase().includes(q)).slice(0, MAX_UNI_ROWS);
  // "Not listed" — a school not yet seeded can still be saved as free text rather than blocking setup.
  const notListed = q !== '' && !universities.some((u) => u.toLowerCase() === q);
  const schoolChosen = !searching && (Boolean(university) || universityQuery.trim().length > 0);

  const canContinue =
    normalizedHandle.length >= 3 &&
    availability !== 'taken' &&
    displayName.trim().length > 0 &&
    schoolChosen &&
    !resolvingDomain &&
    agreed;

  async function pickUniversity(name: string) {
    setUniversity(name);
    setUniversityQuery(name);
    setSearching(false);
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

  function chooseUnlisted() {
    setUniversity(null);
    setUniversityDomain(null);
    setSearching(false);
  }

  async function handleContinue() {
    if (!session || !canContinue) return;
    setLoading(true);
    setError(null);
    const resolvedUniversity = university ?? (universityQuery.trim() || null);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          handle: normalizedHandle,
          display_name: displayName.trim(),
          university: resolvedUniversity,
          // A free-text school has no canonical domain; campus verification reads this later.
          university_domain: university ? universityDomain : null,
          has_consented: true,
          consented_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
        })
        .eq('id', session.user.id);
      if (updateError) {
        setError(updateError.code === '23505' ? 'That username is taken — try another.' : updateError.message);
        return;
      }
      await markOnboardingDone().catch(() => {});
      await markTutorialDone(session.user.id).catch(() => {});
      await markInterestsPending(session.user.id).catch(() => {});
      // Opens the gate: _layout drops this screen onto `/`, whose interests gate opens page 2.
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save — try again.'));
    } finally {
      setLoading(false);
    }
  }

  const selectedDomain = university ? (universityDomain ?? (resolvingDomain ? 'checking…' : null)) : null;

  return (
    <Screen padded={false} style={styles.container}>
      <View style={styles.spineRow}>
        <FirstRunSpine total={2} filled={1} label="SETUP · 1 of 2" />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text style={styles.h}>Set up your profile</Text>
        <Text style={styles.sub}>Your name and school. You can change it later.</Text>

        <Text style={styles.lbl}>Username</Text>
        <View style={styles.field}>
          <Text style={styles.pre}>@</Text>
          <TextInput
            style={styles.fieldInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="jordan23"
            placeholderTextColor={Colors.spaceFaint}
            value={handle}
            onChangeText={setHandle}
            maxLength={20}
            accessibilityLabel="Username"
          />
          {availability === 'available' ? (
            <View style={styles.ok}>
              <Ionicons name="checkmark" size={12} color={Colors.green} />
              <Text style={styles.okText}>available</Text>
            </View>
          ) : availability === 'taken' ? (
            <Text style={styles.taken}>taken</Text>
          ) : null}
        </View>

        <Text style={styles.lbl}>Display name</Text>
        <View style={styles.field}>
          <TextInput
            style={styles.fieldInput}
            placeholder="Jordan Lee"
            placeholderTextColor={Colors.spaceFaint}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
            accessibilityLabel="Display name"
          />
        </View>

        <Text style={styles.lbl}>University</Text>
        {schoolChosen ? (
          <Pressable
            style={[styles.field, styles.uniPicked]}
            onPress={() => setSearching(true)}
            accessibilityRole="button"
            accessibilityLabel={`University, ${university ?? universityQuery.trim()}. Tap to change`}>
            <Ionicons name="business-outline" size={18} color={Colors.navEmber2} />
            <Text style={styles.uniPickedName} numberOfLines={1}>
              {university ?? universityQuery.trim()}
            </Text>
            {selectedDomain ? (
              <Text style={styles.uniDomain} numberOfLines={1}>
                {selectedDomain}
              </Text>
            ) : null}
          </Pressable>
        ) : (
          <>
            <View style={styles.field}>
              <Ionicons name="search" size={15} color={Colors.spaceDim} />
              <TextInput
                style={styles.fieldInput}
                placeholder="Search your university"
                placeholderTextColor={Colors.spaceFaint}
                value={universityQuery}
                onChangeText={(text) => {
                  setUniversity(null);
                  setUniversityQuery(text);
                }}
                autoCorrect={false}
                maxLength={80}
                accessibilityLabel="Search your university"
              />
            </View>
            {matches.length > 0 || notListed ? (
              <View style={styles.uniList}>
                {matches.map((name) => (
                  <Pressable
                    key={name}
                    style={({ pressed }) => [styles.uniRow, pressed && styles.pressed]}
                    onPress={() => void pickUniversity(name)}
                    accessibilityRole="button">
                    <Ionicons name="business-outline" size={14} color={Colors.spaceDim} />
                    <Text style={styles.uniName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.uniDomain} numberOfLines={1}>
                      {findCachedUniversity(name)?.domain ?? ''}
                    </Text>
                  </Pressable>
                ))}
                {notListed ? (
                  <Pressable
                    style={({ pressed }) => [styles.uniRow, pressed && styles.pressed]}
                    onPress={chooseUnlisted}
                    accessibilityRole="button">
                    <Ionicons name="add" size={14} color={Colors.spaceDim} />
                    <Text style={styles.uniName} numberOfLines={1}>
                      Use &quot;{universityQuery.trim()}&quot; (not listed)
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        {/* One tick for both: 18+ and the Terms & Privacy, with the zero-tolerance line App Review
            requires for user content kept right under it. */}
        <Pressable
          style={styles.agree}
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I'm 18 or older and agree to the Terms and Privacy Policy">
          <View style={[styles.box, agreed && styles.boxOn]}>
            {agreed ? <Ionicons name="checkmark" size={15} color={INK_ON_EMBER} /> : null}
          </View>
          <Text style={styles.agreeLabel}>
            I&apos;m 18+ and agree to the{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
              Terms
            </Text>{' '}
            &amp;{' '}
            <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Privacy
            </Text>
          </Text>
        </Pressable>
        <Text style={styles.note}>Zero tolerance for objectionable content or abusive behaviour.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.cta}>
          <PrimaryButton label="Continue" loading={loading} disabled={!canContinue} onPress={() => void handleContinue()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** The near-black ink the ember fill takes (PrimaryButton's label colour). */
const INK_ON_EMBER = '#160d26';

const styles = StyleSheet.create({
  // Same frame as interests.tsx, so the spine doesn't move when page 1 hands over to page 2.
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
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: Spacing.four,
  },
  h: {
    fontFamily: Fonts.black,
    fontSize: 24,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    marginTop: 4,
    marginBottom: 6,
  },
  lbl: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.spaceDim,
    marginTop: 14,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: 'rgba(26,18,48,0.5)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  fieldInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 14,
    color: Colors.ink,
  },
  pre: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.spaceDim,
  },
  ok: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  okText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.green,
  },
  taken: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.coral,
  },
  uniPicked: {
    borderColor: 'rgba(255,176,90,0.4)',
    backgroundColor: 'rgba(255,122,47,0.08)',
    gap: 10,
  },
  uniPickedName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  uniList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    overflow: 'hidden',
  },
  uniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.spaceLine,
  },
  pressed: {
    backgroundColor: Colors.spacePanel2,
  },
  uniName: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  uniDomain: {
    flexShrink: 0,
    maxWidth: 120,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  agree: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  boxOn: {
    borderColor: EMBER_GRADIENT[1],
    backgroundColor: EMBER_GRADIENT[1],
  },
  agreeLabel: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
  },
  link: {
    fontFamily: Fonts.bodyBold,
    color: Colors.navEmber2,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.spaceFaint,
    marginTop: 6,
    marginLeft: 32,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    marginTop: Spacing.twelve,
  },
  cta: {
    marginTop: 18,
  },
});
