import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';

import { EquippedAvatarHalo, EquippedCardBackdrop, useAuraTier } from '@/components/economy/applied-art';
import { EquippedTitle } from '@/components/economy/loadout-bits';
import { BioEditor } from '@/components/profile/bio-editor';
import { CollectionEntry } from '@/components/profile/collection-entry';
import { JournalSection } from '@/components/profile/journal-section';
import { TrophyHallSection } from '@/components/profile/trophy-hall-section';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { useActiveSession } from '@/lib/active-session-context';
import { useEquipped } from '@/lib/economy/loadout';
import { HexagonBadge } from '@/components/hexagon-badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { TabHeader } from '@/components/ui/tab-header';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyRecentLockIns, fetchUserLockInPhotos, type MyRecentLockIn } from '@/lib/api/check-ins';
import { RankMuted } from '@/components/rank-muted';
import { fetchMyLockInStats, fetchProfileById, fetchUserLockInStats, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { formatSessionDuration, pluralize } from '@/lib/format';
import { GOAL_TYPE_GLYPH, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, formatXpProgress, xpProgressRatio } from '@/lib/rank-tiers';
import type { MyRank, Profile } from '@/types/database';

// The halo ring sits OUTSIDE the 60px avatar, so its box is the avatar plus room for the ring.
// Kept next to the avatar style it has to agree with.
const AVATAR_HALO_SIZE = 72;

// design-mocks/15 (PHILOI_UI_SPEC.md §18). Doubles as the "Profile" tab (own profile, no
// params) and a pushed view of someone else's profile (?userId=...) — no other screen
// currently links to the latter, but the privacy-aware data fetches below are correct
// either way per the spec's explicit "someone else's profile" requirement.
export default function ProfileScreen() {
  const router = useRouter();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile, refreshProfile } = useAuth();
  const { ranks: myRanks } = useMyRanks();

  const isOwn = !userIdParam || userIdParam === myProfile?.id;
  const viewingUserId = isOwn ? myProfile?.id : userIdParam;

  // ONE resolver for both cases (§2). The comment that used to sit here said someone else's
  // cosmetics "need a public read that doesn't exist yet" — get_public_loadouts (migration 0065)
  // has existed since, so a visitor now sees exactly what that person equipped instead of a stock
  // card wearing nothing.
  const myCard = useEquipped('card');
  const myHalo = useEquipped('halo');
  const publicLoadouts = usePublicLoadouts([isOwn ? null : userIdParam]);
  const theirs = !isOwn && userIdParam ? publicLoadouts[userIdParam] : undefined;
  const cardId = isOwn ? myCard?.id : theirs?.card?.id;
  const haloId = isOwn ? myHalo?.id : theirs?.halo?.id;

  // The live 30/60/90 ramp, and only for your own card: the aura reports the session you are in
  // right now, and there is no live-session feed for anyone else. A visitor seeing someone's
  // cosmetic at rest is honest; inventing a tier for them would not be.
  const { session: activeSession } = useActiveSession();
  const auraTier = useAuraTier(isOwn ? activeSession?.startedAt : null);

  // §4 + §7. One read serves both: the hall's own contents AND the item count the Collection entry
  // advertises, so opening this tab costs one request rather than two.
  const hall = useTrophyHall(viewingUserId);
  const collectionCount = hall?.collection_count ?? null;

  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherRank, setOtherRank] = useState<UserRank | null>(null);
  const [stats, setStats] = useState({ lockin_count: 0, total_seconds: 0 });
  const [recentLockIns, setRecentLockIns] = useState<MyRecentLockIn[]>([]);
  // null = closed. A string (even empty) means the editor is open with that draft.
  const [bioDraft, setBioDraft] = useState<string | null>(null);

  const profile = isOwn ? myProfile : otherProfile;
  const universalRank: MyRank | UserRank | undefined = isOwn ? myRanks.find((r) => r.scope === 'universal') : (otherRank ?? undefined);

  useEffect(() => {
    if (isOwn || !userIdParam) return;
    fetchProfileById(userIdParam)
      .then(setOtherProfile)
      .catch(() => {
        // A missing/unreadable profile just leaves the screen showing nothing below the header.
      });
  }, [isOwn, userIdParam]);

  useEffect(() => {
    if (isOwn && universalRank) track('rank_viewed', { tier: universalRank.tier, division: universalRank.division });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per mount when the rank first loads, not on every refetch
  }, [isOwn, Boolean(universalRank)]);

  useEffect(() => {
    if (!isOwn && userIdParam) {
      fetchUserRank(userIdParam).then(setOtherRank).catch(() => {});
    }
  }, [isOwn, userIdParam]);

  useEffect(() => {
    if (!viewingUserId) return;
    if (isOwn) {
      fetchMyLockInStats().then(setStats).catch(() => {});
      fetchMyRecentLockIns(viewingUserId).then(setRecentLockIns).catch(() => {});
    } else {
      fetchUserLockInStats(viewingUserId).then(setStats).catch(() => {});
      fetchUserLockInPhotos(viewingUserId).then(setRecentLockIns).catch(() => {});
    }
  }, [isOwn, viewingUserId]);

  if (!profile) return null;

  // Recently-used goal types, most recent first, deduped — "recent goal types used" is real
  // and derivable from lock-in history now that goals aren't a persisted per-user list. For
  // someone else's restricted profile, recentLockIns comes back empty, so this — and the
  // grid below — naturally disappears too, rather than needing a second privacy check.
  const recentGoalTypes = [...new Set(recentLockIns.map((r) => r.goal_type))].slice(0, 4);

  return (
    // Profile is the one tab that never went through <Screen>, so it never picked up the
    // deep-purple radial and read as flat dark (punchlist 16 §1). Wrapped rather than converted
    // to <Screen>: this screen manages its own scroll + header layout, and <Screen> would add a
    // second SafeAreaView around it.
    <ScreenBackground>
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {isOwn ? (
        // The Profile tab root — standardized title (same as the other three tabs). Settings is
        // the ONE right-side action here (PHILOI_UI_SPEC.md §4b) — Friends moved to Home, so
        // every header carries at most one action pointing to a different destination.
        <TabHeader
          title="Profile"
          right={
            <Pressable onPress={() => router.push('/settings')} hitSlop={8} accessibilityLabel="Settings">
              <Ionicons name="settings-outline" size={20} color={Colors.muted} />
            </Pressable>
          }
        />
      ) : (
        // A pushed detail view of someone else's profile, not the tab root — back navigation,
        // not a standardized tab title.
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-down" size={20} color={Colors.muted} />
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.container}>
        {/* The identity block wearing the equipped loadout — the card's real TEXTURE behind it and
            the halo's real ring around the avatar, not the flat colours these used to be (§2).
            Both fall back to the starter items every account is seeded with at signup, so this is
            never a bare surface even for someone who has never opened the shop. */}
        <EquippedCardBackdrop cardId={cardId} auraTier={auraTier}>
        <View style={styles.id}>
          <EquippedAvatarHalo haloId={haloId} size={AVATAR_HALO_SIZE} auraTier={auraTier}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{profile.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </EquippedAvatarHalo>
          <View style={styles.idInfo}>
            <Text style={styles.name}>{profile.display_name}</Text>
            <Text style={styles.handle}>@{profile.handle}</Text>
            <EquippedTitle enabled={isOwn} />
            {profile.university && (
              <Pressable onPress={() => router.push('/university-leaderboard')}>
                <View style={styles.uniRow}>
                  <Ionicons name="location" size={11} color={Colors.textTertiary} />
                  {/* "— N here" retired (§1): a dead photo-era metric. The count answered "how
                      many classmates are on Philoi", which mattered when the campus feed was the
                      product and means nothing beside a rank strip. */}
                  <Text style={styles.uniText}>{profile.university}</Text>
                </View>
              </Pressable>
            )}
            {/* §3 — the bio. Editable in place on your own profile; on someone else's it renders
                only when they wrote one, so an empty bio is absent rather than an empty slot. */}
            {isOwn ? (
              <Pressable onPress={() => setBioDraft(profile.bio ?? '')} hitSlop={6}>
                <Text style={[styles.bio, !profile.bio && styles.bioEmpty]} numberOfLines={2}>
                  {profile.bio || '＋ add a bio'}
                </Text>
              </Pressable>
            ) : profile.bio ? (
              <Text style={styles.bio} numberOfLines={2}>
                {profile.bio}
              </Text>
            ) : null}
          </View>
        </View>
        </EquippedCardBackdrop>

        {/* 0170 · Private mode. Only reachable on SOMEONE ELSE's profile — `universalRank` is a
            MyRank from useMyRanks when this is your own, and your own rank is never muted to you
            (can_see_rank returns true for self before it looks at anything else). */}
        {universalRank && 'muted' in universalRank && universalRank.muted && <RankMuted />}

        {universalRank && !('muted' in universalRank && universalRank.muted) && (
          <View style={styles.rank}>
            <HexagonBadge tier={universalRank.tier} division={universalRank.division} size={40} />
            <View style={styles.rk}>
              <View style={styles.rkTop}>
                <Text style={styles.rkTier}>{formatRankTier(universalRank.tier, universalRank.division)}</Text>
                <Text style={styles.rkXp}>{formatXpProgress(universalRank.xp_into_tier, universalRank.xp_for_next_tier)}</Text>
              </View>
              <ProgressBar ratio={xpProgressRatio(universalRank.xp_into_tier, universalRank.xp_for_next_tier)} />
            </View>
          </View>
        )}

        {/* §1: the streak / lock-ins / hours strip is GONE. All three already lead Home — the
            flame, the streak line and the XP bar — so repeating them here made the profile a
            second dashboard instead of an identity. What survives is the identity banner and the
            rank strip; everything below is now the Journal, then the Trophy Hall.

            The "Inventory & loadout" row is gone too: the ⚙ menu owns editing, and §7's
            "Loadout & Collection" entry is the read-only browse that replaces it. */}

        {/* §7: the read-only closet. Sits here rather than at the bottom because it is the one
            thing on this screen that answers "what have I actually collected" — and on someone
            else's profile, the thing a visitor most wants to open. */}
        {viewingUserId ? (
          <CollectionEntry userId={viewingUserId} isOwn={isOwn} name={profile.display_name} count={collectionCount} />
        ) : null}

        {/* §5: the Journal leads, directly under the rank strip. Deliberately above the trophies —
            a viewer should see WHY someone grinds before they see how much. */}
        {viewingUserId ? (
          <JournalSection
            userId={viewingUserId}
            isOwn={isOwn}
            onAddMilestone={() => router.push('/milestone/new')}
          />
        ) : null}

        {/* §4: earned proof of status. Below the Journal on purpose — the human layer leads. */}
        {hall && viewingUserId ? <TrophyHallSection hall={hall} userId={viewingUserId} isOwn={isOwn} /> : null}

        {recentGoalTypes.length > 0 && (
          <View style={styles.goals}>
            {recentGoalTypes.map((type) => (
              <View key={type} style={styles.gchip}>
                <DisciplineIcon name={GOAL_TYPE_GLYPH[type]} size={12} color={Colors.ember} />
                <Text style={styles.gchipText}>{GOAL_TYPE_META[type]?.label ?? type}</Text>
              </View>
            ))}
          </View>
        )}

        {recentLockIns.length > 0 && (
          <>
            <View style={styles.gl}>
              <Text style={styles.glTitle}>Lock-ins</Text>
              {/* Own profile only: this list is capped at the most recent handful, and Profile is
                  the single home for lock-in data now that Home's journal is gone (punchlist 4B/4C)
                  — so there has to be a way through to the rest. Someone else's profile keeps the
                  photo gallery and its own visibility rules, with no full-history route. */}
              {isOwn ? (
                <Pressable
                  onPress={() => router.push('/lock-in-history')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="See all lock-ins"
                  style={styles.seeAll}>
                  <Text style={styles.seeAllText}>See all</Text>
                  <Ionicons name="chevron-forward" size={13} color={Colors.achieverText} />
                </Pressable>
              ) : (
                <Text style={styles.glSub}>
                  {stats.lockin_count} {pluralize(stats.lockin_count, 'session')}
                </Text>
              )}
            </View>
            {isOwn ? (
              // Own profile: the clean compact list, matching Home's "Your recent lock-ins"
              // (punchlist: the photo grid ate a huge chunk of screen with mostly-empty tiles).
              <View style={styles.list}>
                {recentLockIns.map((r) => {
                  const isSynced = Boolean(r.source && r.source !== 'manual');
                  const isStrava = r.source === 'strava';
                  return (
                    <Pressable
                      key={r.id}
                      style={styles.row}
                      onPress={() =>
                        isStrava
                          ? router.push({ pathname: '/activity/[checkInId]', params: { checkInId: r.id } })
                          : router.push({ pathname: '/lock-in/[checkInId]', params: { checkInId: r.id } })
                      }>
                      <View style={[styles.rowIcon, isSynced && styles.rowIconSynced]}>
                        <DisciplineIcon name={GOAL_TYPE_GLYPH[r.goal_type]} size={16} color={isSynced ? '#FC4C02' : Colors.amber} />
                      </View>
                      <Text style={styles.rowText} numberOfLines={1}>
                        {isStrava && r.goal_detail ? r.goal_detail : GOAL_TYPE_META[r.goal_type].label}
                        {!isStrava && r.goal_detail ? <Text style={styles.rowDetail}> · {r.goal_detail}</Text> : null}
                      </Text>
                      <Text style={styles.rowDur}>{formatSessionDuration(r.duration_seconds ?? 0)}</Text>
                      <Ionicons name="chevron-forward" size={13} color={isStrava ? '#FC4C02' : Colors.textTertiary} />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              // Someone else's profile keeps the photo gallery.
              <View style={styles.grid}>
                {recentLockIns.map((r) => (
                  <View key={r.id} style={styles.ph}>
                    {r.signedPhotoUrl ? (
                      <Image source={{ uri: r.signedPhotoUrl }} style={styles.phImage} />
                    ) : (
                      <View style={[styles.phImage, styles.phFallback]}>
                        <DisciplineIcon name={GOAL_TYPE_GLYPH[r.goal_type]} size={26} color={Colors.textTertiary} />
                      </View>
                    )}
                    <View style={styles.ov}>
                      <DisciplineIcon name={GOAL_TYPE_GLYPH[r.goal_type]} size={11} color="#FFFFFF" />
                      <Text style={styles.ovDuration}>{formatSessionDuration(r.duration_seconds ?? 0)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* §3 — opened by tapping the bio line. refreshProfile() pulls the saved value back through
          auth context so the identity block re-renders from the server, not from local state. */}
      {bioDraft !== null ? (
        <BioEditor
          initial={bioDraft}
          onClose={() => setBioDraft(null)}
          onSaved={() => {
            void refreshProfile();
          }}
        />
      ) : null}
    </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  bio: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: Colors.warmSubtext,
    marginTop: 4,
  },
  // The prompt on your own empty bio — quieter than a written one, so it reads as an affordance
  // rather than as text you forgot you wrote.
  bioEmpty: {
    color: Colors.textTertiary,
    fontStyle: "italic",
  },
  safeArea: {
    flex: 1,
    // Transparent — the radial behind it is the background now.
    backgroundColor: 'transparent',
  },
  container: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  // Only used for the pushed "someone else's profile" view now (isOwn uses TabHeader instead,
  // rendered outside the padded ScrollView) — needs its own horizontal/top padding since it's
  // no longer nested inside container's.
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  id: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: 6,
  },
  idInfo: {
    flex: 1,
    gap: 1,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  avatarFallback: {
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ember,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 18,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  uniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  uniText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
  editProfileLink: {
    fontFamily: Fonts.bodyBold,
    color: Colors.coral,
    fontSize: 14,
    marginTop: Spacing.two,
  },
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
  },
  rk: {
    flex: 1,
  },
  rkTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rkTier: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  rkXp: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  goals: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 11,
    flexWrap: 'wrap',
  },
  gchip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  gchipText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ember,
  },
  gl: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 14,
    marginBottom: 8,
  },
  glTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  glSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  // Compact list (own profile), mirrors Home's recent-lock-ins rows.
  list: {
    gap: 7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconSynced: {
    backgroundColor: 'rgba(252,76,2,0.14)',
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowDetail: {
    fontFamily: Fonts.body,
    color: Colors.muted,
  },
  rowDur: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
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
