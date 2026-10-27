import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';

import { useAuraTier } from '@/components/economy/applied-art';
import { useFlareSurge } from '@/components/economy/flare-border';
import { HeroRankStrip, ProfileHero } from '@/components/economy/profile-hero';
import { ClaimHouseCard } from '@/components/house/claim-house-card';
import { heirTo } from '@/components/house/identity-line';
import { IdentityAbout, WorkingToward } from '@/components/identity/identity-card';
import { useProfileIdentity } from '@/components/identity/use-profile-identity';
import { ProfileStatsRow, TrophyHallLink } from '@/components/profile/profile-flex';
import { ShowcaseWall, useShowcaseData } from '@/components/profile/showcase-wall';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { useActiveSession } from '@/lib/active-session-context';
import { useLoadout } from '@/lib/economy/loadout';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyProgram } from '@/lib/api/house';
import { RankMuted } from '@/components/rank-muted';
import { fetchProfileById, fetchUserRank, type UserRank } from '@/lib/api/profile';
import type { MyRank, Profile } from '@/types/database';
import type { MyProgramRow } from '@/types/house';

// The avatar's own diameter — which is exactly what EquippedAvatarHalo's `size` means. It adds
// the ring's reach on top itself, so passing a padded box here makes the halo hug a phantom face
// and bleed past the identity block. 66 is mock 248's face disc inside its 92px halo.
const AVATAR_SIZE = 66;

// THE STREAMLINED PROFILE (mock 325, CODE_PROMPT_ui_streamline.md §E) — one scroll that shows the
// flex the moment it opens: identity card → Working toward → About → inline stats → Showcase →
// Trophy Hall. No About/Stats/Showcase tabs, and nothing that makes it a settings hub: grind-alikes
// live in the drawer and search, trackers in their own prompts, the loadout behind ✎ Edit.
//
// Doubles as the "Profile" tab (own profile, no params) and a pushed view of someone else's
// profile (?userId=...). friend-profile.tsx is the visitor screen everything else links to; it
// stacks the same blocks under its action row.
export default function ProfileScreen() {
  const router = useRouter();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const { profile: myProfile } = useAuth();
  const { ranks: myRanks } = useMyRanks();

  const isOwn = !userIdParam || userIdParam === myProfile?.id;
  const viewingUserId = isOwn ? myProfile?.id : userIdParam;

  // ONE resolver for both cases (§2) — get_public_loadouts (0065) gives a visitor exactly what that
  // person equipped instead of a stock card wearing nothing.
  const publicLoadouts = usePublicLoadouts([isOwn ? null : userIdParam]);
  const theirs = !isOwn && userIdParam ? publicLoadouts[userIdParam] : undefined;

  // The same resolved loadout for both branches, so this hero and friend-profile's cannot drift
  // (device smoke 2026-09-23: your own banner and flare once never reached your own profile).
  const mine = useLoadout();
  const heroLoadout = isOwn ? mine : (theirs ?? {});

  // The live 30/60/90 ramp and the flare's 15/30/60 surge (mock 252), only for your own card: there
  // is no live-session feed for anyone else, and inventing a tier for them would not be honest.
  const { session: activeSession } = useActiveSession();
  const auraTier = useAuraTier(isOwn ? activeSession : null);
  const flareSurge = useFlareSurge(isOwn ? activeSession : null);

  // One hall read serves the stats row, the Showcase's medals and relics, and the hall door.
  const hall = useTrophyHall(viewingUserId);
  // The identity layer (0272). Fails soft to nothing until it loads or when the dial keeps a
  // visitor out — every block that reads it then simply isn't drawn.
  const { identity } = useProfileIdentity(viewingUserId);
  const showcase = useShowcaseData(viewingUserId, isOwn);

  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherRank, setOtherRank] = useState<UserRank | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // Your own house (0257). `undefined` = not known — loading, or the read failed (0264 not live,
  // offline) — and renders nothing; only a SUCCESSFUL "no program" (null) offers the claim card, so
  // a failed read can never tell someone who has a house to go and claim one.
  const [myProgram, setMyProgram] = useState<MyProgramRow | null | undefined>(undefined);

  const profile = isOwn ? myProfile : otherProfile;
  const universalRank: MyRank | UserRank | undefined = isOwn ? myRanks.find((r) => r.scope === 'universal') : (otherRank ?? undefined);

  // On focus, not mount: the change-program screen is pushed over this tab, and coming back from it
  // has to show the new house without a pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (!isOwn) return;
      let live = true;
      fetchMyProgram()
        .then((p) => {
          if (live) setMyProgram(p);
        })
        .catch(() => {
          // Fails soft: no house row, no claim card — the profile reads as it did before 0257.
        });
      return () => {
        live = false;
      };
    }, [isOwn])
  );

  useEffect(() => {
    if (isOwn || !userIdParam) return;
    fetchProfileById(userIdParam)
      .then(setOtherProfile)
      .catch(() => {
        // A missing/unreadable profile just leaves the screen showing nothing below the header.
      });
    fetchUserRank(userIdParam).then(setOtherRank).catch(() => {});
  }, [isOwn, userIdParam]);

  useEffect(() => {
    if (isOwn && universalRank) track('rank_viewed', { tier: universalRank.tier, division: universalRank.division });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per mount when the rank first loads, not on every refetch
  }, [isOwn, Boolean(universalRank)]);

  if (!profile) return null;

  // The rank the strip draws, or null when there is none to draw (not loaded, or muted to you).
  const visibleRank =
    universalRank && !('muted' in universalRank && universalRank.muted) && universalRank.tier !== null
      ? {
          tier: universalRank.tier,
          division: universalRank.division ?? 0,
          xp_into_tier: universalRank.xp_into_tier ?? 0,
          xp_for_next_tier: universalRank.xp_for_next_tier ?? 0,
        }
      : null;

  return (
    // Profile is the one tab that never went through <Screen>, so it is wrapped for the deep-purple
    // radial (punchlist 16 §1) rather than converted — <Screen> would add a second SafeAreaView.
    <ScreenBackground>
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {isOwn ? (
        // The Profile tab root — the same global top bar as every tab (✈ · 🔔 · ☰). Settings lives
        // in the drawer behind ☰.
        <AppTopBar />
      ) : (
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
            <Ionicons name="chevron-down" size={20} color={Colors.muted} />
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.container}>
        {/* ① THE IDENTITY CARD (mocks 248 + 325) — flare border, banner mat, card, the person ringed
            by their halo, the name in its flame, @handle, "Heir to {Patron} · {Program}", campus,
            and the earned rank hex. No title on this line any more (§14): what someone bought is
            not what they want to be, so titles live in the Trophy Hall. */}
        <ProfileHero
          userId={viewingUserId}
          name={profile.display_name}
          handle={profile.handle}
          avatarUrl={profile.avatar_url}
          loadout={heroLoadout}
          avatarSize={AVATAR_SIZE}
          auraTier={auraTier}
          flareSurge={flareSurge}
          houseLine
          // 0170 · Private mode — a muted rank renders RankMuted under the card instead.
          footer={visibleRank ? <HeroRankStrip rank={visibleRank} /> : null}>
          {profile.university && (
            // Your school's board is the Leaderboard tab's My Uni scope (ui_pass2 §8).
            <Pressable onPress={() => router.push({ pathname: '/leaderboards', params: { scope: 'uni' } })}>
              <View style={styles.uniRow}>
                <Ionicons name="location" size={11} color={Colors.textTertiary} />
                <Text style={styles.uniText}>{profile.university}</Text>
              </View>
            </Pressable>
          )}
        </ProfileHero>

        {/* Own profile only: ONE way into every editor (identity, loadout, program). */}
        {isOwn ? (
          <View style={styles.editRow}>
            <Pressable style={styles.editBtn} onPress={() => setEditOpen(true)} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Ionicons name="create-outline" size={13} color={Colors.achieverText} />
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </View>
        ) : null}
        {universalRank && 'muted' in universalRank && universalRank.muted && <RankMuted />}

        {/* No program yet → the claim card, since the house names the identity line. */}
        {isOwn && myProgram === null ? <ClaimHouseCard /> : null}

        {/* ② the aspiration · ③ About · ④ stats inline · ⑤ the Showcase wall · the hall door. */}
        <WorkingToward identity={identity} />
        <IdentityAbout identity={identity} />
        <ProfileStatsRow hall={hall} prCount={showcase.prCount} />
        {viewingUserId ? (
          <ShowcaseWall
            userId={viewingUserId}
            isOwn={isOwn}
            hall={hall}
            identity={identity}
            prs={showcase.prs}
            longest={showcase.longest}
          />
        ) : null}
        {viewingUserId ? <TrophyHallLink userId={viewingUserId} /> : null}
      </ScrollView>

      <EditSheet visible={editOpen} title="Edit profile" onClose={() => setEditOpen(false)}>
        <EditRow
          icon="person-circle-outline"
          label="Edit identity"
          sub="What you're working toward, anthem, interests"
          onPress={() => {
            setEditOpen(false);
            // Route typings are generated by Metro, so a new screen isn't in them until the next start.
            router.push('/edit-identity' as never);
          }}
        />
        <EditRow
          icon="color-wand-outline"
          label="Edit loadout"
          sub="Card, flare, halo, banner, title"
          onPress={() => {
            setEditOpen(false);
            router.push('/loadout');
          }}
        />
        {myProgram ? (
          <EditRow
            icon="school-outline"
            label="Change program"
            sub={`${heirTo(myProgram.patron_name)} · ${myProgram.program_abbrev || myProgram.name}`}
            onPress={() => {
              setEditOpen(false);
              router.push('/house/change-program');
            }}
          />
        ) : null}
      </EditSheet>
    </SafeAreaView>
    </ScreenBackground>
  );
}

/** One door in the ✎ Edit sheet. */
function EditRow({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.editSheetRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={Colors.achieverText} />
      <View style={styles.editSheetText}>
        <Text style={styles.editSheetLabel}>{label}</Text>
        <Text style={styles.editSheetSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <UiGlyph name="forward" size={12} color={Colors.spaceFaint} />
    </Pressable>
  );
}

/** The ✎ Edit bottom sheet. */
function EditSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <UiGlyph name="close" size={18} color={Colors.spaceDim} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,14,0.6)',
  },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  sheetBody: {
    paddingBottom: Spacing.three,
    gap: Spacing.twelve,
  },
  // ✎ Edit — one quiet chip, right-aligned under the card it edits.
  editRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: Spacing.two,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  editBtnText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  editSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  editSheetText: {
    flex: 1,
    minWidth: 0,
  },
  editSheetLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  editSheetSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: 1,
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
  // Only the pushed "someone else's profile" view — the tab root uses AppTopBar outside the
  // padded ScrollView, so this needs its own padding.
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
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
});
