import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { HeroRankStrip, ProfileHero } from '@/components/economy/profile-hero';
import { IdentityAbout, WorkingToward } from '@/components/identity/identity-card';
import { useProfileIdentity } from '@/components/identity/use-profile-identity';
import { LiveStatusBadge } from '@/components/live-status-badge';
import { ProfileStatsRow, TrophyHallLink } from '@/components/profile/profile-flex';
import { ShowcaseWall, useShowcaseData } from '@/components/profile/showcase-wall';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { ReportBlockSheet } from '@/components/report-block-sheet';
import { SocialGlyph } from '@/components/ui/glyphs-social';
import { SpaceHeader, SpaceIconButton } from '@/components/ui/space-kit';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { usePresenceOf } from '@/hooks/use-presence';
import { usePublicLoadout } from '@/hooks/use-public-loadouts';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { respondFriendRequest, sendFriendRequest } from '@/lib/api/friend-requests';
import { fetchActiveChallengeMarker, fetchRelationshipWith, fetchUserBoardPosition } from '@/lib/api/leaderboard-social';
import { RankMuted } from '@/components/rank-muted';
import { fetchProfileById, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { blockUser } from '@/lib/api/agora';
import { getErrorMessage } from '@/lib/errors';
import type { ActiveChallengeMarker, Profile, ProfileRelationship } from '@/types/database';

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

  // §4 — their hall feeds the stats row, the Showcase's medals and relics, and the hall door.
  const theirHall = useTrophyHall(userId);
  // THEIR loadout, not yours — every cosmetic on this screen is driven by this one read.
  const loadout = usePublicLoadout(userId);
  // Live status (0245). Last-active is friends-only and the server already nulls it for anyone
  // else, so the header can always ask for it.
  const presence = usePresenceOf(userId === myProfile?.id ? null : userId);
  // Their identity layer (0272). The server has already applied their visibility dial — fields this
  // viewer may not see simply aren't in the row — so this screen renders whatever comes back, and
  // a failed read renders nothing.
  const { identity } = useProfileIdentity(userId === myProfile?.id ? null : userId);
  // Their longest session, under their own photo_visibility. Their PRs are owner-only rows, so the
  // wall's lift tile comes off identity's recent win instead.
  const showcase = useShowcaseData(userId === myProfile?.id ? null : userId, false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [rank, setRank] = useState<UserRank | null>(null);
  const [relationship, setRelationship] = useState<ProfileRelationship>('none');
  const [marker, setMarker] = useState<ActiveChallengeMarker | null>(null);
  const [boardPosition, setBoardPosition] = useState<{ board: 'My uni' | 'Global'; rank: number } | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!userId || userId === myProfile?.id) return;
    fetchProfileById(userId).then(setProfile).catch(() => {});
    fetchUserRank(userId).then(setRank).catch(() => {});
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
          footer={
            rank && !rank.muted ? (
              <HeroRankStrip
                rank={rank}
                sub={boardPosition ? `#${boardPosition.rank.toLocaleString()} on ${boardPosition.board}` : null}
              />
            ) : null
          }>
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

        {/* 0170 · Private mode. A non-friend sees "Rank muted" where the hexagon, the XP bar and
            the board position would be. The name, handle and avatar above are untouched. */}
        {rank?.muted && <RankMuted />}

        {marker && (
          <View style={styles.markerRow}>
            <ActiveChallengeMarkerChip marker={marker} onWatch={marker.can_watch ? handleWatch : undefined} />
          </View>
        )}

        {/* Mock 325's one scroll, the same blocks as your own profile: the aspiration, About,
            stats inline, then the Showcase wall — the read that says "this person is serious" —
            and the door to their full hall, where their titles live now. */}
        <WorkingToward identity={identity} />
        <IdentityAbout identity={identity} />
        <ProfileStatsRow hall={theirHall} prCount={null} />
        <ShowcaseWall userId={userId} isOwn={false} hall={theirHall} identity={identity} prs={[]} longest={showcase.longest} />
        <TrophyHallLink userId={userId} />
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
  markerRow: {
    marginTop: 14,
  },
});
