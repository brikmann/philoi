import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FITNESS_SYNC_SOURCES, type SyncSource } from '@/components/fitness-sync-prompt';
import { STRAVA_CONNECT_BUTTON } from '@/components/fitness/tracker-prompts';
import { Screen } from '@/components/ui/screen';
import { SpaceHeader, SpaceSection, SPACE_GUTTER } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { refreshFitnessTracking } from '@/hooks/use-fitness-tracking';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { getPlatformFitnessSource, isDeviceFitnessSupported } from '@/lib/fitness-sync';
import { formatRelativeTime } from '@/lib/format';
import { getStepLadderLastSyncedAt } from '@/lib/step-ladder-sync';
import { getStravaLastSyncedAt, isStravaSupported } from '@/lib/strava';
import { WHOOP_ALL_METRIC_SCOPES } from '@/lib/whoop';

const STRAVA_POWERED_BY = require('../../assets/strava/powered-by/api_logo_pwrdBy_strava_horiz_orange.png');

// FITNESS TRACKERS (mock 314) — the one screen every fitness-connect prompt points at: the Home
// setup card, the Lock In Gym/Run prompt, the fitness board banner, and the Profile/Settings rows.
//
// Same sources and same connect flows as Settings → Integrations (it shares FITNESS_SYNC_SOURCES
// and the hooks); what differs is the framing. ONE TRACKER IS DONE: once any source is on, the
// header says "You're tracking", that source shows ✓ On with its last sync, and every other source
// drops to a quiet "+ Add" under "Optional". Nothing here or anywhere else asks for a second one.
//
// Only the platform's own health store is listed (Apple Health on iOS, Health Connect on Android),
// and Whoop only while WHOOP_ENABLED (FITNESS_SYNC_SOURCES already drops it). There is no Garmin
// integration, so there is no Garmin row — a row that can never connect is an incomplete feature
// to App Review (Guideline 2.1). A listed source this build can't connect reads "Coming soon".

type Tracker = {
  source: SyncSource;
  supported: boolean;
  connected: boolean;
  loading: boolean;
  lastSyncIso: string | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  /** Strava's brand guidelines require its own button image for the OAuth entry. */
  connectAsset?: number;
};

export default function FitnessTrackersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const platform = getPlatformFitnessSource();

  const device = useFitnessConnection();
  const strava = useStravaConnection();
  const whoop = useWhoopConnection();
  const [deviceSync, setDeviceSync] = useState<string | null>(null);
  const [stravaSync, setStravaSync] = useState<string | null>(null);

  // On focus: the Strava redirect completes in its own route (strava-auth.tsx) and comes back
  // here, so this is what picks up the new connection and its first sync.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      strava.refresh();
      void refreshFitnessTracking();
      if (userId) {
        getStepLadderLastSyncedAt(userId).then((at) => {
          if (live) setDeviceSync(at ? new Date(at).toISOString() : null);
        });
      }
      getStravaLastSyncedAt()
        .then((at) => {
          if (live) setStravaSync(at);
        })
        .catch(() => {
          // The sync line is a nicety; "On" still reads without it.
        });
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable per hook instance
    }, [userId])
  );

  const trackers: Tracker[] = [];
  for (const source of FITNESS_SYNC_SOURCES) {
    if (source.key === platform) {
      trackers.push({
        source,
        supported: isDeviceFitnessSupported(),
        connected: device.connected,
        loading: device.loading,
        lastSyncIso: deviceSync,
        connect: device.connect,
        disconnect: device.disconnect,
      });
    } else if (source.key === 'strava') {
      trackers.push({
        source,
        supported: isStravaSupported(),
        connected: strava.connected,
        loading: strava.loading,
        lastSyncIso: stravaSync,
        connect: strava.connect,
        disconnect: strava.disconnect,
        connectAsset: STRAVA_CONNECT_BUTTON,
      });
    } else if (source.key === 'whoop') {
      trackers.push({
        source,
        supported: whoop.supported,
        connected: whoop.connected,
        loading: whoop.loading,
        lastSyncIso: null,
        connect: () => whoop.connect(WHOOP_ALL_METRIC_SCOPES),
        disconnect: whoop.disconnect,
      });
    }
  }

  const on = trackers.filter((t) => t.supported && t.connected);
  const rest = trackers.filter((t) => !(t.supported && t.connected));
  const tracking = on.length > 0;

  return (
    // Top edge only: the global footer owns the bottom inset.
    <Screen padded={false} edges={['top']}>
      <SpaceHeader title="Fitness trackers" />

      <ScrollView contentContainerStyle={styles.container}>
        {tracking ? (
          <View style={styles.done}>
            <Text style={styles.doneIcon}>✅</Text>
            <View style={styles.info}>
              <Text style={styles.doneTitle}>You’re tracking</Text>
              <Text style={styles.detail}>Workouts auto-count. Nothing else to set up.</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.subtitle}>Synced workouts auto-count toward your XP, streaks and the fitness boards. One is all you need.</Text>
        )}

        {tracking ? (
          <View style={styles.group}>
            {on.map((t) => (
              <TrackerRow key={t.source.key} tracker={t} optional={false} />
            ))}
          </View>
        ) : null}

        {rest.length > 0 ? (
          <>
            {tracking ? <SpaceSection>Optional · add more sources</SpaceSection> : null}
            <View style={styles.group}>
              {rest.map((t) => (
                <TrackerRow key={t.source.key} tracker={t} optional={tracking} />
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.privacy}>
          <UiGlyph name="lock" size={13} color={Colors.green} />
          <Text style={styles.privacyText}>
            Philoi never writes to your health data — it only reads activity to count it. Your campfire sees progress, never raw
            activity.
          </Text>
        </View>

        {platform === 'health_connect' && (
          <Pressable style={styles.rationaleLink} onPress={() => router.push('/health-connect-rationale')} accessibilityRole="link">
            <Text style={styles.rationaleLinkText}>How Philoi uses Health Connect data</Text>
            <UiGlyph name="forward" size={12} color={Colors.navEmber2} />
          </Pressable>
        )}

        {/* Official "Powered by Strava" lockup — required wherever Strava-derived data shows up. */}
        {isStravaSupported() && (
          <View style={styles.poweredByRow}>
            <Image source={STRAVA_POWERED_BY} style={styles.poweredByImage} resizeMode="contain" />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function TrackerRow({ tracker, optional }: { tracker: Tracker; optional: boolean }) {
  const { source, supported, connected, loading, lastSyncIso, connect, disconnect, connectAsset } = tracker;
  const [busy, setBusy] = useState(false);
  const isOn = supported && connected;

  async function handlePress() {
    if (!supported) return;
    if (isOn) {
      Alert.alert(`Disconnect ${source.name}?`, 'Philoi will stop syncing workouts from it — you can always log them yourself.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
      ]);
      return;
    }
    setBusy(true);
    try {
      const ok = await connect();
      if (ok) await refreshFitnessTracking();
      else Alert.alert('Could not connect', 'That source isn’t available right now — you can log progress manually instead.');
    } catch (e) {
      // Health Connect missing / too old, a Strava exchange error — real messages, shown as such.
      Alert.alert(`Couldn’t connect ${source.name}`, getErrorMessage(e, 'Something went wrong — you can log progress manually instead.'));
    } finally {
      setBusy(false);
    }
  }

  const detail = isOn
    ? lastSyncIso
      ? `Last sync ${formatRelativeTime(lastSyncIso)}`
      : 'Connected · waiting for the first sync'
    : source.detail;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && supported && styles.rowPressed]}
      onPress={handlePress}
      disabled={!supported || loading || busy}
      accessibilityRole="button"
      accessibilityLabel={`${source.name}, ${!supported ? 'coming soon' : isOn ? 'connected' : 'connect'}`}>
      <View style={[styles.icon, { backgroundColor: source.iconBg }]}>
        <Ionicons name={source.icon} size={19} color={source.iconColor} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{source.name}</Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {!supported ? (
        <Text style={styles.soon}>Coming soon</Text>
      ) : busy || loading ? (
        <ActivityIndicator size="small" color={Colors.navEmber} />
      ) : isOn ? (
        <View style={styles.onPill}>
          <UiGlyph name="check" size={12} color={Colors.green} />
          <Text style={styles.onLabel}>On</Text>
        </View>
      ) : connectAsset ? (
        <Image source={connectAsset} style={styles.connectButtonImage} resizeMode="contain" />
      ) : optional ? (
        <Text style={styles.addLabel}>+ Add</Text>
      ) : (
        <View style={styles.connectBtn}>
          <Text style={styles.connectBtnLabel}>Connect</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACE_GUTTER,
    paddingBottom: Spacing.five,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.spaceDim,
    marginBottom: Spacing.twelve,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: Spacing.twelve,
    marginBottom: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: 'rgba(57,217,138,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(57,217,138,0.35)',
  },
  doneIcon: {
    fontSize: 20,
  },
  doneTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  group: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  soon: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceFaint,
  },
  onPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  onLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.green,
  },
  addLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  connectBtn: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: Colors.navEmber,
  },
  connectBtnLabel: {
    fontFamily: Fonts.black,
    fontSize: 11.5,
    color: '#1a1030',
  },
  connectButtonImage: {
    height: 24,
    width: 118,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.twelve,
    paddingHorizontal: 2,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    lineHeight: 16,
  },
  rationaleLink: {
    marginTop: Spacing.twelve,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  rationaleLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.navEmber2,
  },
  poweredByRow: {
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  poweredByImage: {
    height: 16,
    width: 100,
  },
});
