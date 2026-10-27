import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';

import { useAuraTier } from '@/components/economy/applied-art';
import { useFlareSurge } from '@/components/economy/flare-border';
import { EquippedTitle, PublicTitle } from '@/components/economy/loadout-bits';
import { HeroRankStrip, ProfileHero } from '@/components/economy/profile-hero';
import { ClaimHouseCard } from '@/components/house/claim-house-card';
import { heirTo } from '@/components/house/identity-line';
import { DisciplineMixBar } from '@/components/identity/discipline-mix-bar';
import { IdentityCard } from '@/components/identity/identity-card';
import { IdentityHeadline } from '@/components/identity/identity-headline';
import { MomentumStrip } from '@/components/identity/momentum-strip';
import { useProfileIdentity } from '@/components/identity/use-profile-identity';
import { CollectionEntry } from '@/components/profile/collection-entry';
import { DisciplineRelicTracker } from '@/components/profile/discipline-relic-tracker';
import { ProfileShowcase } from '@/components/profile/profile-showcase';
import { JournalSection } from '@/components/profile/journal-section';
import { useTrophyHall } from '@/hooks/use-trophy-hall';
import { usePublicLoadouts } from '@/hooks/use-public-loadouts';
import { useActiveSession } from '@/lib/active-session-context';
import { useLoadout } from '@/lib/economy/loadout';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyRanks } from '@/hooks/use-my-ranks';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyRecentLockIns, fetchUserLockInPhotos, type MyRecentLockIn } from '@/lib/api/check-ins';
import { fetchMyProgram } from '@/lib/api/house';
import { RankMuted } from '@/components/rank-muted';
import { fetchMyLockInStats, fetchProfileById, fetchUserLockInStats, fetchUserRank, type UserRank } from '@/lib/api/profile';
import { DISCIPLINE_LABELS } from '@/lib/api/identity';
import { TRACKERS_ROUTE } from '@/components/fitness/tracker-prompts';
import { useFitnessTracking } from '@/hooks/use-fitness-tracking';
import { formatSessionDuration, pluralize } from '@/lib/format';
import { GOAL_TYPE_GLYPH } from '@/lib/goal-types';
import type { MyRank, Profile } from '@/types/database';
import type { MyProgramRow } from '@/types/house';

// The avatar's own diameter — which is exactly what EquippedAvatarHalo's `size` means. It adds
// the ring's reach on top itself, so passing a padded box here makes the halo hug a phantom face
// and bleed past the identity block. 66 is mock 248's face disc inside its 92px halo.
const AVATAR_SIZE = 66;

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

  // ONE resolver for both cases (§2). The comment that used to sit here said someone else's
  // cosmetics "need a public read that doesn't exist yet" — get_public_loadouts (migration 0065)
  // has existed since, so a visitor now sees exactly what that person equipped instead of a stock
  // card wearing nothing.
  const publicLoadouts = usePublicLoadouts([isOwn ? null : userIdParam]);
  const theirs = !isOwn && userIdParam ? publicLoadouts[userIdParam] : undefined;

  // 🐛 TWO EQUIPPED SLOTS NEVER REACHED THIS HERO (device smoke 2026-09-23 — "background cosmetic
  // didn't land, avatar rings didn't land"). The card and the halo were wired; the BANNER and the
  // FLARE were not, on either branch. friend-profile.tsx has drawn both since it shipped — so
  // the one screen that never showed you your own banner or your own flare was your own profile,
  // while every visitor to it saw them. Same resolved loadout for both branches, so the two screens
  // cannot drift apart again.
  const mine = useLoadout();
  const heroLoadout = isOwn ? mine : (theirs ?? {});

  // The live 30/60/90 ramp, and only for your own card: the aura reports the session you are in
  // right now, and there is no live-session feed for anyone else. A visitor seeing someone's
  // cosmetic at rest is honest; inventing a tier for them would not be.
  const { session: activeSession } = useActiveSession();
  const auraTier = useAuraTier(isOwn ? activeSession : null);
  // Same rule for the flare border (mock 252): ambient at rest, surging with the session's 15/30/60
  // tier while YOU are locked in. Null for a visitor — there is no live feed for anyone else.
  const flareSurge = useFlareSurge(isOwn ? activeSession : null);

  // §4 + §7. One read serves both: the hall's own contents AND the item count the Collection entry
  // advertises, so opening this tab costs one request rather than two.
  const hall = useTrophyHall(viewingUserId);
  const collectionCount = hall?.collection_count ?? null;

  // The identity layer (0272, mock 283) — headline, momentum strip, identity card, discipline mix.
  // Fails soft to nothing: until 0272 is live (or when the dial keeps a visitor out) the profile
  // reads exactly as it did before.
  const { identity, mix } = useProfileIdentity(viewingUserId);

  const [otherProfile, setOtherProfile] = useState<Profile | null>(null);
  const [otherRank, setOtherRank] = useState<UserRank | null>(null);
  const [stats, setStats] = useState({ lockin_count: 0, total_seconds: 0 });
  const [recentLockIns, setRecentLockIns] = useState<MyRecentLockIn[]>([]);
  // Which detail sheet is open (ui_pass2 §5) — a stat box's, or the ✎ Edit menu; null = none.
  const [sheet, setSheet] = useState<'time' | 'mix' | 'journal' | 'sessions' | 'edit' | null>(null);
  // THE CONDENSED PROFILE: the card and the momentum strip, then everything else behind three tabs.
  // Your own profile opens on About; someone else's on Stats, since their About can be empty.
  const [tab, setTab] = useState<ProfileTab>(isOwn ? 'about' : 'stats');
  // null = closed. A string (even empty) means the editor is open with that draft.
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

  // The boxes' headlines. Trophies = everything the hall would show: relics on a rung (or off
  // ladder), badges, season placements — a visitor's hidden items are already filtered server-side.
  const topMix = [...mix].sort((a, b) => b.pct - a.pct)[0] ?? null;
  const trophyCount = hall
    ? hall.relics.filter((r) => r.tier === null || r.tier > 0).length + hall.badges.length + hall.seasons.length
    : 0;

  return (
    // Profile is the one tab that never went through <Screen>, so it never picked up the
    // deep-purple radial and read as flat dark (punchlist 16 §1). Wrapped rather than converted
    // to <Screen>: this screen manages its own scroll + header layout, and <Screen> would add a
    // second SafeAreaView around it.
    <ScreenBackground>
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {isOwn ? (
        // The Profile tab root — the same global top bar as every tab (✈ · 🔔 · ☰). No settings
        // gear: Settings lives in the drawer behind ☰.
        <AppTopBar />
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
        {/* THE PROFILE COMPOSITE (mock 248) — flare border, banner mat, card, the PERSON ringed by
            their halo, burning name, title, and the rank strip with the season chip, all inside one
            card. ProfileHero is the same component the loadout preview and the inventory header
            draw, so an equip there lands here identically: both read the one loadout store.
            Everything falls back to the starter items every account is seeded with at signup, so
            this is never a bare surface even for someone who has never opened the shop. */}
        <ProfileHero
          userId={viewingUserId}
          name={profile.display_name}
          handle={profile.handle}
          avatarUrl={profile.avatar_url}
          loadout={heroLoadout}
          avatarSize={AVATAR_SIZE}
          auraTier={auraTier}
          flareSurge={flareSurge}
          // "Heir to · Program" sits in the card for everyone; changing it is in the ✎ Edit sheet.
          houseLine
          // `EquippedTitle` reads the signed-in user's store, so on someone else's profile it would
          // structurally render blank — their title comes off the public loadout fetched above.
          title={isOwn ? <EquippedTitle /> : <PublicTitle loadout={theirs ?? {}} />}
          // 0170 · Private mode. `universalRank` is a MyRank from useMyRanks on your own profile and
          // your own rank is never muted to you; a muted one renders RankMuted under the card.
          footer={visibleRank ? <HeroRankStrip rank={visibleRank} /> : null}>
          {/* "What you wanna be" — the headline under the name (mock 283's `.pf-head`). */}
          <IdentityHeadline identity={identity} />
          {profile.university && (
            // Your school's board is the Leaderboard tab's My Uni scope now (the old university
            // board screen is gone, ui_pass2 §8).
            <Pressable onPress={() => router.push({ pathname: '/leaderboards', params: { scope: 'uni' } })}>
              <View style={styles.uniRow}>
                <Ionicons name="location" size={11} color={Colors.textTertiary} />
                <Text style={styles.uniText}>{profile.university}</Text>
              </View>
            </Pressable>
          )}
          {/* No bio (pre-submission F13): title, house, crests, rank and loadout already say who
              someone is. profiles.bio stays in the schema, unread and unwritten. */}
        </ProfileHero>

        {/* Own profile only: ONE way into every editor (identity, loadout, program) — the sheet below. */}
        {isOwn ? (
          <View style={styles.editRow}>
            <Pressable style={styles.editBtn} onPress={() => setSheet('edit')} accessibilityRole="button" accessibilityLabel="Edit profile">
              <Ionicons name="create-outline" size={13} color={Colors.achieverText} />
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Momentum leads: streak, rank, the latest win — above the tabs, so it's always in view. */}
        <MomentumStrip identity={identity} onRankPress={isOwn ? () => router.push('/leaderboards') : undefined} />
        {universalRank && 'muted' in universalRank && universalRank.muted && <RankMuted />}

        <View style={styles.tabs} accessibilityRole="tablist">
          {PROFILE_TABS.map((t) => {
            const on = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tabBtn, on && styles.tabBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'about' ? (
          <View style={styles.tabBody}>
            {/* No program yet → the claim card leads, since the house names everything else. */}
            {isOwn && myProgram === null ? <ClaimHouseCard /> : null}
            <IdentityCard identity={identity} />
            {/* Own profile only: the way into matching (0275), and where the Home card's "do it
                later in Profile" points (mock 314). */}
            {isOwn ? (
              <Pressable
                style={styles.grindRow}
                onPress={() => router.push('/grind-alikes' as never)}
                accessibilityRole="button"
                accessibilityLabel="Find your grind-alikes">
                <Ionicons name="people-outline" size={15} color={Colors.ember} />
                <Text style={styles.grindText}>Find your grind-alikes</Text>
                <Text style={styles.grindArrow}>→</Text>
              </Pressable>
            ) : null}
            {isOwn ? <FitnessTrackersRow /> : null}
            {!isOwn && !identity ? <Text style={styles.tabEmpty}>Nothing shared here yet.</Text> : null}
          </View>
        ) : tab === 'stats' ? (
          // THE STAT BOXES (ui_pass2 §5) — one headline each, the detail one tap away (its own screen
          // where one exists, otherwise a sheet holding the component that used to sit inline).
          <View style={styles.boxes}>
            <StatBox label="Lock-in time" value={formatSessionDuration(stats.total_seconds)} onPress={() => setSheet('time')} />
            <StatBox
              label="Sessions"
              value={String(stats.lockin_count)}
              onPress={() => (isOwn ? router.push('/lock-in-history') : setSheet('sessions'))}
            />
            <StatBox
              label="PRs"
              value={identity?.recent_win?.kind === 'pr' ? identity.recent_win.label : '—'}
              onPress={() => router.push('/fitness')}
            />
            <StatBox
              label="Discipline mix"
              value={topMix ? `${Math.round(topMix.pct)}% ${DISCIPLINE_LABELS[topMix.bucket]}` : '—'}
              onPress={() => setSheet('mix')}
            />
            <StatBox
              label="Trophies"
              value={hall ? String(trophyCount) : '—'}
              onPress={() =>
                isOwn
                  ? router.push('/trophy-hall')
                  : router.push({ pathname: '/trophy-hall', params: { userId: viewingUserId ?? '' } })
              }
            />
            <StatBox label="Journal" value="Milestones" onPress={() => setSheet('journal')} />
          </View>
        ) : (
          <View style={styles.tabBody}>
            {/* Mock 248's Showcase — chosen medals + relics on a shelf — and the read-only closet. */}
            {hall && viewingUserId ? <ProfileShowcase hall={hall} userId={viewingUserId} /> : null}
            {viewingUserId ? (
              <CollectionEntry userId={viewingUserId} isOwn={isOwn} name={profile.display_name} count={collectionCount} />
            ) : null}
          </View>
        )}
      </ScrollView>

      <DetailSheet visible={sheet === 'edit'} title="Edit profile" onClose={() => setSheet(null)}>
        <EditRow
          icon="person-circle-outline"
          label="Edit identity"
          sub="Headline, what you're working toward, anthem, interests"
          onPress={() => {
            setSheet(null);
            // Route typings are generated by Metro, so a new screen isn't in them until the next start.
            router.push('/edit-identity' as never);
          }}
        />
        <EditRow
          icon="color-wand-outline"
          label="Edit loadout"
          sub="Card, flare, halo, banner, title"
          onPress={() => {
            setSheet(null);
            router.push('/loadout');
          }}
        />
        {myProgram ? (
          <EditRow
            icon="school-outline"
            label="Change program"
            sub={`${heirTo(myProgram.patron_name)} · ${myProgram.program_abbrev || myProgram.name}`}
            onPress={() => {
              setSheet(null);
              router.push('/house/change-program');
            }}
          />
        ) : null}
      </DetailSheet>
      <DetailSheet visible={sheet === 'time'} title="Lock-in time" onClose={() => setSheet(null)}>
        <Text style={styles.sheetLead}>
          {formatSessionDuration(stats.total_seconds)} across {stats.lockin_count} {pluralize(stats.lockin_count, 'session')}
        </Text>
        {hall && viewingUserId ? <DisciplineRelicTracker relics={hall.relics} userId={viewingUserId} isOwn={isOwn} /> : null}
      </DetailSheet>
      <DetailSheet visible={sheet === 'mix'} title="Discipline mix" onClose={() => setSheet(null)}>
        <DisciplineMixBar mix={mix} isOwn={isOwn} />
        {mix.length === 0 ? <Text style={styles.sheetLead}>Nothing to mix yet — lock in and it fills.</Text> : null}
      </DetailSheet>
      <DetailSheet visible={sheet === 'journal'} title="Journal" onClose={() => setSheet(null)}>
        {viewingUserId ? (
          <JournalSection
            userId={viewingUserId}
            isOwn={isOwn}
            onAddMilestone={() => {
              setSheet(null);
              router.push('/milestone/new');
            }}
          />
        ) : null}
      </DetailSheet>
      {/* Someone else's sessions: their photo gallery, under their own photo_visibility (there is
          no full-history route for another person). */}
      <DetailSheet visible={sheet === 'sessions'} title="Sessions" onClose={() => setSheet(null)}>
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
        {recentLockIns.length === 0 ? <Text style={styles.sheetLead}>No sessions to show.</Text> : null}
      </DetailSheet>

    </SafeAreaView>
    </ScreenBackground>
  );
}

type ProfileTab = 'about' | 'stats' | 'showcase';
const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: 'about', label: 'About' },
  { key: 'stats', label: 'Stats' },
  { key: 'showcase', label: 'Showcase' },
];

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

/** Own profile: the fitness-tracker door (mock 314), with "✓ On" once one is connected. */
function FitnessTrackersRow() {
  const router = useRouter();
  const { liveConnected } = useFitnessTracking();
  return (
    <Pressable
      style={styles.grindRow}
      onPress={() => router.push(TRACKERS_ROUTE)}
      accessibilityRole="button"
      accessibilityLabel={`Fitness trackers${liveConnected ? ', on' : ''}`}>
      <Ionicons name="pulse-outline" size={15} color={Colors.ember} />
      <Text style={styles.grindText}>Fitness trackers</Text>
      {liveConnected ? <Text style={styles.trackersOn}>✓ On</Text> : null}
      <Text style={styles.grindArrow}>→</Text>
    </Pressable>
  );
}

/** One stat box: a headline number and a label; the whole box opens its detail. */
function StatBox({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.box, pressed && styles.boxPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Open details`}>
      <Text style={styles.boxValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      <View style={styles.boxFoot}>
        <Text style={styles.boxLabel} numberOfLines={1}>
          {label}
        </Text>
        <UiGlyph name="forward" size={12} color={Colors.spaceFaint} />
      </View>
    </Pressable>
  );
}

/** The bottom sheet a stat box opens when its detail has no screen of its own. */
function DetailSheet({
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
  boxes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  box: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 78,
    justifyContent: 'space-between',
    padding: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  boxPressed: {
    opacity: 0.85,
  },
  boxValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 17,
    color: Colors.ink,
  },
  boxFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 6,
  },
  boxLabel: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
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
  sheetLead: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
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
  // About · Stats · Showcase — the Leaderboard's segmented control, so the two read as one family.
  tabs: {
    flexDirection: 'row',
    marginTop: Spacing.three,
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  tabBtnOn: {
    backgroundColor: Colors.spacePanel2,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  tabTextOn: {
    color: Colors.navEmber2,
  },
  tabBody: {
    marginTop: Spacing.two,
  },
  tabEmpty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  grindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  grindText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  trackersOn: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.green,
  },
  grindArrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.achieverText,
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
