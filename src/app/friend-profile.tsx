import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { HexagonBadge } from '@/components/hexagon-badge';
import { CollectionEntry } from '@/components/profile/collection-entry';
import { CompareBanner } from '@/components/profile/compare-banner';
import { TrophyHallSection } from '@/components/profile/trophy-hall-section';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { ProgressBar } from '@/components/ui/progress-bar';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUserLockInPhotos, type MyRecentLockIn } from '@/lib/api/check-ins';
import { respondFriendRequest, sendFriendRequest } from '@/lib/api/friend-requests';
import { fetchActiveChallengeMarker, fetchProfileStats, fetchRelationshipWith, fetchUserBoardPosition } from '@/lib/api/leaderboard-social';
import { RankMuted } from '@/components/rank-muted';
import { fetchProfileById, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, formatXpProgress, xpProgressRatio } from '@/lib/rank-tiers';
import { supabase } from '@/lib/supabase';
import { getErrorMessage } from '@/lib/errors';
import type { ActiveChallengeMarker, Profile, ProfileRelationship, ProfileStats } from '@/types/database';

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours)}h`;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// The §16 friend-state-machine button (punchlist 2's friend-button design note) — each state
// reads visually distinct rather than a single flat pill: Add friend (coral filled) -> Requested
// (outline/muted, disabled) animates a quick fill-to-outline crossfade on the actual none-to-
// requested tap so it clearly registers; Friends renders as its own quiet confirmed pill (no
// tap-driven transition into it — that happens via the OTHER person accepting elsewhere).
function FriendActionButton({ relationship, busy, onPress }: { relationship: ProfileRelationship; busy: boolean; onPress: () => void }) {
  const fill = useSharedValue(relationship === 'requested' ? 1 : 0);
  const prevRelationship = useRef(relationship);

  useEffect(() => {
    if (prevRelationship.current === 'none' && relationship === 'requested') {
      fill.value = withTiming(1, { duration: 280 });
    }
    prevRelationship.current = relationship;
  }, [relationship, fill]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], [Colors.coral, Colors.card]),
    borderColor: interpolateColor(fill.value, [0, 1], [Colors.coral, Colors.lineStrong]),
  }));

  if (relationship === 'friends') {
    return (
      <View style={[styles.actFriend, styles.actFriendConfirmed]}>
        <Ionicons name="checkmark-circle" size={14} color={Colors.green} style={{ marginRight: 4 }} />
        <Text style={[styles.actFriendText, styles.actFriendTextConfirmed]}>Friends</Text>
      </View>
    );
  }

  return (
    <AnimatedPressable style={[styles.actFriend, animatedStyle]} onPress={onPress} disabled={busy || relationship !== 'none'}>
      {relationship === 'none' ? (
        <Ionicons name="person-add" size={14} color={Colors.ink} style={{ marginRight: 4 }} />
      ) : (
        <Ionicons name="checkmark" size={14} color={Colors.muted} style={{ marginRight: 4 }} />
      )}
      <Text style={[styles.actFriendText, relationship === 'none' && styles.actFriendTextOn]}>
        {relationship === 'none' ? 'Add friend' : 'Requested'}
      </Text>
    </AnimatedPressable>
  );
}

// Viewing someone else's profile (PHILOI_UI_SPEC.md §18, mock 43) — reached by tapping any name
// on the leaderboard/search (§15) or a friend row. NO redundant top-bar title; the name lives in
// the hero with the Friend tag. Distinct route from (tabs)/profile.tsx's own-profile layout since
// mock 43's centered hero + action row + Friend state machine are a meaningfully different shape.
export default function FriendProfileScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { profile: myProfile } = useAuth();

  // §4 — the hall renders here too, and the compare banner needs BOTH halls: the claim "she's
  // ahead on trophies, your win rate's higher" is a comparison, so neither side can be assumed.
  const theirHall = useTrophyHall(userId);
  const myHall = useTrophyHall(myProfile?.id);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [rank, setRank] = useState<UserRank | null>(null);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [photos, setPhotos] = useState<MyRecentLockIn[]>([]);
  const [relationship, setRelationship] = useState<ProfileRelationship>('none');
  const [marker, setMarker] = useState<ActiveChallengeMarker | null>(null);
  const [boardPosition, setBoardPosition] = useState<{ board: 'My uni' | 'Global'; rank: number } | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!userId || userId === myProfile?.id) return;
    fetchProfileById(userId).then(setProfile).catch(() => {});
    fetchUserRank(userId).then(setRank).catch(() => {});
    fetchProfileStats(userId).then(setStats).catch(() => {});
    fetchUserLockInPhotos(userId).then(setPhotos).catch(() => {});
    fetchRelationshipWith(userId).then(setRelationship).catch(() => {});
    fetchActiveChallengeMarker(userId).then(setMarker).catch(() => {});
    fetchUserBoardPosition(userId).then(setBoardPosition).catch(() => {});
  }, [userId, myProfile?.id]);

  useEffect(() => {
    if (profile) track('friend_profile_viewed', { user_id: profile.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per profile load, not on every field change
  }, [Boolean(profile)]);

  if (!userId || userId === myProfile?.id) return null;
  if (!profile) return <View style={styles.safeArea} />;

  // 'requested' is deliberately NOT tappable here (punchlist 2's friend-button state note: it
  // reads as a disabled, already-sent confirmation) — cancelling a sent request happens from
  // wherever pending requests are managed, not by tapping this pill again.
  async function handleAddFriend() {
    if (!userId || relationshipBusy || relationship !== 'none') return;
    setRelationshipBusy(true);
    try {
      await sendFriendRequest(userId);
      setRelationship('requested');
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Try again.'));
    } finally {
      setRelationshipBusy(false);
    }
  }

  async function handleRespondIncoming(accept: boolean) {
    if (!userId || relationshipBusy) return;
    setRelationshipBusy(true);
    try {
      await respondFriendRequest(userId, accept);
      setRelationship(accept ? 'friends' : 'none');
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Try again.'));
    } finally {
      setRelationshipBusy(false);
    }
  }

  function handleChallenge() {
    router.push({
      pathname: '/challenge/create',
      params: { opponentId: userId, opponentName: profile!.display_name, mode: 'h2h' },
    });
  }

  function handleWatch() {
    if (!marker?.can_watch) return;
    router.push({ pathname: '/watch/[challengeId]', params: { challengeId: marker.challenge_id, mode: marker.mode } });
  }

  async function handleBlock() {
    if (!myProfile) return;
    await supabase.from('blocked_users').insert({ blocker_id: myProfile.id, blocked_id: userId });
    router.back();
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-down" size={20} color={Colors.muted} />
        </Pressable>
        <Pressable onPress={() => setMoreOpen(true)} hitSlop={8} accessibilityLabel="More options">
          <Ionicons name="ellipsis-horizontal" size={20} color={Colors.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{profile.display_name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.nameRow}>
            <Text style={styles.name}>{profile.display_name}</Text>
            {relationship === 'friends' && (
              <View style={styles.friendTag}>
                <Text style={styles.friendTagText}>Friend</Text>
              </View>
            )}
          </View>
          <Text style={styles.handle}>
            @{profile.handle}
            {profile.university ? ` · ${profile.university}` : ''}
          </Text>
        </View>

        <View style={styles.acts}>
          {relationship === 'incoming' ? (
            <>
              <Pressable style={[styles.actFriend, styles.actDecline]} onPress={() => handleRespondIncoming(false)} disabled={relationshipBusy}>
                <Text style={styles.actDeclineText}>Decline</Text>
              </Pressable>
              <Pressable style={[styles.actFriend, styles.actAccept]} onPress={() => handleRespondIncoming(true)} disabled={relationshipBusy}>
                <Ionicons name="checkmark" size={15} color={Colors.ink} style={{ marginRight: 4 }} />
                <Text style={styles.actAcceptText}>Accept</Text>
              </Pressable>
            </>
          ) : (
            <FriendActionButton relationship={relationship} busy={relationshipBusy} onPress={handleAddFriend} />
          )}
          <Pressable style={styles.actChallenge} onPress={handleChallenge}>
            <Ionicons name="flash" size={15} color={Colors.ink} style={{ marginRight: 4 }} />
            <Text style={styles.actChallengeText}>Challenge</Text>
          </Pressable>
        </View>

        {/* 0170 · Private mode. A non-friend sees "Rank muted" where the hexagon, the XP bar and
            the board position would be. The name, handle and avatar above are untouched. */}
        {rank?.muted && <RankMuted />}

        {rank && !rank.muted && (
          <View style={styles.rankCard}>
            <HexagonBadge tier={rank.tier} division={rank.division} size={52} />
            <View style={styles.rankInfo}>
              <View style={styles.rankTop}>
                <Text style={styles.rankTier}>{formatRankTier(rank.tier, rank.division)}</Text>
                <Text style={styles.rankXp}>{formatXpProgress(rank.xp_into_tier, rank.xp_for_next_tier)}</Text>
              </View>
              <ProgressBar ratio={xpProgressRatio(rank.xp_into_tier, rank.xp_for_next_tier)} />
              {boardPosition && (
                <Text style={styles.boardPosition}>
                  #{boardPosition.rank.toLocaleString()} on {boardPosition.board}
                </Text>
              )}
            </View>
          </View>
        )}

        {stats && (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>🔥 {stats.current_streak}</Text>
              <Text style={styles.statLabel}>day streak</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{stats.lock_in_count}</Text>
              <Text style={styles.statLabel}>lock-ins</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatHours(stats.hours_locked_in)}</Text>
              <Text style={styles.statLabel}>locked in</Text>
            </View>
          </View>
        )}

        {marker && (
          <View style={styles.markerRow}>
            <ActiveChallengeMarkerChip marker={marker} onWatch={marker.can_watch ? handleWatch : undefined} />
          </View>
        )}

        {/* §4 — the compare banner, then their hall. This is the payoff of the hall being
            earned-only: two people's placements, relics and records side by side is a status read
            no amount of shop spending can fake. */}
        {myHall && theirHall && profile ? (
          <CompareBanner mine={myHall} theirs={theirHall} name={profile.display_name} />
        ) : null}

        {theirHall ? <TrophyHallSection hall={theirHall} userId={userId} isOwn={false} /> : null}

        {/* §7 — their closet, read-only. */}
        {profile ? (
          <CollectionEntry
            userId={userId}
            isOwn={false}
            name={profile.display_name}
            count={theirHall?.collection_count ?? null}
          />
        ) : null}

        {stats && stats.goal_types.length > 0 && (
          <>
            <Text style={styles.seclbl}>Works on</Text>
            <View style={styles.chips}>
              {stats.goal_types.map((type) => (
                <View key={type} style={styles.chip}>
                  <DisciplineIcon name={GOAL_TYPE_GLYPH[type as keyof typeof GOAL_TYPE_GLYPH]} size={12} color={Colors.ember} />
                  <Text style={styles.chipText}>{GOAL_TYPE_META[type as keyof typeof GOAL_TYPE_META]?.label ?? type}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {photos.length > 0 && (
          <>
            <Text style={styles.seclbl}>Recent lock-ins</Text>
            <View style={styles.grid}>
              {photos.map((p) => (
                <View key={p.id} style={styles.ph}>
                  {p.signedPhotoUrl ? (
                    <Image source={{ uri: p.signedPhotoUrl }} style={styles.phImage} />
                  ) : (
                    <View style={[styles.phImage, styles.phFallback]}>
                      <DisciplineIcon name={GOAL_TYPE_GLYPH[p.goal_type]} size={26} color={Colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.ov}>
                    <DisciplineIcon name={GOAL_TYPE_GLYPH[p.goal_type]} size={11} color="#FFFFFF" />
                    <Text style={styles.ovDuration}>{formatSessionDuration(p.duration_seconds ?? 0)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ReportBlockSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onReport={() => router.push({ pathname: '/report', params: { userId } })}
        onBlock={handleBlock}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    // Was Colors.cream, an opaque flat fill that painted over the deep-purple radial. These
    // screens don't route through <Screen>, so the radial reaches them from the navigator's
    // scene background — an opaque colour here blocks it (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  container: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
  },
  hero: {
    alignItems: 'center',
    marginTop: 8,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  avatarFallback: {
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.display,
    fontSize: 30,
    color: Colors.ember,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 9,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 19,
    color: Colors.ink,
  },
  friendTag: {
    backgroundColor: 'rgba(61,168,92,0.15)',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  friendTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.green,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 2,
  },
  acts: {
    flexDirection: 'row',
    gap: 9,
    width: '100%',
    marginTop: 14,
  },
  actFriend: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.button,
    paddingVertical: Spacing.two,
  },
  actFriendText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  // 'none' -> Add friend text color; the coral fill itself is animated (see FriendActionButton).
  actFriendTextOn: {
    color: Colors.ink,
  },
  // 'friends' -> Friends ✓: a quieter confirmed pill, distinct from both the coral CTA and the
  // plain outline 'requested' look.
  actFriendConfirmed: {
    backgroundColor: Colors.achieverBg,
    borderColor: 'transparent',
  },
  actFriendTextConfirmed: {
    color: Colors.green,
  },
  // 'incoming' -> Accept (green filled) + a secondary Decline (outline) side by side.
  actAccept: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  actAcceptText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  actDecline: {
    backgroundColor: 'transparent',
  },
  actDeclineText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  actChallenge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.two,
  },
  actChallengeText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 15,
    padding: 14,
    marginTop: 16,
  },
  rankInfo: {
    flex: 1,
    minWidth: 0,
  },
  rankTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rankTier: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
  rankXp: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  boardPosition: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.amber,
    marginTop: 5,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.cardDark,
    borderRadius: 14,
    padding: 13,
    marginTop: 12,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 17,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  markerRow: {
    marginTop: 14,
  },
  seclbl: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.textTertiary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 9,
  },
  chips: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    fontSize: 11.5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  ph: {
    width: '32%',
    aspectRatio: 1,
    borderRadius: 9,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  phImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  phFallback: {
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ov: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 5,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  ovDuration: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9,
    color: '#FFFFFF',
  },
});
