import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { refreshFitnessTracking, useFitnessTracking } from '@/hooks/use-fitness-tracking';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { getErrorMessage } from '@/lib/errors';
import { FITNESS_SOURCE_NAME, getPlatformFitnessSource, isDeviceFitnessSupported } from '@/lib/fitness-sync';
import { isStravaSupported } from '@/lib/strava';

// The three "connect a tracker" nudges from mock 314 — Home's setup card, the Lock In tab's Gym/Run
// prompt, and the fitness board's banner. All three read useFitnessTracking() and render NOTHING
// once any one tracker is connected (or while that is still being worked out, so none ever
// flashes). None of them names a second provider to someone who already has one.
//
// Every Connect lands on the existing flows: the Home card runs them in place (useStravaConnection /
// useFitnessConnection — the same hooks Integrations uses), the other two open the Fitness
// trackers screen, which does the same.

// Official Strava brand asset (developers.strava.com/guidelines) — the OAuth entry has to be this
// exact button, never redrawn "Connect Strava" text.
export const STRAVA_CONNECT_BUTTON = require('../../../assets/strava/connect-button/btn_strava_connect_with_orange_x2.png');

export const TRACKERS_ROUTE = '/fitness-trackers';

/** Home: dismissible, until any tracker is connected. */
export function HomeTrackerCard() {
  const router = useRouter();
  const { trackingOn, loading, homeDismissed, dismissHomeCard } = useFitnessTracking();
  if (loading || trackingOn || homeDismissed) return null;

  return (
    <View style={styles.homeCard}>
      <Pressable onPress={() => router.push(TRACKERS_ROUTE)} accessibilityRole="button" accessibilityLabel="Fitness trackers">
        <Text style={styles.homeTitle}>🏃 Track your gym & runs</Text>
        <Text style={styles.homeBody}>Connect a tracker so workouts auto-count toward your XP & boards.</Text>
      </Pressable>
      <HomeConnectButtons />
      <Pressable onPress={dismissHomeCard} hitSlop={8} accessibilityRole="button">
        <Text style={styles.dismiss}>Dismiss · do it later in Profile</Text>
      </Pressable>
    </View>
  );
}

// Its own component so useStravaConnection (a status read on mount) only runs while the card shows.
function HomeConnectButtons() {
  const strava = useStravaConnection();
  const device = useFitnessConnection();
  const platform = getPlatformFitnessSource();
  const [busy, setBusy] = useState<'strava' | 'device' | null>(null);

  async function run(which: 'strava' | 'device', name: string) {
    setBusy(which);
    try {
      const ok = which === 'strava' ? await strava.connect() : await device.connect();
      if (ok) await refreshFitnessTracking();
      else if (which === 'device') Alert.alert('Could not connect', `${name} isn’t available right now — you can log progress manually instead.`);
    } catch (e) {
      Alert.alert(`Couldn’t connect ${name}`, getErrorMessage(e, 'Something went wrong — try again from Profile → Fitness trackers.'));
    } finally {
      setBusy(null);
    }
  }

  const showStrava = isStravaSupported();
  const showDevice = platform !== null && isDeviceFitnessSupported();

  return (
    <View style={styles.homeButtons}>
      {showStrava ? (
        <Pressable
          onPress={() => void run('strava', 'Strava')}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Connect with Strava">
          {busy === 'strava' ? (
            <ActivityIndicator size="small" color={Colors.navEmber} style={styles.stravaButton} />
          ) : (
            <Image source={STRAVA_CONNECT_BUTTON} style={styles.stravaButton} resizeMode="contain" />
          )}
        </Pressable>
      ) : null}
      {showDevice && platform ? (
        <Pressable
          style={styles.deviceButton}
          onPress={() => void run('device', FITNESS_SOURCE_NAME[platform])}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`Connect ${FITNESS_SOURCE_NAME[platform]}`}>
          {busy === 'device' ? (
            <ActivityIndicator size="small" color={Colors.ink} />
          ) : (
            <Text style={styles.deviceLabel}>{FITNESS_SOURCE_NAME[platform]}</Text>
          )}
        </Pressable>
      ) : null}
      {!showStrava && !showDevice ? <Text style={styles.soon}>Trackers are coming soon on this build.</Text> : null}
    </View>
  );
}

/** Lock In tab: inline under the discipline tiles, only for Gym / Run, only if not connected. */
export function LockInTrackerPrompt({ activity, style }: { activity: 'strength' | 'cardio'; style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { trackingOn, loading } = useFitnessTracking();
  if (loading || trackingOn) return null;
  const platform = getPlatformFitnessSource();
  const sources = ['Strava', platform && isDeviceFitnessSupported() ? FITNESS_SOURCE_NAME[platform] : null].filter(Boolean).join(' or ');

  return (
    <ConnectStrip
      icon="🔗"
      title={activity === 'strength' ? 'Auto-count your gym time' : 'Auto-count your runs'}
      sub={`Connect ${sources}`}
      style={style}
      onPress={() => router.push(TRACKERS_ROUTE)}
    />
  );
}

/** Fitness board: a banner above the list, only if not connected. */
export function BoardTrackerBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { trackingOn, loading } = useFitnessTracking();
  if (loading || trackingOn) return null;

  return (
    <ConnectStrip
      icon="📊"
      title="Connect a tracker to rank here"
      sub="Synced workouts count toward this board"
      dashed
      style={style}
      onPress={() => router.push(TRACKERS_ROUTE)}
    />
  );
}

function ConnectStrip({
  icon,
  title,
  sub,
  dashed,
  style,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  dashed?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.strip, dashed && styles.stripDashed, pressed && styles.pressed, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Connect`}>
      <Text style={styles.stripIcon}>{icon}</Text>
      <View style={styles.stripText}>
        <Text style={styles.stripTitle}>{title}</Text>
        <Text style={styles.stripSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <View style={styles.stripBtn}>
        <Text style={styles.stripBtnLabel}>Connect</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  homeCard: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.twelve,
    gap: Spacing.two,
    borderRadius: Radius.card,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  homeTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  homeBody: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: Colors.spaceDim,
    marginTop: 3,
  },
  homeButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  stravaButton: {
    height: 36,
    width: 176,
  },
  deviceButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  deviceLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  soon: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceFaint,
  },
  dismiss: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceFaint,
    textAlign: 'center',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(252,76,2,0.10)',
    borderWidth: 1,
    borderColor: '#5a2f18',
  },
  stripDashed: {
    backgroundColor: Colors.spacePanel2,
    borderStyle: 'dashed',
    borderColor: '#5a4a2a',
  },
  pressed: {
    opacity: 0.85,
  },
  stripIcon: {
    fontSize: 20,
  },
  stripText: {
    flex: 1,
    minWidth: 0,
  },
  stripTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  stripSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  stripBtn: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber,
  },
  stripBtnLabel: {
    fontFamily: Fonts.black,
    fontSize: 11.5,
    color: '#1a1030',
  },
});

