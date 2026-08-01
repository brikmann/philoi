import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CampusVerification, CampusVerifiedPanel } from '@/components/campus-verification';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
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
      <Screen>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.h}>Change school</Text>
          <Text style={styles.sub}>
            Moving schools clears your verified badge — you&apos;ll re-verify with an email at the new campus.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          {universities.map((name) => (
            <Pressable
              key={name}
              style={[styles.uni, name === university && styles.uniOn]}
              disabled={busy}
              onPress={() => handlePickSchool(name)}>
              <Text style={styles.uniName} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.uniDomain}>{findCachedUniversity(name)?.domain ?? '—'}</Text>
              {name === university && <Ionicons name="checkmark" size={16} color={Colors.coral} />}
            </Pressable>
          ))}
          <Pressable style={styles.secondary} onPress={() => setChangingSchool(false)} disabled={busy}>
            <Text style={styles.secondaryLabel}>Never mind</Text>
          </Pressable>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {!university ? (
          <>
            <Text style={styles.h}>No school set</Text>
            <Text style={styles.sub}>Pick your school first — then you can verify it.</Text>
            <Pressable style={styles.primary} onPress={() => setChangingSchool(true)}>
              <Text style={styles.primaryLabel}>Choose a school</Text>
            </Pressable>
          </>
        ) : verified ? (
          <>
            <CampusVerifiedPanel university={shortSchoolName(university)} />
            <View style={styles.emailRow}>
              <Ionicons name="mail" size={14} color={Colors.muted} />
              <Text style={styles.emailText} numberOfLines={1}>
                {profile?.university_email}
              </Text>
            </View>
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
    paddingVertical: Spacing.four,
  },
  h: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 22,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  emailText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
  uni: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: Spacing.three,
  },
  uniOn: {
    borderColor: Colors.coral,
  },
  uniName: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  uniDomain: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  primary: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  secondary: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
  },
  secondaryLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.coral,
  },
});
