import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import {
  clearFocusNudgeApps,
  focusNudgeAuthorization,
  focusNudgeSelectionCounts,
  focusNudgeSelectionSize,
  focusNudgeSupported,
  isFocusNudgeEnabled,
  pickFocusNudgeApps,
  requestFocusNudgeAuthorization,
  setFocusNudgeEnabled,
  type FocusNudgeAuthorizationStatus,
  type FocusNudgeSelectionCounts,
} from '@/lib/focus-nudge';

// Focus Nudge setup — mock 109 frame 1, APP_BLOCKER_SPEC §A.
//
// Three steps and nothing else: grant Screen Time access, pick what to guard, choose whether it
// arms automatically. There are no consequences to configure, because there are none — this is a
// warm interstitial you can always walk through, not a blocker (§"What this model drops").
//
// Every state on this screen degrades to "the feature is off", never to an error and never to
// something that stops you locking in (§"Edge cases"). That includes Android, which has no Family
// Controls at all and gets an honest "iOS only for now" rather than a dead toggle.

export default function FocusNudgeScreen() {
  const supported = focusNudgeSupported();

  const [status, setStatus] = useState<FocusNudgeAuthorizationStatus>('notDetermined');
  const [counts, setCounts] = useState<FocusNudgeSelectionCounts>({
    applications: 0,
    categories: 0,
    webDomains: 0,
  });
  const [autoArm, setAutoArm] = useState(true);
  const [requesting, setRequesting] = useState(false);

  // Re-read on every focus rather than once on mount: Screen Time access can be revoked in
  // Settings while the app is backgrounded, and coming back to a screen that still claims
  // "Granted" is how you end up debugging a shield that was never going to appear.
  useFocusEffect(
    useCallback(() => {
      if (!supported) return;
      setStatus(focusNudgeAuthorization());
      setCounts(focusNudgeSelectionCounts());
      isFocusNudgeEnabled().then(setAutoArm);
    }, [supported])
  );

  const picked = focusNudgeSelectionSize(counts);
  const granted = status === 'approved';

  async function handleGrant() {
    setRequesting(true);
    const next = await requestFocusNudgeAuthorization();
    setRequesting(false);
    setStatus(next);
    track('focus_nudge_permission', { granted: next === 'approved' });
  }

  async function handlePick() {
    const next = await pickFocusNudgeApps();
    setCounts(next);
    // The COUNT only. Apple's tokens are opaque by design and we never resolve one to an app
    // identity — so this is the most the analytics layer can ever be told, and that is the point.
    track('focus_nudge_apps_picked', { count: focusNudgeSelectionSize(next) });
  }

  function handleClear() {
    clearFocusNudgeApps();
    setCounts(focusNudgeSelectionCounts());
  }

  function handleToggleAuto(value: boolean) {
    setAutoArm(value);
    setFocusNudgeEnabled(value);
    track('focus_nudge_auto_toggled', { enabled: value });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Ionicons name="heart-circle-outline" size={54} color={Colors.amber} />
          <Text style={styles.heroTitle}>A gentle pull back, not a wall</Text>
          <Text style={styles.heroBody}>
            Drift to a distracting app mid-session and Philoi will nudge you — warmly. You can always
            continue; it&apos;s a tap on the shoulder, not a lock.
          </Text>
        </View>

        {!supported ? (
          // Honest rather than hopeful. Android detection needs UsageStats plus a foreground
          // service and is its own build (FOCUS_NUDGE_SETUP.md B.5); an older iOS binary simply
          // does not have the extensions compiled in. Both are "not here yet", not "broken".
          <View style={styles.group}>
            <View style={styles.rowLast}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.muted} style={styles.rowIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Not available on this device yet</Text>
                <Text style={styles.rowDescription}>
                  {Platform.OS === 'ios'
                    ? 'Update to the latest Philoi build to turn Focus Nudge on.'
                    : 'Focus Nudge is iOS-only for now — the Android version is on the way.'}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* STEP 1 — permission. */}
            <Text style={styles.sectionLabel}>PERMISSION</Text>
            <View style={styles.group}>
              <Pressable
                style={styles.rowLast}
                disabled={granted || requesting}
                onPress={handleGrant}
                accessibilityRole="button"
                accessibilityLabel="Grant Screen Time access">
                <Ionicons
                  name={granted ? 'checkmark-circle' : 'time-outline'}
                  size={18}
                  color={granted ? Colors.green : Colors.amber}
                  style={styles.rowIcon}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Screen Time access</Text>
                  <Text style={styles.rowDescription}>
                    {granted
                      ? 'Granted — lets Philoi show the nudge over your picked apps'
                      : status === 'denied'
                        ? 'Turned off. Enable Screen Time for Philoi in Settings, then come back.'
                        : 'Lets Philoi show the nudge over your picked apps'}
                  </Text>
                </View>
                {granted ? (
                  <Text style={styles.rowState}>ON</Text>
                ) : (
                  <Text style={styles.rowAction}>{requesting ? '…' : 'Grant'}</Text>
                )}
              </Pressable>
            </View>
            {status === 'denied' && (
              <Pressable onPress={() => Linking.openSettings()} style={styles.linkRow}>
                <Text style={styles.link}>Open iOS Settings</Text>
              </Pressable>
            )}

            {/* STEP 2 — the apps. Apple's own picker; we only ever learn how many. */}
            <Text style={styles.sectionLabel}>NUDGE ME ON THESE APPS</Text>
            <View style={styles.group}>
              <Pressable
                style={picked > 0 ? styles.row : styles.rowLast}
                disabled={!granted}
                onPress={handlePick}
                accessibilityRole="button"
                accessibilityLabel="Choose apps to nudge on">
                <Ionicons name="apps-outline" size={18} color={Colors.amber} style={styles.rowIcon} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, !granted && styles.dimmed]}>
                    {picked > 0 ? 'Change apps' : 'Choose apps'}
                  </Text>
                  <Text style={styles.rowDescription}>
                    {picked > 0
                      ? `${picked} selected`
                      : granted
                        ? "Apple's picker — Philoi never sees which ones"
                        : 'Grant Screen Time access first'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </Pressable>
              {picked > 0 && (
                <Pressable style={styles.rowLast} onPress={handleClear} accessibilityRole="button">
                  <Ionicons name="close-circle-outline" size={18} color={Colors.muted} style={styles.rowIcon} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>Clear selection</Text>
                  </View>
                </Pressable>
              )}
            </View>
            <Text style={styles.footnote}>
              Apple hands us an opaque selection, not a list of apps — Philoi genuinely cannot see
              which ones you picked, only how many.
            </Text>

            {/* STEP 3 — arming. Default ON per §A. */}
            <View style={styles.group}>
              <View style={styles.rowLast}>
                <Ionicons name="flame-outline" size={18} color={Colors.amber} style={styles.rowIcon} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Nudge me automatically when I lock in</Text>
                  <Text style={styles.rowDescription}>
                    Arms with every session · you can always continue
                  </Text>
                </View>
                <Toggle value={autoArm} onValueChange={handleToggleAuto} />
              </View>
            </View>

            <Text style={styles.footnote}>
              Cindy writes the message from your own sessions, goals and deadlines, so it lands like
              a friend who knows what&apos;s going on. Continuing to the app is always allowed — no
              penalty, no streak loss, nothing recorded against you.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.four,
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.two,
  },
  heroTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
  },
  heroBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: Spacing.two,
    marginLeft: 2,
  },
  group: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    marginBottom: Spacing.four,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowIcon: {
    width: 20,
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDescription: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  rowState: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
  },
  rowAction: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.amber,
  },
  dimmed: {
    color: Colors.disabledText,
  },
  linkRow: {
    marginTop: -Spacing.two,
    marginBottom: Spacing.four,
    paddingHorizontal: 2,
  },
  link: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.amber,
  },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
    paddingHorizontal: 2,
    marginTop: -Spacing.two,
    marginBottom: Spacing.four,
  },
});
