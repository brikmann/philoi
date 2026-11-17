import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CalendarConsentDialog } from '@/components/calendar-consent-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGoogleCalendarConnection } from '@/hooks/use-google-calendar-connection';
import { useStravaConnection } from '@/hooks/use-strava-connection';
import { getErrorMessage } from '@/lib/errors';
import { isStravaSupported } from '@/lib/strava';

// ─────────────────────────── NATIVE CONNECT (SPEC_gym_spark_v2 §2) ───────────────────────────
//
// Three Philoi-styled cards — Strava, Calendar, Spotify — for the end of setup page 2 and the top of
// Settings → Connections in Gym Spark mode. They replace the hand-off into the settings-list
// Integrations screen (connected-apps.tsx), which still exists and is still where Apple Health /
// Health Connect live.
//
// No new connect logic: Strava is useStravaConnection (the OAuth redirect still completes in
// app/strava-auth.tsx, which router.back()s onto whatever screen started it — so this refreshes on
// focus, exactly like connected-apps' StravaRow); Calendar is useGoogleCalendarConnection behind the
// same CalendarConsentDialog. Spotify is not built — a disabled "Soon" card, nothing wired.

// Official Strava brand asset (developers.strava.com/guidelines — never redraw it).
const STRAVA_CONNECT_BUTTON = require('../../../assets/strava/connect-button/btn_strava_connect_with_orange_x2.png');

export function NativeConnectCards() {
  return (
    <View style={styles.stack}>
      <StravaCard />
      <CalendarCard />
      <ConnectCard
        tile={{ bg: '#14261b', icon: 'musical-notes', color: '#1ED760' }}
        title="Spotify"
        detail="Your gym anthem, on your profile"
        dim
        trailing={<SoonPill />}
      />
    </View>
  );
}

function StravaCard() {
  const { connected, loading, connect, disconnect, refresh } = useStravaConnection();
  const [busy, setBusy] = useState(false);
  const supported = isStravaSupported();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  async function onPress() {
    if (connected) {
      Alert.alert('Disconnect Strava?', 'Philoi will stop pulling in your activities. You can reconnect any time.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
      ]);
      return;
    }
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      Alert.alert('Couldn’t connect Strava', getErrorMessage(e, 'Something went wrong — try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  const live = supported && connected;
  return (
    <ConnectCard
      tile={{ bg: '#3a2118', icon: 'bicycle', color: '#FC5200' }}
      title="Strava"
      detail={live ? 'Connected · activities sync in' : 'Auto-log runs, rides and workouts'}
      dim={!supported}
      disabled={!supported || loading || busy}
      onPress={() => void onPress()}
      trailing={
        !supported ? (
          <SoonPill />
        ) : busy || loading ? (
          <ActivityIndicator size="small" color={Colors.navEmber} />
        ) : live ? (
          <ConnectedPill />
        ) : (
          <Image
            source={STRAVA_CONNECT_BUTTON}
            style={styles.stravaButton}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        )
      }
    />
  );
}

function CalendarCard() {
  const { connected, accountEmail, loading, supported, connect, disconnect } = useGoogleCalendarConnection();
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function runConnect() {
    setBusy(true);
    try {
      // false = they backed out of Google's sheet: a non-event, no toast.
      await connect();
      setConsent(false);
    } catch (e) {
      setConsent(false);
      Alert.alert('Couldn’t connect your calendar', getErrorMessage(e, 'Something went wrong — try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  async function runDisconnect() {
    setBusy(true);
    try {
      await disconnect();
    } catch (e) {
      Alert.alert('Couldn’t disconnect', getErrorMessage(e, 'Something went wrong — try again in a moment.'));
    } finally {
      setConfirmDisconnect(false);
      setBusy(false);
    }
  }

  const live = supported && connected;
  return (
    <>
      <ConnectCard
        tile={{ bg: '#1b2436', icon: 'calendar', color: '#5B93F5' }}
        title="Calendar"
        detail={live ? (accountEmail ? `Connected · ${accountEmail}` : 'Connected') : 'Plan sessions around your week'}
        dim={!supported}
        disabled={!supported || loading || busy}
        onPress={() => (live ? setConfirmDisconnect(true) : setConsent(true))}
        trailing={
          !supported ? (
            <SoonPill />
          ) : busy || loading ? (
            <ActivityIndicator size="small" color={Colors.navEmber} />
          ) : live ? (
            <ConnectedPill />
          ) : (
            <ConnectPill />
          )
        }
      />
      <CalendarConsentDialog
        visible={consent}
        busy={busy}
        onCancel={() => setConsent(false)}
        onContinue={() => void runConnect()}
      />
      <ConfirmDialog
        visible={confirmDisconnect}
        title="Disconnect your calendar?"
        body="Philoi will forget your calendar and revoke its access at Google."
        confirmLabel="Disconnect"
        busy={busy}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => void runDisconnect()}
      />
    </>
  );
}

// ─────────────────────────── pieces ───────────────────────────

function ConnectCard({
  tile,
  title,
  detail,
  trailing,
  dim,
  disabled,
  onPress,
}: {
  tile: { bg: string; icon: keyof typeof Ionicons.glyphMap; color: string };
  title: string;
  detail: string;
  trailing: ReactNode;
  /** Not available on this build (or not built yet) — drawn faded. */
  dim?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, dim && styles.cardOff, pressed && styles.cardPressed]}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || !onPress) }}
      accessibilityLabel={`${title}. ${detail}`}>
      <View style={[styles.tile, { backgroundColor: tile.bg }]}>
        <Ionicons name={tile.icon} size={20} color={tile.color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}

function ConnectPill() {
  return (
    <View style={styles.connectPill}>
      <Text style={styles.connectPillText}>Connect</Text>
    </View>
  );
}

function ConnectedPill() {
  return (
    <View style={styles.connectedPill}>
      <Ionicons name="checkmark" size={13} color={Colors.green} />
      <Text style={styles.connectedText}>Connected</Text>
    </View>
  );
}

function SoonPill() {
  return (
    <View style={styles.soonPill}>
      <Text style={styles.soonText}>Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.two,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(26,18,48,0.6)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  cardOff: {
    opacity: 0.55,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  detail: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  stravaButton: {
    height: 26,
    width: 128,
  },
  connectPill: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,176,90,0.45)',
    backgroundColor: 'rgba(255,122,47,0.10)',
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  connectPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.green,
  },
  soonPill: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  soonText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: Colors.spaceDim,
  },
});
