import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FITNESS_SYNC_SOURCES, type SyncSource } from '@/components/fitness-sync-prompt';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { useWhoopConnection } from '@/hooks/use-whoop-connection';
import { getErrorMessage } from '@/lib/errors';
import { getPlatformFitnessSource, isDeviceFitnessSupported } from '@/lib/fitness-sync';
import { isStravaSupported } from '@/lib/strava';
import { isWhoopSupported, WHOOP_ALL_METRIC_SCOPES } from '@/lib/whoop';

// Official Strava brand assets (developers.strava.com/guidelines — never redraw these).
const STRAVA_CONNECT_BUTTON = require('../../assets/strava/connect-button/btn_strava_connect_with_orange_x2.png');
const STRAVA_POWERED_BY = require('../../assets/strava/powered-by/api_logo_pwrdBy_strava_horiz_orange.png');

// Settings → "Connected apps" (PHILOI_UI_SPEC.md §19, CODE_BUILD_PROMPTS.md's fitness-sync
// note) — the persistent, discoverable home for connecting a device-metric source, so it isn't
// only reachable by happening to create a steps/distance challenge (see fitness-sync-prompt.tsx
// for that contextual entry point; both share the same source list). This platform's own real
// pedometer source (Apple Health on iOS, Health Connect on Android), Strava (cross-platform, runs
// + rides) and Whoop (cross-platform, strain/workouts/sleep) are all real, each gated behind
// FITNESS_SYNC_ENABLED until their EAS rebuild ships — the other platform's pedometer stays the
// honest "we're still building this" placeholder, since it's not wired up here.
//
// Unlike the sync sheet, this screen lists every source regardless of metric fit: there's no
// challenge in context to fit to, and connecting ahead of time is the whole point of the screen.
type ConnectionBundle = {
  connected: boolean;
  loading: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
};

function ConnectableRow({
  source,
  supported,
  bundle,
  notSupportedMessage,
  connectButtonAsset,
}: {
  source: SyncSource;
  supported: boolean;
  bundle: ConnectionBundle;
  notSupportedMessage: string;
  /** The official "Connect with X" button image (Strava's brand guidelines require its own
   * exact button asset, not generic "Connect" text) — shown instead of the plain text+chevron
   * when provided and not yet connected. */
  connectButtonAsset?: number;
}) {
  const { connected, loading, connect, disconnect } = bundle;
  const [busy, setBusy] = useState(false);

  async function handlePress() {
    if (!supported) {
      Alert.alert(`${source.name} — coming soon on this build`, notSupportedMessage);
      return;
    }
    if (connected) {
      Alert.alert(`Disconnect ${source.name}?`, 'Philoi will stop syncing progress automatically — you can always log it yourself.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect() },
      ]);
      return;
    }
    setBusy(true);
    try {
      const ok = await connect();
      if (!ok) {
        Alert.alert('Could not connect', 'That source isn’t available right now — you can log progress manually instead.');
      }
    } catch (e) {
      // A source can fail for a reason the user can act on (Health Connect not installed, or too
      // old to use) — those come through as real messages rather than a silent false, so show
      // them instead of the generic line above.
      Alert.alert(`Couldn’t connect ${source.name}`, getErrorMessage(e, 'Something went wrong — you can log progress manually instead.'));
    } finally {
      setBusy(false);
    }
  }

  const showConnected = supported && connected;

  return (
    <Pressable style={styles.row} onPress={handlePress} disabled={loading || busy}>
      <View style={[styles.icon, { backgroundColor: source.iconBg }]}>
        <Ionicons name={source.icon} size={19} color={source.iconColor} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{source.name}</Text>
        <Text style={styles.detail}>{source.detail}</Text>
      </View>
      {busy || loading ? (
        <ActivityIndicator size="small" color={Colors.achieverText} />
      ) : showConnected ? (
        <View style={styles.connectedPill}>
          <Ionicons name="checkmark-circle" size={14} color={Colors.green} />
          <Text style={styles.connectedLabel}>Connected</Text>
        </View>
      ) : connectButtonAsset ? (
        <Image source={connectButtonAsset} style={styles.connectButtonImage} resizeMode="contain" />
      ) : (
        <>
          <Text style={styles.connectLabel}>Connect</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
        </>
      )}
    </Pressable>
  );
}

function DeviceFitnessRow({ source }: { source: SyncSource }) {
  return (
    <ConnectableRow
      source={source}
      supported={isDeviceFitnessSupported()}
      bundle={useFitnessConnection()}
      notSupportedMessage="This needs a newer build of Philoi. You can log progress manually for now."
    />
  );
}

function StravaRow({ source }: { source: SyncSource }) {
  const bundle = useStravaConnection();
  // Safety net alongside connect()'s own re-check (use-strava-connection.ts) — the real
  // completion happens in app/strava-auth.tsx, a separate screen mount, so refetching whenever
  // this screen regains focus (e.g. router.replace('/connected-apps') from that route) catches
  // the true state even if connect()'s own re-check ran a beat too early.
  useFocusEffect(
    useCallback(() => {
      bundle.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable per hook instance
    }, [])
  );
  return (
    <ConnectableRow
      source={source}
      supported={isStravaSupported()}
      bundle={bundle}
      notSupportedMessage="This needs a newer build of Philoi. You can log progress manually for now."
      connectButtonAsset={STRAVA_CONNECT_BUTTON}
    />
  );
}

// Connecting from here has no challenge to narrow the scopes to, so it asks for the three metrics
// Philoi can actually use (workouts, strain, sleep) and no more — read:profile is never requested.
// A connect made from a challenge's own sync sheet asks for just that challenge's one scope.
function WhoopRow({ source }: { source: SyncSource }) {
  const { connected, loading, connect, disconnect } = useWhoopConnection();
  return (
    <ConnectableRow
      source={source}
      supported={isWhoopSupported()}
      bundle={{ connected, loading, connect: () => connect(WHOOP_ALL_METRIC_SCOPES), disconnect }}
      notSupportedMessage="This needs a newer build of Philoi. You can log progress manually for now."
    />
  );
}

function StubRow({ source }: { source: SyncSource }) {
  function handlePress() {
    Alert.alert(`${source.name} — coming soon`, "We're still building this connection. You can log progress manually for now.");
  }

  return (
    <Pressable style={styles.row} onPress={handlePress}>
      <View style={[styles.icon, { backgroundColor: source.iconBg }]}>
        <Ionicons name={source.icon} size={19} color={source.iconColor} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{source.name}</Text>
        <Text style={styles.detail}>{source.detail}</Text>
      </View>
      <Text style={styles.connectLabel}>Connect</Text>
      <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
    </Pressable>
  );
}

export default function ConnectedAppsScreen() {
  const router = useRouter();
  const platformSource = getPlatformFitnessSource();

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Connected apps</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.subtitle}>
          Connect a source once and any challenge that uses steps or distance can track itself automatically —
          or keep logging it yourself, that always works too.
        </Text>

        <View style={styles.group}>
          {FITNESS_SYNC_SOURCES.map((source) => {
            if (source.key === platformSource) return <DeviceFitnessRow key={source.key} source={source} />;
            if (source.key === 'strava') return <StravaRow key={source.key} source={source} />;
            if (source.key === 'whoop') return <WhoopRow key={source.key} source={source} />;
            return <StubRow key={source.key} source={source} />;
          })}
        </View>

        <View style={styles.privacy}>
          <Ionicons name="lock-closed" size={13} color={Colors.green} />
          <Text style={styles.privacyText}>
            We only read what a challenge needs — your campfire sees your progress, never your raw activity data.
          </Text>
        </View>

        {platformSource === 'health_connect' && (
          <Pressable style={styles.rationaleLink} onPress={() => router.push('/health-connect-rationale')}>
            <Text style={styles.rationaleLinkText}>How Philoi uses Health Connect data</Text>
          </Pressable>
        )}

        {/* Official "Powered by Strava" lockup (developers.strava.com/guidelines) — required
            wherever Strava-derived data shows up, kept clearly secondary to Philoi's own mark. */}
        {isStravaSupported() && (
          <View style={styles.poweredByRow}>
            <Image source={STRAVA_POWERED_BY} style={styles.poweredByImage} resizeMode="contain" />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  container: {
    padding: Spacing.four,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    marginBottom: Spacing.four,
  },
  group: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
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
  icon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  connectLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectedLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.green,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.one,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    lineHeight: 15,
  },
  rationaleLink: {
    marginTop: Spacing.three,
    alignItems: 'center',
  },
  rationaleLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
    textDecorationLine: 'underline',
  },
  connectButtonImage: {
    height: 24,
    width: 118,
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
