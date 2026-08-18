import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';

import { EquippedHalo, EquippedTitle, useEquippedCardStyle } from '@/components/economy/loadout-bits';
import { HexagonBadge } from '@/components/hexagon-badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { TabHeader } from '@/components/ui/tab-header';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyRecentLockIns, fetchUserLockInPhotos, type MyRecentLockIn } from '@/lib/api/check-ins';
import { fetchUniversityMemberCount } from '@/lib/api/groups';
import { fetchMyLockInStats, fetchProfileById, fetchUserLockInStats, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { formatSessionDuration, pluralize } from '@/lib/format';
import { GOAL_TYPE_ICON, GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, formatXpProgress, xpProgressRatio } from '@/lib/rank-tiers';
import type { MyRank, Profile } from '@/types/database';

// The halo ring sits OUTSIDE the 60px avatar, so its box is the avatar plus room for the ring.
// Kept next to the avatar style it has to agree with.
const AVATAR_HALO_SIZE = 72;

function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours < 1) return `${Math.round(totalSeconds / 60)}m`;
  return `${Math.round(hours)}h`;
}

// design-mocks/15 (PHILOI_UI_SPEC.md §18). Doubles as the "Profile" tab (own profile, no
// params) and a pushed view of someone else's profile (?userId=...) — no other screen
// currently links to the latter, but the privacy-aware data fetches below are correct
// either way per the spec's explicit "someone else's profile" requirement.
export default function ProfileScreen() {
  const router = useRouter();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();
  const { ranks: myRanks } = useMyRanks();

  const isOwn = !userIdParam || userIdParam === myProfile?.id;
  const viewingUserId = isOwn ? myProfile?.id : userIdParam;

  // Only ever decorate YOUR OWN card with YOUR loadout — the store holds one user's equipped set.
  // Someone else's cosmetics need a public read that doesn't exist yet (get_inventory is
  // own-rows-only by design), so their card stays stock rather than borrowing yours.
  const cardStyle = useEquippedCardStyle(isOwn);

  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherRank, setOtherRank] = useState<UserRank | null>(null);
  const [universityCount, setUniversityCount] = useState<number | null>(null);
  const [stats, setStats] = useState({ lockin_count: 0, total_seconds: 0 });
  const [recentLockIns, setRecentLockIns] = useState<MyRecentLockIn[]>([]);

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
    if (profile?.university) {
      fetchUniversityMemberCount(profile.university).then(setUniversityCount);
    }
  }, [profile?.university]);

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
        {/* The identity block is where the equipped loadout shows up — card texture behind it,
            halo around the avatar, title under the handle (mock 64). All three no-op to the stock
            look when their slot is empty, so this reads identically for someone who's never
            opened the shop. */}
        <View style={[styles.id, cardStyle]}>
          <EquippedHalo size={AVATAR_HALO_SIZE} enabled={isOwn}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{profile.display_name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </EquippedHalo>
          <View style={styles.idInfo}>
            <Text style={styles.name}>{profile.display_name}</Text>
            <Text style={styles.handle}>@{profile.handle}</Text>
            <EquippedTitle enabled={isOwn} />
            {profile.university && (
              <Pressable onPress={() => router.push('/university-leaderboard')}>
                <View style={styles.uniRow}>
                  <Ionicons name="location" size={11} color={Colors.textTertiary} />
                  <Text style={styles.uniText}>
                    {profile.university}
                    {universityCount !== null && universityCount > 1 ? ` — ${universityCount} here` : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          </View>
        </View>

        {universalRank && (
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

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{profile.current_streak}</Text>
            <Text style={styles.statLabel}>day streak</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{stats.lockin_count}</Text>
            <Text style={styles.statLabel}>{pluralize(stats.lockin_count, 'lock-in')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatHours(stats.total_seconds)}</Text>
            <Text style={styles.statLabel}>locked in</Text>
          </View>
        </View>

        {/* The identity block above is BUILT from the loadout, so this is where it belongs: the
            equipped card, halo and title are on screen and the way to change them should be too.
            The only other route in was "Collect all → Inventory" after opening a box (punchlist
            8 §3), which left everything bought in the shop effectively unreachable. */}
        {isOwn && (
          <Pressable
            style={styles.inventoryRow}
            onPress={() => router.push('/inventory')}
            accessibilityRole="button"
            accessibilityLabel="Inventory and loadout">
            <Ionicons name="cube-outline" size={16} color={Colors.ember} />
            <Text style={styles.inventoryText}>Inventory &amp; loadout</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
          </Pressable>
        )}

        {recentGoalTypes.length > 0 && (
          <View style={styles.goals}>
            {recentGoalTypes.map((type) => (
              <View key={type} style={styles.gchip}>
                <Ionicons name={GOAL_TYPE_ICON[type]} size={12} color={Colors.ember} />
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
                        <Ionicons name={GOAL_TYPE_ICON[r.goal_type]} size={16} color={isSynced ? '#FC4C02' : Colors.amber} />
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
                        <Ionicons name={GOAL_TYPE_ICON[r.goal_type]} size={26} color={Colors.textTertiary} />
                      </View>
                    )}
                    <View style={styles.ov}>
                      <Ionicons name={GOAL_TYPE_ICON[r.goal_type]} size={11} color="#FFFFFF" />
                      <Text style={styles.ovDuration}>{formatSessionDuration(r.duration_seconds ?? 0)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
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
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 11,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 9,
  },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  inventoryText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  statValue: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
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
