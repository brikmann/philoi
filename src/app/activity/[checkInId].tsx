import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PhotoViewer } from '@/components/photo-viewer';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchSyncedActivityDetail, type SyncedActivityDetail } from '@/lib/api/synced-activity';
import { formatDistanceKm, formatDurationClock, formatPacePerKm } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { decodePolyline, polylineToSvgPath } from '@/lib/polyline';
import { openStravaActivity } from '@/lib/strava';

// Official "Powered by Strava" lockup — the same bundled asset the feed card and home diary use
// (developers.strava.com/guidelines: use the official asset, never redraw it), kept visually
// secondary to Philoi's own chrome.
const STRAVA_BADGE = require('../../../assets/strava/powered-by/api_logo_pwrdBy_strava_horiz_orange.png');
const STRAVA_ORANGE = '#FC4C02';

const MAP_HEIGHT = 150;

function formatSyncedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Profile / activity detail (PHILOI_UI_SPEC.md §17b, design-mocks/40 frame 3) — "tap a synced
// activity to revisit route, splits, and the photos you took on that lock-in." Owner-only by
// construction: synced_activity_details is RLS'd to the owner (migration 0043), so this route is
// reached from your OWN diary, never from a campfire-mate's feed card (that card deep-links
// straight to Strava instead).
export default function ActivityDetailScreen() {
  const router = useRouter();
  const { checkInId } = useLocalSearchParams<{ checkInId: string }>();
  const { width } = useWindowDimensions();
  const [detail, setDetail] = useState<SyncedActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  useEffect(() => {
    if (!checkInId) return;
    let cancelled = false;
    fetchSyncedActivityDetail(checkInId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [checkInId]);

  const mapWidth = width - Spacing.four * 2;
  const routePolyline = detail?.routePolyline ?? null;
  // Decoding a few hundred track points on every re-render (the photo viewer opening, say) is
  // the one thing on this screen worth memoizing.
  const routePath = useMemo(
    () => (routePolyline ? polylineToSvgPath(decodePolyline(routePolyline), mapWidth, MAP_HEIGHT) : null),
    [routePolyline, mapWidth]
  );

  if (loading) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Colors.coral} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen style={styles.centered}>
        <Text style={styles.emptyText}>This activity isn’t available.</Text>
      </Screen>
    );
  }

  const { checkIn } = detail;
  const isStrava = checkIn.source === 'strava';
  const duration = checkIn.duration_seconds ?? 0;
  const pace = checkIn.distance_m ? formatPacePerKm(checkIn.distance_m, duration) : null;
  // Strava's brand/API terms require attributing the recording device when the activity came
  // from a Garmin (§17b brand compliance).
  const isGarmin = Boolean(detail.deviceName && /garmin/i.test(detail.deviceName));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-down" size={22} color={Colors.muted} />
        </Pressable>

        <Text style={styles.title}>{checkIn.goal_detail || GOAL_TYPE_META[checkIn.goal_type].label}</Text>

        {isStrava && (
          <View style={styles.syncedRow}>
            <RNImage source={STRAVA_BADGE} style={styles.stravaBadge} resizeMode="contain" />
            <Text style={styles.syncedText}>Synced from Strava · {formatSyncedAgo(checkIn.created_at)}</Text>
          </View>
        )}

        {/* The route, drawn straight from Strava's summary polyline as an SVG path — no map SDK,
            so this whole feature stays JS-only/OTA-shippable (§17b). A gym session or an
            indoor run has no GPS track, so the map simply doesn't render. */}
        {routePath && (
          <View style={[styles.map, { height: MAP_HEIGHT }]}>
            <Svg width={mapWidth} height={MAP_HEIGHT}>
              <Path d={routePath} stroke={STRAVA_ORANGE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </View>
        )}

        <View style={styles.statRow}>
          {checkIn.distance_m != null && <StatCell value={formatDistanceKm(checkIn.distance_m).replace(' km', '')} label="KM" />}
          <StatCell value={formatDurationClock(duration)} label="TIME" />
          {pace && <StatCell value={pace.replace('/km', '')} label="/KM" />}
          {detail.calories != null && <StatCell value={String(Math.round(detail.calories))} label="CAL" />}
          {detail.elevationGainM != null && detail.elevationGainM > 0 && (
            <StatCell value={String(Math.round(detail.elevationGainM))} label="ELEV M" />
          )}
        </View>

        {detail.splits.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Splits</Text>
            <View style={styles.splitsCard}>
              {detail.splits.map((split) => (
                <View key={split.split} style={styles.splitRow}>
                  <Text style={styles.splitIndex}>KM {split.split}</Text>
                  <Text style={styles.splitPace}>{formatPacePerKm(split.distance, split.moving_time) ?? '—'}</Text>
                  <Text style={styles.splitTime}>{formatDurationClock(split.moving_time)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* IN-APP lock-in photos, not Strava's (§17b photos-scope note: the OAuth scope here is
            activity:read — stats and route only — so pulling Strava's own photos would need a
            broader scope and another brand review). */}
        {detail.signedPhotoUrls.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Photos from this lock-in</Text>
            <View style={styles.photoGrid}>
              {detail.signedPhotoUrls.map((uri) => (
                <Pressable key={uri} onPress={() => setViewerUri(uri)}>
                  <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={150} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {isStrava && checkIn.external_id && (
          <>
            {/* "View on Strava" is the exact required link wording (developers.strava.com/
                guidelines) — kept verbatim even though the mock's caption sketched it as "Open
                full activity on Strava," since the wording is the hard compliance rule. */}
            <Pressable style={styles.openButton} onPress={() => openStravaActivity(checkIn.external_id!)}>
              <RNImage source={STRAVA_BADGE} style={styles.buttonBadge} resizeMode="contain" />
              <Text style={styles.openButtonText}>View on Strava</Text>
              <Ionicons name="open-outline" size={14} color={Colors.ink} />
            </Pressable>

            {isGarmin && <Text style={styles.attribution}>Recorded with {detail.deviceName}.</Text>}
          </>
        )}
      </ScrollView>

      <PhotoViewer visible={viewerUri !== null} uri={viewerUri} onClose={() => setViewerUri(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
  title: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 24,
    color: Colors.ink,
  },
  syncedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  stravaBadge: {
    height: 12,
    width: 74,
  },
  syncedText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: STRAVA_ORANGE,
  },
  map: {
    borderRadius: Radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'rgba(252,76,2,0.25)',
    overflow: 'hidden',
    marginBottom: Spacing.three,
  },
  statRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 18,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: Colors.muted,
  },
  sectionLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: Colors.muted,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  splitsCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  splitIndex: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  splitPace: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  splitTime: {
    flex: 1,
    textAlign: 'right',
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Radius.card,
    backgroundColor: 'rgba(252,76,2,0.14)',
    borderWidth: 1,
    borderColor: STRAVA_ORANGE,
  },
  buttonBadge: {
    height: 13,
    width: 80,
  },
  openButtonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  attribution: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
