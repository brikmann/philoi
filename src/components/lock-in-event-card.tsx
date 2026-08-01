import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';

import { GymClipThumbnail } from '@/components/gym-clip-player';
import { PhotoViewer } from '@/components/photo-viewer';
import { ReactionBar } from '@/components/reaction-bar';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius } from '@/constants/theme';
import type { FeedCheckIn } from '@/lib/api/check-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchCheckInClips } from '@/lib/api/gym-clips';
import { formatDistanceKm, formatPacePerKm, formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { openStravaActivity } from '@/lib/strava';
import { supabase } from '@/lib/supabase';
import type { WorkoutSet } from '@/types/database';

// The official "Powered by Strava" horizontal orange lockup (developers.strava.com/guidelines —
// use the official asset, never redraw the logo). There's no bare icon-only asset bundled, so
// this compact lockup stands in for "the Strava mark" wherever the card needs one; it's already
// sized/colored to stay clearly secondary to Philoi's own coral/amber brand language.
const STRAVA_BADGE = require('../../assets/strava/powered-by/api_logo_pwrdBy_strava_horiz_orange.png');
const STRAVA_ORANGE = '#FC4C02';

type LockInEventCardProps = {
  item: FeedCheckIn;
  onReactionChanged: () => void;
};

// A card in a scrolling chain, not a workout screen — enough lifts to read the session at a
// glance, then a count for the rest.
const MAX_LIFTS_SHOWN = 4;

// The campfire chain's core content — proof of showing up (PHILOI_UI_SPEC.md §12,
// design-mocks/06's `.lock`): thin coral left-edge, goal icon tile, "{Name} locked in" +
// "{duration} · {goal}" + "+{xp} XP · fed the fire", an optional photo thumb on the right,
// and a compact reaction tally (the picker only appears on tap — see reaction-bar.tsx).
export function LockInEventCard({ item, onReactionChanged }: LockInEventCardProps) {
  const router = useRouter();
  const { session } = useAuth();
  const isOwnPost = item.user_id === session?.user.id;
  const goalLabel = item.goal_detail || item.goal_label || GOAL_TYPE_META[item.goal_type]?.label || item.goal_type;
  const photoUri = item.signedPhotoUrls[0];
  const [viewerOpen, setViewerOpen] = useState(false);
  // Synced-activity cross-integration (§17b) — orange is the "a connected app did this" signal,
  // never applied to an ordinary manual lock-in.
  const isSynced = item.source !== 'manual';
  const isStrava = item.source === 'strava';
  // Phase-2 video clips (§23) — item.workoutSets is a flat check_in_workout_sets SNAPSHOT (no
  // real workout_set ids), so clips need their own fetch off the real table, same as the
  // done-screen recap.
  const [clips, setClips] = useState<WorkoutSet[]>([]);
  useEffect(() => {
    if (!GYM_VIDEO_CLIPS_ENABLED || item.workoutSets.length === 0) return;
    fetchCheckInClips(item.id)
      .then(setClips)
      .catch(() => {
        // A bonus row, not core data — a failed fetch just hides it.
      });
  }, [item.id, item.workoutSets.length]);
  const pace = item.distance_m ? formatPacePerKm(item.distance_m, item.duration_seconds ?? 0) : null;

  function handleMore() {
    const options = isOwnPost
      ? [{ text: 'Cancel', style: 'cancel' as const }]
      : [
          { text: 'Report', onPress: () => router.push(`/report?checkInId=${item.id}&userId=${item.user_id}`) },
          {
            text: 'Block user',
            style: 'destructive' as const,
            onPress: async () => {
              if (!session) return;
              await supabase.from('blocked_users').insert({ blocker_id: session.user.id, blocked_id: item.user_id });
              onReactionChanged();
              Alert.alert('User blocked', "You won't see their posts anymore.");
            },
          },
          { text: 'Cancel', style: 'cancel' as const },
        ];
    Alert.alert(isOwnPost ? 'Options' : 'Report or block', '', options);
  }

  return (
    // "Tapping the card/link deep-links to the actual activity" (§17b) — the whole card, not just
    // the "View on Strava" line, on a Strava-sourced post. Deliberately Strava's own page rather
    // than an in-app detail screen: this card can belong to a campfire-mate, and their route/split
    // data is theirs to serve, not ours (see migration 0043's owner-only policy).
    <Pressable
      style={[styles.card, isSynced && styles.cardSynced]}
      onLongPress={handleMore}
      onPress={isStrava && item.external_id ? () => openStravaActivity(item.external_id!) : undefined}>
      <View style={[styles.icon, isSynced && styles.iconSynced]}>
        <Ionicons name={GOAL_TYPE_ICON[item.goal_type]} size={18} color={isSynced ? STRAVA_ORANGE : Colors.amber} />
      </View>

      <View style={styles.textCol}>
        {isStrava && (
          <View style={styles.syncedBadgeRow}>
            <RNImage source={STRAVA_BADGE} style={styles.stravaBadge} resizeMode="contain" />
            <Text style={styles.syncedBadgeText}>Activity · Strava</Text>
          </View>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {item.profiles.display_name} locked in
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {formatSessionDuration(item.duration_seconds ?? 0)} · {goalLabel}
        </Text>

        {/* Real stats from the synced activity (§17b) — distance/time/pace, not just the
            generic duration line every lock-in already gets above. */}
        {item.distance_m != null && (
          <Text style={styles.syncedStats} numberOfLines={1}>
            {formatDistanceKm(item.distance_m)}
            {pace ? ` · ${pace}` : ''}
          </Text>
        )}

        <View style={styles.xpRow}>
          <Ionicons name="flash" size={11} color={Colors.achieverText} />
          <Text style={styles.xpLine}>+{Math.round(item.xp_earned)} XP · fed the fire</Text>
        </View>

        {/* Gym lifts + PRs (PHILOI_UI_SPEC.md §23) — what actually makes a posted workout worth
            reacting to. Capped so one long session can't dominate the chain; the count line
            below says plainly what was trimmed rather than silently hiding it. */}
        {item.workoutSets.length > 0 && (
          <View style={styles.lifts}>
            {item.workoutSets.slice(0, MAX_LIFTS_SHOWN).map((lift, i) => (
              <View key={i} style={styles.liftRow}>
                <Text style={styles.liftText} numberOfLines={1}>
                  {lift.exercise} · {lift.sets}×{lift.reps}
                  {lift.weight ? ` @ ${lift.weight}` : ''}
                </Text>
                {lift.is_pr && (
                  <View style={styles.prTag}>
                    <Ionicons name="trophy" size={8} color={Colors.achieverText} />
                    <Text style={styles.prTagText}>PR</Text>
                  </View>
                )}
              </View>
            ))}
            {item.workoutSets.length > MAX_LIFTS_SHOWN && (
              <Text style={styles.liftMore}>+{item.workoutSets.length - MAX_LIFTS_SHOWN} more</Text>
            )}
          </View>
        )}

        {/* Video clips (§23) — "a PR clip is the flex, a form clip invites feedback." */}
        {clips.length > 0 && (
          <View style={styles.clipsRow}>
            {clips.map((c) => (
              <GymClipThumbnail key={c.id} workoutSetId={c.id} size={56} />
            ))}
          </View>
        )}

        {/* HONEST BRAG (§23 rule 2): brag_earned is set server-side at Finish and is only ever
            true when the session produced a real PR — picking "dialed" and coasting shows
            nothing here, which is what keeps the signal worth trusting. */}
        {item.workout?.brag_earned && (
          <Text style={styles.brag}>was feeling dialed today — and hit a new best</Text>
        )}

        {item.caption && (
          <Text style={styles.caption} numberOfLines={2}>
            {item.caption}
          </Text>
        )}

        {/* Exact required link wording (developers.strava.com/guidelines) — deep-links to the
            Strava app, falling back to the web activity page if it isn't installed. */}
        {isStrava && item.external_id && (
          <Pressable onPress={() => openStravaActivity(item.external_id!)} style={styles.viewOnStrava}>
            <Text style={styles.viewOnStravaText}>View on Strava</Text>
            <Ionicons name="open-outline" size={12} color={STRAVA_ORANGE} />
          </Pressable>
        )}

        <ReactionBar checkInId={item.id} reactions={item.reactions} onChanged={onReactionChanged} compact />
      </View>

      {photoUri && (
        <Pressable onPress={() => setViewerOpen(true)} accessibilityLabel="View photo">
          <Image source={{ uri: photoUri }} style={styles.photo} />
        </Pressable>
      )}

      <PhotoViewer visible={viewerOpen} uri={photoUri ?? null} onClose={() => setViewerOpen(false)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: Colors.cardDark,
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
    borderTopRightRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  // Orange is the "a connected app did this" signal (§17b) — a full border + a faint tinted
  // background reads as a glow without needing an actual shadow/blur effect.
  cardSynced: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: 'rgba(252,76,2,0.35)',
    borderLeftColor: STRAVA_ORANGE,
    backgroundColor: 'rgba(252,76,2,0.06)',
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSynced: {
    backgroundColor: 'rgba(252,76,2,0.14)',
  },
  syncedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  stravaBadge: {
    height: 12,
    width: 74,
  },
  syncedBadgeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: STRAVA_ORANGE,
  },
  syncedStats: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  viewOnStrava: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 6,
  },
  viewOnStravaText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: STRAVA_ORANGE,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 1,
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  xpLine: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.achieverText,
  },
  lifts: {
    gap: 2,
    marginTop: 5,
  },
  clipsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  liftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liftText: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  prTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  prTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.achieverText,
  },
  liftMore: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  brag: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
    marginTop: 5,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
    marginTop: 4,
  },
  photo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.disabled,
  },
});
