import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import {
  clearFocusNudgeApps,
  focusNudgeAuthorization,
  focusNudgePermissions,
  focusNudgeSelectionCounts,
  focusNudgeSelectionSize,
  focusNudgeSupported,
  focusNudgeUsesCuratedPicker,
  guardedAppIds,
  installedGuardableApps,
  isFocusNudgeEnabled,
  openFocusNudgeAccessibilitySettings,
  openFocusNudgeOverlaySettings,
  pickFocusNudgeApps,
  requestFocusNudgeAuthorization,
  setFocusNudgeEnabled,
  setGuardedAppIds,
  type FocusNudgeAuthorizationStatus,
  type FocusNudgePermissions,
  type FocusNudgeSelectionCounts,
  type GuardableApp,
} from '@/lib/focus-nudge';

// Focus Nudge setup — mock 109 frame 1, APP_BLOCKER_SPEC §A.
//
// Three steps and nothing else: grant access, pick what to guard, choose whether it arms
// automatically. There are no consequences to configure, because there are none — this is a warm
// interstitial you can always walk through, not a blocker (§"What this model drops").
//
// Every state on this screen degrades to "the feature is off", never to an error and never to
// something that stops you locking in (§"Edge cases").
//
// TWO STEP-ONES, because the platforms ask for permission in genuinely different ways:
//
//   · iOS — one prompt Philoi raises itself (Screen Time / Family Controls), then Apple's own
//     picker, which hands back opaque tokens we cannot resolve to app identities even if we wanted.
//   · ANDROID — TWO switches, and neither can be granted from inside an app. An AccessibilityService
//     cannot be enabled programmatically by any API (that restriction is the whole point of the
//     permission) and "display over other apps" is a Settings trip too. So step one here is
//     explain, then hand off to Settings, twice — and the explaining is not merely good manners:
//     🔴 PLAY_ACCESSIBILITY_DECLARATION.md commits Philoi to a PROMINENT DISCLOSURE shown BEFORE
//     the permission is requested, and Google's own rejection checklist calls a mismatch between
//     that disclosure, the store listing and the declaration the single biggest cause of rejection.
//     The copy in DISCLOSURE below is lifted from that file rather than rewritten. Keep it that way.

export default function FocusNudgeScreen() {
  const supported = focusNudgeSupported();
  // The Android build guards a curated list of known distracting apps rather than offering every
  // installed app — see the note on CATALOG in src/lib/focus-nudge.ts for why that is a
  // Play-permission decision and not a UI one.
  const curated = focusNudgeUsesCuratedPicker();

  const [status, setStatus] = useState<FocusNudgeAuthorizationStatus>('notDetermined');
  const [permissions, setPermissions] = useState<FocusNudgePermissions>({
    accessibility: false,
    overlay: false,
  });
  const [counts, setCounts] = useState<FocusNudgeSelectionCounts>({
    applications: 0,
    categories: 0,
    webDomains: 0,
  });
  const [installed, setInstalled] = useState<GuardableApp[]>([]);
  const [guarded, setGuarded] = useState<string[]>([]);
  const [autoArm, setAutoArm] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);

  // Fires focus_nudge_permission exactly once per grant on Android, where there is no prompt to
  // hang it off — the grant happens in system Settings and we only ever see the result on the way
  // back. Without the ref, every return to this screen would report the same grant again.
  const reportedGrant = useRef(false);

  // Re-read on every focus rather than once on mount. On iOS Screen Time access can be revoked in
  // Settings while the app is backgrounded; on Android the user is IN Settings for the whole of
  // step one, so a screen that did not re-read would still be showing "Off" for a switch they just
  // turned on. Coming back to a screen that lies about permission state is how you end up debugging
  // a nudge that was never going to appear.
  useFocusEffect(
    useCallback(() => {
      if (!supported) return;
      const nextStatus = focusNudgeAuthorization();
      setStatus(nextStatus);
      setCounts(focusNudgeSelectionCounts());
      isFocusNudgeEnabled().then(setAutoArm);
      if (!curated) return;

      const nextPermissions = focusNudgePermissions();
      setPermissions(nextPermissions);
      setInstalled(installedGuardableApps());
      setGuarded(guardedAppIds());

      const bothGranted = nextPermissions.accessibility && nextPermissions.overlay;
      if (bothGranted && !reportedGrant.current) {
        reportedGrant.current = true;
        track('focus_nudge_permission', { granted: true });
      }
      if (!bothGranted) reportedGrant.current = false;
    }, [supported, curated])
  );

  const picked = focusNudgeSelectionSize(counts);
  const granted = curated ? permissions.accessibility && permissions.overlay : status === 'approved';

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
    // Android DOES know the package names locally and still reports only the count here, so both
    // platforms tell the server exactly the same thing.
    track('focus_nudge_apps_picked', { count: focusNudgeSelectionSize(next) });
  }

  function handleClear() {
    clearFocusNudgeApps();
    setCounts(focusNudgeSelectionCounts());
    setGuarded([]);
  }

  /** Android: tick or untick one app in the curated list. */
  function handleToggleApp(app: GuardableApp, value: boolean) {
    const next = value ? [...guarded, app.id] : guarded.filter((id) => id !== app.id);
    setGuarded(next);
    setGuardedAppIds(next);
    setCounts(focusNudgeSelectionCounts());
    track('focus_nudge_apps_picked', { count: next.length });
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
          // Honest rather than hopeful, and the two "not here" cases are genuinely different: an
          // older iOS binary simply does not have the Screen Time extensions compiled in, while an
          // Android binary built without FOCUS_NUDGE_ANDROID=1 has no AccessibilityService
          // registered in its manifest — deliberately, so the closed test is not gated on Google's
          // extended review. Neither is broken; both are "not in this build".
          <View style={styles.group}>
            <View style={styles.rowLast}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.muted} style={styles.rowIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Not available in this build</Text>
                <Text style={styles.rowDescription}>
                  {Platform.OS === 'web'
                    ? 'Focus Nudge needs the Philoi app on your phone.'
                    : 'Update to the latest Philoi build to turn Focus Nudge on.'}
                </Text>
              </View>
            </View>
          </View>
        ) : curated ? (
          <>
            {/* ── ANDROID STEP 1 — the two switches, in the order they matter. ── */}
            <Text style={styles.sectionLabel}>PERMISSION</Text>
            <View style={styles.group}>
              <Pressable
                style={styles.row}
                disabled={permissions.accessibility}
                // 🔴 DISCLOSURE FIRST, ALWAYS. Not a nicety — the Play declaration commits to
                // showing it before the permission is requested, and this Pressable is the only
                // route to that request.
                onPress={() => setShowDisclosure(true)}
                accessibilityRole="button"
                accessibilityLabel="Turn on Accessibility access for Focus Nudge">
                <Ionicons
                  name={permissions.accessibility ? 'checkmark-circle' : 'eye-outline'}
                  size={18}
                  color={permissions.accessibility ? Colors.green : Colors.amber}
                  style={styles.rowIcon}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Accessibility access</Text>
                  <Text style={styles.rowDescription}>
                    {permissions.accessibility
                      ? 'On — Philoi can tell when a guarded app opens'
                      : 'Lets Philoi notice the moment a guarded app opens'}
                  </Text>
                </View>
                {permissions.accessibility ? (
                  <Text style={styles.rowState}>ON</Text>
                ) : (
                  <Text style={styles.rowAction}>Turn on</Text>
                )}
              </Pressable>

              <Pressable
                style={styles.rowLast}
                disabled={permissions.overlay}
                onPress={openFocusNudgeOverlaySettings}
                accessibilityRole="button"
                accessibilityLabel="Allow Philoi to display over other apps">
                <Ionicons
                  name={permissions.overlay ? 'checkmark-circle' : 'layers-outline'}
                  size={18}
                  color={permissions.overlay ? Colors.green : Colors.amber}
                  style={styles.rowIcon}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Display over other apps</Text>
                  <Text style={styles.rowDescription}>
                    {permissions.overlay
                      ? 'On — the nudge can appear over the app you opened'
                      : 'Lets the nudge appear over the app, instead of as a notification'}
                  </Text>
                </View>
                {permissions.overlay ? (
                  <Text style={styles.rowState}>ON</Text>
                ) : (
                  <Text style={styles.rowAction}>Turn on</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.footnote}>
              Both switches live in Android&apos;s own Settings — no app can turn them on for you.
              Philoi only ever checks <Text style={styles.footnoteStrong}>which</Text> app is in
              front. It never reads your screen, your messages, or anything you type, and nothing
              leaves your phone.
            </Text>

            {/* ── ANDROID STEP 2 — the curated list. ── */}
            <Text style={styles.sectionLabel}>NUDGE ME ON THESE APPS</Text>
            {installed.length === 0 ? (
              <View style={styles.group}>
                <View style={styles.rowLast}>
                  <Ionicons name="apps-outline" size={18} color={Colors.muted} style={styles.rowIcon} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>Nothing to guard yet</Text>
                    <Text style={styles.rowDescription}>
                      None of the apps Focus Nudge knows about are installed on this phone.
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.group}>
                {installed.map((app, index) => {
                  const last = index === installed.length - 1;
                  return (
                    <View key={app.id} style={last ? styles.rowLast : styles.row}>
                      <Ionicons
                        name="phone-portrait-outline"
                        size={18}
                        color={Colors.amber}
                        style={styles.rowIcon}
                      />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowLabel, !granted && styles.dimmed]}>{app.label}</Text>
                      </View>
                      <Toggle
                        value={guarded.includes(app.id)}
                        disabled={!granted}
                        onValueChange={(value) => handleToggleApp(app, value)}
                      />
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={styles.footnote}>
              {granted
                ? 'A short, fixed list on purpose. Offering every app on your phone would mean asking Google for permission to read what you have installed — this way Philoi only ever asks about these few by name.'
                : 'Turn both switches on above, then pick what to guard.'}
            </Text>
          </>
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
          </>
        )}

        {supported && (
          <>
            {/* STEP 3 — arming. Default ON per §A. Identical on both platforms. */}
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

      {/*
        🔴 THE PROMINENT DISCLOSURE (PLAY_ACCESSIBILITY_DECLARATION.md).
        Shown BEFORE the user is sent to Accessibility settings, never after, and worded to match
        the store listing and the declaration to the sentence. A modal rather than an inline card
        because "prominent" means it has to be the only thing on screen — a paragraph someone can
        scroll past is not a disclosure.
      */}
      <Modal
        visible={showDisclosure}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDisclosure(false)}>
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <Ionicons name="eye-outline" size={34} color={Colors.amber} />
            <Text style={styles.sheetTitle}>Focus Nudge needs Accessibility access.</Text>
            <Text style={styles.sheetBody}>
              Philoi uses Android&apos;s Accessibility service to notice the moment you open an app
              you&apos;ve chosen to stay away from, so it can show you a quick reminder to lock in
              instead.
            </Text>
            <Text style={styles.sheetBody}>
              It only checks <Text style={styles.footnoteStrong}>which</Text> app is in front — it
              never reads your screen, your messages, or anything you type, and nothing leaves your
              phone.
            </Text>
            <Text style={styles.sheetBody}>
              You pick which apps this applies to, and you can turn it off anytime in Settings.
            </Text>
            <Pressable
              style={styles.sheetPrimary}
              accessibilityRole="button"
              onPress={() => {
                setShowDisclosure(false);
                track('focus_nudge_disclosure_accepted', {});
                openFocusNudgeAccessibilitySettings();
              }}>
              <Text style={styles.sheetPrimaryLabel}>Turn on Focus Nudge</Text>
            </Pressable>
            <Pressable
              style={styles.sheetSecondary}
              accessibilityRole="button"
              onPress={() => setShowDisclosure(false)}>
              <Text style={styles.sheetSecondaryLabel}>Not now</Text>
            </Pressable>
            <Text style={styles.sheetFootnote}>
              Android opens its own Accessibility list — find{' '}
              <Text style={styles.footnoteStrong}>Philoi Focus Nudge</Text> in it and turn it on.
            </Text>
          </View>
        </View>
      </Modal>
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
  footnoteStrong: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.muted,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,16,0.82)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  sheetTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
    textAlign: 'center',
  },
  sheetBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
  },
  sheetPrimary: {
    alignSelf: 'stretch',
    backgroundColor: Colors.coral,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  sheetPrimaryLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.onEmber,
  },
  sheetSecondary: {
    alignSelf: 'stretch',
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  sheetSecondaryLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.muted,
  },
  sheetFootnote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
});
