import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ProgramPicker } from '@/components/house/program-picker';
import { Screen } from '@/components/ui/screen';
import { SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchProgramsForUniversity, setMyProgram } from '@/lib/api/house';
import { getErrorMessage } from '@/lib/errors';
import { invalidateIdentityBadge } from '@/lib/house/identity-badges';
import type { ProgramRow } from '@/types/house';

// ── CHANGE YOUR PROGRAM ──
//
// The one place outside onboarding where the program is picked (the profile's ✎ Edit sheet). Same
// ProgramPicker as onboarding's step 4, so the choice reads identically.
//
// Phase 9 (0293): the program is the pride badge and nothing more — it no longer grants a patron,
// so saving it never runs a ceremony. The patron is its own pick (/house/patron). `?then=claim`
// (an installed-build link from the old claim screen) still backs out to it.

type Load = { state: 'loading' } | { state: 'ready'; rows: ProgramRow[] } | { state: 'error'; message: string };

export default function ChangeProgramScreen() {
  const router = useRouter();
  const { then } = useLocalSearchParams<{ then?: string }>();
  const { session, profile, refreshProfile } = useAuth();
  const university = profile?.university ?? null;

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!university) return;
    let live = true;
    fetchProgramsForUniversity(university)
      .then((rows) => {
        if (live) setLoad({ state: 'ready', rows });
      })
      .catch((e) => {
        if (live) setLoad({ state: 'error', message: getErrorMessage(e, 'Could not load programs — try again.') });
      });
    return () => {
      live = false;
    };
  }, [university]);

  function leave() {
    // Backing out of a change the claim screen asked for goes back to the claim, not past it.
    if (then === 'claim') router.replace('/house/claim');
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function save(program: ProgramRow) {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      await setMyProgram(program.program_id);
      invalidateIdentityBadge(session.user.id);
      await refreshProfile();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your program — try again.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    leave();
  }

  // A school with no programs (only Laurier and Waterloo have them today), or no school at all.
  const empty =
    !university || (load.state === 'ready' && load.rows.length === 0) ? (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No programs at your school yet</Text>
        <Text style={styles.emptyBody}>
          {university
            ? `Programs are live at Laurier and Waterloo for now. ${university} is next — your patron doesn't need one.`
            : 'Add your school in your profile first — your program is picked from its list.'}
        </Text>
      </View>
    ) : null;

  return (
    // Top edge only: the global footer owns the bottom inset.
    <Screen padded={false} edges={['top']} style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SpaceHeader title="Your program" onBack={leave} />

      <View style={styles.body}>
        {empty ??
          (load.state === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.navEmber} />
            </View>
          ) : load.state === 'error' ? (
            <View style={styles.center}>
              <Text style={styles.emptyBody}>{load.message}</Text>
            </View>
          ) : (
            <ProgramPicker
              university={university!}
              programs={load.rows}
              currentProgramId={profile?.program_id}
              onConfirm={(p) => void save(p)}
              saving={saving}
              confirmLabel="Save program"
              title={profile?.program_id ? 'Change your program' : 'What do you study?'}
            />
          ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 14,
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: SPACE_GUTTER,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  emptyTitle: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
    marginTop: Spacing.two,
  },
});
