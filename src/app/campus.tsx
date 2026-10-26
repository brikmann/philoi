import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CampusVerification, CampusVerifiedPanel } from '@/components/campus-verification';
import { SettingsGlyph } from '@/components/ui/glyphs-settings';
import { Screen } from '@/components/ui/screen';
import { SpaceButton, SpaceCard, SpaceTile, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { saveUniversity } from '@/lib/api/campus-verification';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { fetchUniversities } from '@/lib/api/groups';
import { findCachedUniversity, resolveUniversityDomain, shortSchoolName } from '@/lib/universities';

// Settings → Campus (UNI_VERIFICATION_SPEC.md §6). Everything about the verified state lives
// here: what it is now, how to (re-)verify, and how to move schools — which deliberately drops
// the badge, since a verified address only proves the campus it belongs to.
export default function CampusScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();

  const [changingSchool, setChangingSchool] = useState(false);
  const [universities, setUniversities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const university = profile?.university ?? null;
  const domain = profile?.university_domain ?? null;
  const verified = profile?.university_email_verified ?? false;

  // Re-read the profile every time this screen comes into focus (punchlist 6 §1) so `verified`
  // is always the server's answer, never a value cached from an earlier session or account.
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      // refreshProfile is rebuilt on every AuthProvider render AND it setStates the profile, so
      // listing it would make this focus effect re-fire on its own result, forever.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  useEffect(() => {
    if (!changingSchool) return;
    fetchUniversities().then(setUniversities).catch(() => {});
  }, [changingSchool]);

  async function handlePickSchool(name: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const nextDomain = findCachedUniversity(name)?.domain ?? (await resolveUniversityDomain(name));
      await saveUniversity(session.user.id, name, nextDomain);
      // The profiles_reset_uni_verification trigger (0062) clears the badge server-side when the
      // stored email no longer belongs to the new school — so this re-read is what surfaces the
      // re-lock rather than the client guessing at it.
      await refreshProfile();
      setChangingSchool(false);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not change your school.'));
    } finally {
      setBusy(false);
    }
  }

  if (changingSchool) {
    return (
      // No bottom edge: the global footer owns the bottom inset.
      <Screen padded={false} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.h}>Change school</Text>
          <Text style={styles.sub}>
            Moving schools clears your verified badge — you&apos;ll re-verify with an email at the new campus.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.uniList}>
            {universities.map((name) => (
              <Pressable
                key={name}
                style={({ pressed }) => [styles.uni, name === university && styles.uniOn, pressed && styles.uniPressed]}
                disabled={busy}
                onPress={() => handlePickSchool(name)}
                accessibilityRole="button"
                accessibilityState={{ selected: name === university, disabled: busy }}>
                <Text style={styles.uniName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.uniDomain}>{findCachedUniversity(name)?.domain ?? '—'}</Text>
                {name === university && <UiGlyph name="check" size={16} color={Colors.navEmber} />}
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.secondary} onPress={() => setChangingSchool(false)} disabled={busy}>
            <Text style={styles.secondaryLabel}>Never mind</Text>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {!university ? (
          <>
            <SpaceTile tone="legend">
              <SettingsGlyph name="cap" size={18} color={Colors.legend} />
            </SpaceTile>
            <Text style={styles.h}>No school set</Text>
            <Text style={styles.sub}>Pick your school first — then you can verify it.</Text>
            <SpaceButton label="Choose a school" onPress={() => setChangingSchool(true)} />
          </>
        ) : verified ? (
          <>
            <CampusVerifiedPanel
              university={shortSchoolName(university)}
              onContinue={() => router.back()}
              continueLabel="Done"
              showChangeHint={false}
            />
            <SpaceCard style={styles.emailRow}>
              <SettingsGlyph name="mail" size={15} color={Colors.spaceDim} />
              <Text style={styles.emailText} numberOfLines={1}>
                {profile?.university_email}
              </Text>
            </SpaceCard>
            <Pressable style={styles.secondary} onPress={() => setChangingSchool(true)}>
              <Text style={styles.secondaryLabel}>Change school</Text>
            </Pressable>
          </>
        ) : !domain ? (
          <>
            <Text style={styles.h}>{shortSchoolName(university)}</Text>
            {/* Honest dead end rather than a Verify button that can only fail: nothing knows an
                email domain for this school, so there's nowhere to send a code. */}
            <Text style={styles.sub}>
              We don&apos;t know an email domain for {university} yet, so it can&apos;t be verified. My Uni and Vs
              Unis stay locked — everything else works normally.
            </Text>
            <Pressable style={styles.secondary} onPress={() => setChangingSchool(true)}>
              <Text style={styles.secondaryLabel}>Pick a different school</Text>
            </Pressable>
          </>
        ) : (
          <>
            <CampusVerification
              university={shortSchoolName(university)}
              domain={domain}
              verifyCtaLabel="Verify & unlock My Uni"
              onVerified={async () => {
                await refreshProfile();
                Alert.alert('Verified', `You're verified at ${shortSchoolName(university)} — the campus boards are unlocked.`);
                router.back();
              }}
            />
            <Pressable style={styles.secondary} onPress={() => setChangingSchool(true)}>
              <Text style={styles.secondaryLabel}>Wrong school? Change it</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    paddingHorizontal: SPACE_GUTTER,
    paddingVertical: Spacing.four,
  },
  h: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emailText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  uniList: {
    gap: 6,
  },
  uni: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    paddingVertical: 13,
    paddingHorizontal: Spacing.twelve,
  },
  uniOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  uniPressed: {
    opacity: 0.85,
  },
  uniName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  uniDomain: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  secondary: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  secondaryLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.navEmber2,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.danger,
  },
});
