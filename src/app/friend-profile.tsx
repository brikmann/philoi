import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { PublicTitle } from '@/components/economy/loadout-bits';
import { HeroRankStrip, ProfileHero } from '@/components/economy/profile-hero';
import { DisciplineMixBar } from '@/components/identity/discipline-mix-bar';
import { IdentityCard } from '@/components/identity/identity-card';
import { IdentityHeadline } from '@/components/identity/identity-headline';
import { MomentumStrip } from '@/components/identity/momentum-strip';
import { useProfileIdentity } from '@/components/identity/use-profile-identity';
import { LiveStatusBadge } from '@/components/live-status-badge';
import { CollectionEntry } from '@/components/profile/collection-entry';
import { CompareBanner } from '@/components/profile/compare-banner';
import { DisciplineRelicTracker } from '@/components/profile/discipline-relic-tracker';
import { ProfileShowcase } from '@/components/profile/profile-showcase';
import { TrophyHallSection } from '@/components/profile/trophy-hall-section';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { IconText } from '@/components/ui/icon';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { SpaceHeader, SpaceIconButton, SpaceSection } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { usePresenceOf } from '@/hooks/use-presence';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchUserLockInPhotos, type MyRecentLockIn } from '@/lib/api/check-ins';
import { respondFriendRequest, sendFriendRequest } from '@/lib/api/friend-requests';
import { fetchActiveChallengeMarker, fetchProfileStats, fetchRelationshipWith, fetchUserBoardPosition } from '@/lib/api/leaderboard-social';
import { RankMuted } from '@/components/rank-muted';
import { fetchProfileById, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { formatSessionDuration } from '@/lib/format';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { blockUser } from '@/lib/api/agora';
import { getErrorMessage } from '@/lib/errors';
import type { ActiveChallengeMarker, Profile, ProfileRelationship, ProfileStats } from '@/types/database';

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours)}h`;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// The §16 friend-state-machine button (punchlist 2's friend-button design note) — each state
// reads visually distinct rather than a single flat pill: Add friend (ember filled) -> Requested
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
    backgroundColor: interpolateColor(fill.value, [0, 1], [Colors.navEmber, Colors.spacePanel2]),
    borderColor: interpolateColor(fill.value, [0, 1], [Colors.navEmber, Colors.spaceLine]),
  }));

  if (relationship === 'friends') {
    return (
      <View style={[styles.actFriend, styles.actFriendConfirmed]}>
        <UiGlyph name="check" size={14} color={Colors.gold} />
        <Text style={[styles.actFriendText, styles.actFriendTextConfirmed]}>Friends</Text>
      </View>
    );
  }

  return (
    <AnimatedPressable style={[styles.actFriend, animatedStyle]} onPress={onPress} disabled={busy || relationship !== 'none'}>
      {relationship === 'none' ? (
        <SocialGlyph name="personAdd" size={15} color="#2A0F05" />
      ) : (
        <UiGlyph name="check" size={14} color={Colors.spaceDim} />
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
  // THEIR loadout, not yours — every cosmetic on this screen is driven by this one read.
  const loadout = usePublicLoadout(userId);
  // Live status (0245). Last-active is friends-only and the server already nulls it for anyone
  // else, so the header can always ask for it.
  const presence = usePresenceOf(userId === myProfile?.id ? null : userId);
  const myHall = useTrophyHall(myProfile?.id);
  // Their identity layer (0272). The server has already applied their visibility dial — fields this
  // viewer may not see simply aren't in the row — so this screen renders whatever comes back, and
  // a failed read renders nothing.
  const { identity, mix } = useProfileIdentity(userId === myProfile?.id ? null : userId);

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

  // Head to head (mock 292) — any stats, side by side, with a ⚔ hand-off to a real duel. Not gated
  // on friendship or on their rank being public: versus() is the one that says "they keep their
  // stats private", and it says it on the compare screen rather than as a missing button here.
  function handleHeadToHead() {
    router.push({ pathname: '/versus', params: { with: userId } });
  }

  // WS3 · the 1:1 thread (MESSAGING_DM_SPEC.md). Rendered only for an accepted friend, because
  // friends-only is the server's rule too — dm_open_thread refuses a non-friend — and a button
  // whose only outcome is "You can only message friends." is worse than no button.
  function handleMessage() {
    router.push({ pathname: '/dm/[friendId]', params: { friendId: userId } });
  }

  function handleWatch() {
    if (!marker?.can_watch) return;
    router.push({ pathname: '/watch/[challengeId]', params: { challengeId: marker.challenge_id, mode: marker.mode } });
  }

  async function handleBlock() {
    if (!myProfile) return;
    try {
      await blockUser(myProfile.id, userId);
    } catch (e) {
      Alert.alert('Could not block', getErrorMessage(e, 'Try again.'));
      return;
    }
    router.back();
    Alert.alert('User blocked', "You won't see their posts or messages anymore.");
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {/* The kit header with an empty title — mock 43 keeps the name in the hero, not a top bar. */}
      <SpaceHeader
        title=""
        onBack={() => router.back()}
        right={
          <SpaceIconButton onPress={() => setMoreOpen(true)} label="More options">
            <UiGlyph name="more" size={18} color={Colors.ink} />
          </SpaceIconButton>
        }
      />

      <ScrollView contentContainerStyle={styles.container}>
        {/* THE flex surface: this is the screen a leaderboard or a search result opens, so it is
            where someone's whole loadout lands at once — mock 248's composite, the SAME component
            your own profile draws (ProfileHero): their Flare as the card's border, their Banner as
            the mat, their Card behind it, THEM (photo or initial, never a flame) ringed by their
            Halo, the burning name, their Title, and the rank strip with the season chip. One
            component is what keeps the two profiles from drifting again — this screen once drew no
            card at all, so a card was a flex only its owner could see. */}
        <ProfileHero
          userId={userId}
          name={profile.display_name}
          handle={profile.handle}
          avatarUrl={profile.avatar_url}
          loadout={loadout}
          avatarSize={66}
          title={<PublicTitle loadout={loadout} />}
          footer={
            rank && !rank.muted ? (
              <HeroRankStrip
                rank={rank}
                sub={boardPosition ? `#${boardPosition.rank.toLocaleString()} on ${boardPosition.board}` : null}
              />
            ) : null
          }>
          {/* "What they wanna be" — the headline under the name (mock 283's `.pf-head`). */}
          <IdentityHeadline identity={identity} />
          {profile.university || relationship === 'friends' ? (
            <View style={styles.metaRow}>
              {relationship === 'friends' && (
                <View style={styles.friendTag}>
                  <Text style={styles.friendTagText}>Friend</Text>
                </View>
              )}
              {profile.university ? (
                <Text style={styles.uni} numberOfLines={1}>
                  {profile.university}
                </Text>
              ) : null}
            </View>
          ) : null}
          <LiveStatusBadge presence={presence} variant="pill" lastActive />
        </ProfileHero>

        <View style={styles.acts}>
          {relationship === 'incoming' ? (
            <>
              <Pressable style={[styles.actFriend, styles.actDecline]} onPress={() => handleRespondIncoming(false)} disabled={relationshipBusy}>
                <Text style={styles.actDeclineText}>Decline</Text>
              </Pressable>
              <Pressable style={[styles.actFriend, styles.actAccept]} onPress={() => handleRespondIncoming(true)} disabled={relationshipBusy}>
                <UiGlyph name="check" size={15} color="#2A0F05" />
                <Text style={styles.actAcceptText}>Accept</Text>
              </Pressable>
            </>
          ) : (
            <FriendActionButton relationship={relationship} busy={relationshipBusy} onPress={handleAddFriend} />
          )}
          {/* WS3 · the entry point this row was missing entirely — you could add someone and race
              them, and not say a word to them. Friends only, matching dm_open_thread's own gate. */}
          {relationship === 'friends' && (
            <Pressable style={styles.actMessage} onPress={handleMessage} accessibilityLabel={`Message ${profile.display_name}`}>
              <SocialGlyph name="chat" size={16} color={Colors.ink} />
              <Text style={styles.actMessageText}>Message</Text>
            </Pressable>
          )}
          <Pressable style={styles.actChallenge} onPress={handleChallenge}>
            <SocialGlyph name="bolt" size={15} color="#2A0F05" />
            <Text style={styles.actChallengeText}>Challenge</Text>
          </Pressable>
        </View>
        <Pressable style={styles.actVersus} onPress={handleHeadToHead} accessibilityLabel={`Head to head with ${profile.display_name}`}>
          <SocialGlyph name="swords" size={15} color={Colors.legend} />
          <Text style={styles.actVersusText}>Head to head</Text>
          <Text style={styles.actVersusSub}>Compare any stats</Text>
        </Pressable>

        {/* The identity layer leads (CODE_PROMPT_identity_profile.md): who they are and how they're
            moving, above the rank, showcase and trophies that back it up. */}
        <MomentumStrip identity={identity} />
        <IdentityCard identity={identity} />
        <DisciplineMixBar mix={mix} isOwn={false} />

        {/* 0170 · Private mode. A non-friend sees "Rank muted" where the hexagon, the XP bar and
            the board position would be. The name, handle and avatar above are untouched. */}
        {rank?.muted && <RankMuted />}

        {/* Their rank lives in the card's strip now (mock 248), with the board position as its sub-line. */}

        {/* Mock 248's Showcase, directly under the card and the actions. */}
        {theirHall ? <ProfileShowcase hall={theirHall} userId={userId} /> : null}

        {/* #204 · their discipline relics, beside their rank — same tracker as your own profile. */}
        {theirHall ? <DisciplineRelicTracker relics={theirHall.relics} userId={userId} isOwn={false} /> : null}

        {stats && (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <IconText icon="streak" style={styles.statValue} iconColor={Colors.amber}>
                {stats.current_streak}
              </IconText>
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

        {theirHall ? <TrophyHallSection hall={theirHall} userId={userId} isOwn={false} showFeatured={false} /> : null}

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
            <SpaceSection>Works on</SpaceSection>
            <View style={styles.chips}>
              {stats.goal_types.map((type) => (
                <View key={type} style={styles.chip}>
                  <DisciplineIcon name={GOAL_TYPE_GLYPH[type as keyof typeof GOAL_TYPE_GLYPH]} size={12} color={Colors.navEmber2} />
                  <Text style={styles.chipText}>{GOAL_TYPE_META[type as keyof typeof GOAL_TYPE_META]?.label ?? type}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {photos.length > 0 && (
          <>
            <SpaceSection>Recent lock-ins</SpaceSection>
            <View style={styles.grid}>
              {photos.map((p) => (
                <View key={p.id} style={styles.ph}>
                  {p.signedPhotoUrl ? (
                    <Image source={{ uri: p.signedPhotoUrl }} style={styles.phImage} />
                  ) : (
                    <View style={[styles.phImage, styles.phFallback]}>
                      <DisciplineIcon name={GOAL_TYPE_GLYPH[p.goal_type]} size={26} color={Colors.spaceFaint} />
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
  container: {
    paddingHorizontal: Spacing.three,
    paddingTop: 0,
    paddingBottom: Spacing.six,
  },
  // Friend tag + university, one line under the title inside the card.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  uni: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  // Gold = earned + identity: being their friend is a standing, not a status light.
  friendTag: {
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 7,
  },
  friendTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.gold,
  },
  acts: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
    marginTop: 14,
  },
  actFriend: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: Spacing.two,
  },
  actFriendText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  // 'none' -> Add friend text on the ember fill; the fill itself is animated (see FriendActionButton).
  actFriendTextOn: {
    fontFamily: Fonts.bodyBold,
    color: '#2A0F05',
  },
  // 'friends' -> Friends ✓: the kit's gold tone — a quieter confirmed pill, distinct from both the
  // ember CTA and the plain panel 'requested' look.
  actFriendConfirmed: {
    backgroundColor: 'rgba(255,209,102,0.07)',
    borderColor: '#5A4A1E',
  },
  actFriendTextConfirmed: {
    color: Colors.gold,
  },
  // 'incoming' -> Accept (ember filled, the one action) + a secondary Decline (panel) side by side.
  actAccept: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  actAcceptText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#2A0F05',
  },
  actDecline: {
    backgroundColor: Colors.spacePanel2,
  },
  actDeclineText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  // WS3 · Message. A panel button rather than a second ember fill: the row already has one
  // primary (Challenge), and two competing fills side by side read as a choice you have to make
  // rather than two things you can do.
  actMessage: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: Spacing.two,
  },
  actMessageText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  actChallenge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    backgroundColor: Colors.navEmber,
    borderRadius: 14,
    paddingVertical: Spacing.two,
  },
  actChallengeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#2A0F05',
  },
  // A row of its own under the actions rather than a fourth button squeezed into them: it's a
  // place you go (a whole comparison), not a one-tap action like the three above. Legend purple —
  // secondary, so it never competes with the ember Challenge beside it.
  actVersus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
    borderWidth: 1,
    borderColor: '#3A2D5A',
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderRadius: 14,
    paddingVertical: 10,
  },
  actVersusText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.legend,
  },
  actVersusSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    padding: 13,
    marginTop: 12,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.spaceDim,
  },
  markerRow: {
    marginTop: 14,
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
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
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
    borderRadius: 12,
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
    backgroundColor: Colors.spacePanel2,
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
