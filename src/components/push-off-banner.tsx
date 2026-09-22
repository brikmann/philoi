import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { getPushPermission, registerPushToken } from '@/lib/notifications';

/**
 * "Push is off on this phone" — the re-register nudge.
 *
 * WHY IT EXISTS. registerPushToken() asks once, at the first moment the account is usable. Someone
 * who declined then gets the bell feed and never a banner, for every event, forever — and on iOS
 * after one decline (Android 13+ after two) the system prompt will never appear again, so no amount
 * of re-asking from code can fix it. 7 of 18 prod profiles had no push token on 2026-09-22.
 *
 * So: where the OS can still ask, the button asks (and registers the token on a yes). Where it
 * can't, the button opens this app's OS settings page, and coming back to the app re-checks and
 * registers — so the fix is one round trip, not a hunt through Settings.
 *
 * Renders nothing when push is granted, on web, or before the first check lands. `style` overrides
 * the outer margins, for a screen that already pads its content.
 */
export function PushOffBanner({ style }: { style?: ViewStyle }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);

  const check = useCallback(async () => {
    const p = await getPushPermission();
    setState(p);
    // Granted but perhaps never registered (granted in OS Settings, or a registration that failed
    // earlier): make sure a token row exists. The upsert is idempotent.
    if (p.granted && userId) void registerPushToken(userId);
    return p;
  }, [userId]);

  useEffect(() => {
    // Resolves through the promise, so the effect body never sets state synchronously.
    getPushPermission()
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      // Coming back from the OS settings page is the moment a "Turn on" either worked or didn't.
      if (next === 'active') void check().catch(() => {});
    });
    return () => sub.remove();
  }, [check]);

  if (Platform.OS === 'web' || !state || state.granted) return null;

  async function turnOn() {
    if (state?.canAskAgain && userId) {
      await registerPushToken(userId);
      await check().catch(() => {});
      return;
    }
    await Linking.openSettings();
  }

  return (
    <View style={[styles.banner, style]}>
      <Ionicons name="notifications-off-outline" size={18} color={Colors.amber} />
      <View style={styles.copy}>
        <Text style={styles.title}>Push is off on this phone</Text>
        <Text style={styles.body}>Goals, crates and friend requests show up here, but won’t buzz you.</Text>
      </View>
      <Pressable style={styles.button} onPress={turnOn} accessibilityRole="button" hitSlop={6}>
        <Text style={styles.buttonText}>Turn on</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.twelve,
    padding: Spacing.twelve,
    borderRadius: Radius.card,
    backgroundColor: Colors.achieverBg,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.warmSubtext,
    marginTop: 2,
  },
  button: {
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: Spacing.twelve,
  },
  buttonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.onEmber,
  },
});
