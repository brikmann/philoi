import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ActiveChallengeMarkerChip } from '@/components/active-challenge-marker-chip';
import { heatToFlameState, type CampfireFlameState } from '@/components/campfire-flame-stage';
import { CindyBubble } from '@/components/cindy/cindy-bubble';
import { CindyFlamePress } from '@/components/cindy/cindy-flame-press';
import { EquippedFlameParticles } from '@/components/economy/flare-perimeter';
import { PersonalFlame } from '@/components/personal-flame';
import { CampfirePreviewSheet } from '@/components/campfire-preview-sheet';
import { FireShareCard } from '@/components/fire-share-card';
import { HexagonBadge } from '@/components/hexagon-badge';
import { SeasonPill } from '@/components/home-chrome';
import { CampfireBadge } from '@/components/campfire-badge';
import { DrawerButton } from '@/components/nav/app-drawer';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { HomeXpBar } from '@/components/home-xp-bar';
import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TAB_HEADER_HEIGHT, TAB_HEADER_PADDING_TOP } from '@/components/ui/tab-header';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveCircleLockIns } from '@/hooks/use-active-circle-lockins';
import { useCindy } from '@/hooks/use-cindy';
import { useCindyBubble } from '@/hooks/use-cindy-bubble';
import { useDailyFire } from '@/hooks/use-daily-fire';
import { useShareRank } from '@/hooks/use-share-rank';
import { useTodayLockInCount } from '@/hooks/use-today-lockin-count';
import { useActiveSession } from '@/lib/active-session-context';
import { fetchMyRanks } from '@/lib/api/goals';
import { fetchDiscoverableGroups, type MyGroup } from '@/lib/api/groups';
import { fetchActiveChallengeMarker } from '@/lib/api/leaderboard-social';
import { useAuth } from '@/lib/auth/auth-context';
import { pickGreeting } from '@/lib/greeting';
import { shareCardImage } from '@/lib/share-card';
import type { ActiveChallengeMarker, DiscoverableGroup, MyRank } from '@/types/database';

// Both hero-row bars share these exact dimensions so the fire (today) and rank (forever)
// columns read as a matched pair (design-mocks/30 option B) — position alone carries the
// "today vs. lifetime" meaning, so no extra labeling is needed either.
// Scaled up (punchlist 5.1) now that the recent-lock-ins journal no longer competes for this
// screen: at the old 34/14/72 the hero read as a small cluster stranded above a large empty gap.
// Headroom below the CTA is deliberately left free for the mock-69 season graphic.
const HERO_BADGE_SIZE = 46;

function findUniversal(ranks: MyRank[]): MyRank | undefined {
  return ranks.find((r) => r.scope === 'universal');
}

// ─────────────────────────── Page 1: Your fire ───────────────────────────

// "Locked in with you" (design-mocks/25) on the home flame — only meaningful when the active
// session is circle-scoped, so this is its own component (calls useActiveCircleLockIns
// unconditionally per mount) rather than a conditional hook call inside YourFirePage.
function LockedInBodyDoublesLine({ circleId, excludeUserId }: { circleId: string; excludeUserId: string }) {
  const activeLockIns = useActiveCircleLockIns(circleId);
  const others = activeLockIns.filter((a) => a.session.user_id !== excludeUserId);
  if (others.length === 0) return null;

  const names = others.map((a) => a.display_name);
  const text =
    names.length === 1
      ? `${names[0]} locked in with you`
      : names.length === 2
        ? `${names[0]} & ${names[1]} locked in with you`
        : `${names[0]}, ${names[1]} & ${others.length - 2} more locked in with you`;

  return (
    <View style={styles.livenow}>
      <Ionicons name="people" size={12} color={Colors.achieverText} />
      <Text style={styles.livenowText}>{text}</Text>
    </View>
  );
}

function YourFirePage({ rank, onLockIn }: { rank: MyRank | undefined; onLockIn: () => void }) {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { session: activeSession } = useActiveSession();
  const todayCount = useTodayLockInCount();
  const { dailyFire, error: dailyFireError } = useDailyFire();
  const [myMarker, setMyMarker] = useState<ActiveChallengeMarker | null>(null);
  const streak = profile?.current_streak ?? 0;
  // Cindy. Gated on consent all the way down: un-consented means no bubble, no fetch, and a
  // flame that behaves exactly as it did before she existed.
  const { consented: cindyConsented, bubbleEnabled } = useCindy();
  const { bubble: cindyBubble, dismiss: dismissBubble } = useCindyBubble({
    enabled: cindyConsented && bubbleEnabled,
    streak,
    todayCount,
    inSession: Boolean(activeSession),
  });
  // The streak share card is captured off-screen, same pipeline as every other card.
  const fireCardRef = useRef<View>(null);
  const [sharingStreak, setSharingStreak] = useState(false);
  const shareRank = useShareRank();

  async function handleShareStreak() {
    setSharingStreak(true);
    try {
      await shareCardImage(fireCardRef, 'Share your streak');
    } finally {
      setSharingStreak(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    fetchActiveChallengeMarker(session.user.id)
      .then(setMyMarker)
      .catch(() => {
        // The marker is contextual flavor here, not core data — a failed fetch just hides it.
      });
  }, [session]);

  // progress_xp overshoots goal_xp (Dispatch review: corrupted data once showed 258/20). The
  // Read straight from the backend's own flag rather than re-derived from a percentage, so it
  // stays correct once progress naturally exceeds goal. (The percentage itself is gone with the
  // vertical fire bar — HomeXpBar takes the raw XP gap and scales it against the division.)
  const fireComplete = dailyFire?.completed ?? false;
  // No personal HEAT any more (punchlist 20.1). Home's hero is your equipped flame, always lit:
  // Home is you, and the coal-bed gauge — which exists to show a fire going out — is reserved for
  // CAMPFIRES, where "nobody showed up" is the message worth sending. Whether *you* turned up
  // today is still on this screen, just in the places built to say it precisely: the daily-fire
  // segment inside the XP bar, and the streak line under the flame.

  const name = profile?.display_name?.split(' ')[0] ?? 'there';
  const previousGreetingRef = useRef<string | undefined>(undefined);
  // Picked once per (count, hour-bucket) change, not on every render — otherwise the line
  // would reroll on every unrelated re-render instead of just when the inputs it's actually
  // driven by change (PHILOI_UI_SPEC.md §5: "rotate variants... so regulars don't see the
  // same line twice," which only makes sense against a stable pick, not a flickering one).
  const greeting = useMemo(() => {
    if (activeSession) return null;
    const line = pickGreeting(todayCount, new Date().getHours(), name, previousGreetingRef.current);
    previousGreetingRef.current = line;
    return line;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately excludes `name`/previousGreetingRef so a display-name change alone doesn't reroll the line
  }, [activeSession, todayCount]);

  return (
    <View style={styles.page}>
      {/* Friends ("Your people", mock 21) is the ONE right-side action here (PHILOI_UI_SPEC.md
          §4b) — the single Friends entry point app-wide, moved off Profile. No profile avatar
          here — the bottom Profile tab already covers that. */}
      {/* Mock 92's top row: the season pill centred, one hamburger right, nothing else. The old
          title + two loose icons had grown by accretion — every destination added another glyph
          competing with the hero. Everything is still one tap away, inside the menu. */}
      <View style={styles.topRow}>
        {/* The hamburger moved to the LEFT (mock 157 frame B). It opens a LEFT-anchored drawer,
            and a panel that flies in from the opposite edge to its own control reads as two
            unrelated things. The bell keeps the right — mock 106's rule still holds: the one
            glyph that can carry a count sits closest to the thumb. */}
        <View style={[styles.topSide, styles.topSideLeft]}>
          <DrawerButton />
        </View>
        <SeasonPill />
        <View style={styles.topSide}>
          <NotificationBell />
        </View>
      </View>

      <View style={styles.pageContent}>
      {greeting && <Text style={styles.greet}>{greeting}</Text>}

      {/* Paired with the spacer below the CTA: two equal flex:1 gaps centre the hero + CTA group
          in whatever's left under the greeting, instead of stacking it at the top with all the
          emptiness beneath (punchlist 5.1). */}
      <View style={styles.heroSpacer} />

      {/* THE HERO (mock 92). One flame, big, owning the screen — replacing the three-column row
          that flanked the campfire with a vertical fire bar on one side and a vertical rank bar on
          the other. Both bars are gone because the rank row below now carries BOTH facts in a
          single horizontal bar: tier progress as the fill, today's fire encased inside it. */}
      <View style={styles.heroCenter}>
        {/* CINDY (CINDY_SPEC, mock 115 frame 1). The bubble is the WARM channel and only the warm
            channel — the protective pushback lives at the social intercept and is unreachable
            from here by construction, not by convention (see use-cindy-bubble.ts). */}
        {cindyBubble && (
          <CindyBubble
            message={cindyBubble.message}
            onPress={() => router.push('/cindy')}
            onDismiss={dismissBubble}
          />
        )}
        {/* YOUR equipped flame, breathing over its glow — mock 92's hero, at mock 92's size.
            It is also CINDY: same flame, same cosmetic, now tappable to talk to her. The hit
            target is the flame itself rather than a separate button, because a chat entry point
            sitting NEXT to her would say she is something other than the flame. */}
        <CindyFlamePress
          size={132}
          onTap={() => router.push('/cindy')}
          onHold={() => router.push(cindyConsented ? '/cindy-voice' : '/cindy')}>
          {/* Particles sit BEHIND the flame in the same box, so they read as thrown off it
              rather than as a layer over the top of it — the lock-in screen mounts its pair the
              same way round. Absolutely positioned, so PersonalFlame still sizes the box, and
              inside the press transform so they ride the tap instead of standing still while the
              flame moves under them. Renders nothing when the particle slot is empty, which is
              the common case. */}
          <EquippedFlameParticles />
          <PersonalFlame size={132} />
        </CindyFlamePress>
        {!activeSession && (
          <Pressable onPress={() => router.push('/cindy')} hitSlop={8} style={styles.cindyHint}>
            <Ionicons name="chatbubble-ellipses-outline" size={11} color={Colors.textTertiary} />
            <Text style={styles.cindyHintText}>
              tap <Text style={styles.cindyHintName}>Cindy</Text> to talk · hold to speak
            </Text>
          </Pressable>
        )}
        {activeSession?.circleId && session ? (
          <LockedInBodyDoublesLine circleId={activeSession.circleId} excludeUserId={session.user.id} />
        ) : !activeSession ? (
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={13} color={Colors.ember} />
            <Text style={styles.streakText}>{streak}-day streak</Text>
            {/* THE share trigger for the streak card (design-mocks/96's trigger table: "fire =
                share icon next to the streak on Home"). Hidden at zero — there is no flex in a
                streak you haven't started. */}
            {streak > 0 && (
              <Pressable
                onPress={handleShareStreak}
                hitSlop={10}
                disabled={sharingStreak}
                accessibilityLabel="Share your streak">
                <Ionicons
                  name={sharingStreak ? 'hourglass-outline' : 'share-outline'}
                  size={14}
                  color={Colors.textTertiary}
                />
              </Pressable>
            )}
          </View>
        ) : null}
      </View>

      {/* Rank row: hexagon badge (division inside, tier-tinted) beside the wide XP bar. One row
          answering rank, progress, XP and today's goal at once — §5. */}
      {rank ? (
        <View style={styles.rankRow}>
          <HexagonBadge tier={rank.tier} division={rank.division} size={HERO_BADGE_SIZE} />
          <HomeXpBar
            tier={rank.tier}
            division={rank.division}
            xpIntoTier={rank.xp_into_tier}
            xpForNextTier={rank.xp_for_next_tier}
            fireRemainingXp={
              dailyFireError || fireComplete || !dailyFire
                ? 0
                : Math.max(0, dailyFire.goal_xp - dailyFire.progress_xp)
            }
          />
        </View>
      ) : null}

      {/* Your own active-challenge marker (PHILOI_UI_SPEC.md §16, mock 37: "you see your own on
          Your fire") — no Watch CTA here, can_watch is always false for your own marker since
          you can't spectate yourself. */}
      {myMarker && (
        <View style={styles.markerRow}>
          <ActiveChallengeMarkerChip marker={myMarker} />
        </View>
      )}

      {/* Mock 92's `.cta` — its own padded block, not flush against the rank row above it. */}
      <View style={styles.ctaBlock}>
        <PrimaryButton
          label={activeSession ? 'Return to your lock-in' : 'Lock in'}
          onPress={activeSession ? () => router.push('/lock-in') : onLockIn}
          pulse={!activeSession}
        />
      </View>

      {/* Open room below the CTA. The "Your recent lock-ins" journal used to fill this — lock-in
          data now lives ONLY on Profile (punchlist 4B), so the fire is the hero with breathing
          space under it. This is the space the season graphic (mock 69) will fill. */}
      <View style={styles.heroSpacer} />

      {/* Off-screen capture target — mounted rather than conditionally rendered so it is already
          laid out by the time the share icon is tapped. */}
      <View style={styles.offscreenCard} pointerEvents="none">
        <FireShareCard
          ref={fireCardRef}
          streakDays={streak}
          handle={profile?.handle ?? null}
          tier={shareRank.tier}
          division={shareRank.division}
        />
      </View>
      </View>
    </View>
  );
}

// ─────────────────────────── Page 2: the valley ───────────────────────────

// Deterministic per-id placement isn't enough on its own here — with potentially dozens of
// campfires, plain per-id hashing can land two nodes on top of each other. Instead, campfires
// are assigned to a small fixed set of pre-spread, non-overlapping slots (most-central slots
// go to the most active fires, matching "roaring = big + foreground"), so spacing is
// guaranteed regardless of how many are on screen.
function hashUnit(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (h % 1000) / 1000;
}

const SLOT_COLS = [18, 50, 82];
const SLOT_ROWS = [16, 40, 64, 88];
const SLOTS: { left: number; top: number }[] = [];
SLOT_ROWS.forEach((row, ri) => {
  const offset = ri % 2 === 1 ? 12 : 0;
  SLOT_COLS.forEach((col) => SLOTS.push({ left: Math.min(92, col + offset), top: row }));
});
const SORTED_SLOTS = [...SLOTS].sort(
  (a, b) => Math.abs(a.left - 50) + Math.abs(a.top - 50) - (Math.abs(b.left - 50) + Math.abs(b.top - 50))
);

const STATE_WEIGHT: Record<CampfireFlameState, number> = { roar: 2, steady: 1, dead: 0 };

function layoutValleyNodes<T>(items: T[], idOf: (t: T) => string, stateOf: (t: T) => CampfireFlameState) {
  const sorted = [...items].sort((a, b) => {
    const byState = STATE_WEIGHT[stateOf(b)] - STATE_WEIGHT[stateOf(a)];
    return byState !== 0 ? byState : idOf(a).localeCompare(idOf(b));
  });
  return sorted.map((item, i) => {
    const slot = SORTED_SLOTS[i % SORTED_SLOTS.length];
    const wrap = Math.floor(i / SORTED_SLOTS.length);
    const jitter = wrap > 0 ? (hashUnit(idOf(item), 31 + wrap) - 0.5) * 16 : 0;
    return {
      item,
      left: Math.min(94, Math.max(6, slot.left + jitter)),
      top: Math.min(92, Math.max(8, slot.top + jitter * 0.6)),
    };
  });
}

// design-mocks/04's sizeFor(): roaring reads big/foreground, steady medium, cold/dead small.
const SIZE_FOR_STATE: Record<CampfireFlameState, number> = { roar: 56, steady: 42, dead: 32 };

// No live heat/activity data exists for circles you haven't joined (lock_in_sessions' RLS
// scopes visibility to circle-mates only) — member_count is the honest proxy for discovery
// nodes, bucketed into the same three visual sizes.
function stateForMemberCount(count: number): CampfireFlameState {
  if (count >= 15) return 'roar';
  if (count >= 4) return 'steady';
  return 'dead';
}

// The nodes carry the campfire's EMOJI now, not just a flame (mock 168). Every node on this map
// used to be the same coal-bed gauge at one of three sizes, so a valley of your own campfires was
// six identical fires distinguishable only by the label underneath — the one thing that actually
// says WHICH campfire (the emoji its creator picked) was the thing the map dropped. <CampfireBadge>
// carries both: emoji in the frame, activity as the aura around it.
//
// PHILOI_UI_SPEC.md §10's performance rule ("fully animate only the few roaring fires") still
// holds and the badge honours it by construction: roaring pulses fast and wide, steady slow and
// tight, cold runs no animation at all.
const HEAT_FOR_STATE: Record<CampfireFlameState, number> = { roar: 1, steady: 0.35, dead: 0 };

function ValleyNode({
  id,
  name,
  emoji,
  cue,
  state,
  heat,
  gated,
  left,
  top,
  dimmed,
  active,
  onPress,
}: {
  id: string;
  name: string;
  emoji: string;
  cue: string;
  state: CampfireFlameState;
  /** Drives the aura. Real heat for your own fires; the member-count proxy for discovery. */
  heat: number;
  gated: boolean;
  left: number;
  top: number;
  dimmed: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(active ? 1.7 : 1, { duration: 380, easing: Easing.bezier(0.22, 0.61, 0.36, 1) });
  }, [active, scale]);

  useEffect(() => {
    opacity.value = withTiming(dimmed ? 0.15 : 1, { duration: 350 });
  }, [dimmed, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[styles.node, { left: `${left}%`, top: `${top}%`, zIndex: active ? 9 : 2 }, animatedStyle]}
      pointerEvents={dimmed ? 'none' : 'auto'}
      key={id}>
      <Pressable onPress={onPress} style={styles.nodeTouch}>
        <CampfireBadge emoji={emoji} heat={heat} size={SIZE_FOR_STATE[state]} />
        <View style={styles.nodeLabelRow}>
          {gated && <Ionicons name="lock-closed" size={9} color={Colors.textTertiary} style={styles.nodeLockIcon} />}
          <Text style={styles.nodeLabel} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={styles.nodeCue}>{cue}</Text>
      </Pressable>
    </Animated.View>
  );
}

// "Mine" nodes need their own live "N locked in now" cue — a dedicated component so that hook
// is called unconditionally per real node instance.
function MyFireValleyNode({
  group,
  heat,
  left,
  top,
  dimmed,
  active,
  onPress,
}: {
  group: MyGroup;
  heat: number;
  left: number;
  top: number;
  dimmed: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const activeLockIns = useActiveCircleLockIns(group.id);
  const state = heatToFlameState(heat);
  const cue = activeLockIns.length > 0 ? `${activeLockIns.length} locked in` : state === 'dead' ? 'gone cold' : 'steady';

  return (
    <ValleyNode
      id={group.id}
      name={group.name}
      emoji={group.emoji}
      cue={cue}
      state={state}
      heat={heat}
      gated={false}
      left={left}
      top={top}
      dimmed={dimmed}
      active={active}
      onPress={onPress}
    />
  );
}

type Filter = 'mine' | 'school' | 'classes' | 'popular';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'mine', label: 'My fires' },
  { key: 'school', label: 'My school' },
  { key: 'classes', label: 'Classes' },
  { key: 'popular', label: 'Popular' },
];

// Exported so /campfires can render it (punchlist 16 §4). Deliberately NOT moved into its own
// file: it leans on five helpers co-located here (layoutValleyNodes, MyFireValleyNode, the Filter
// union, FILTERS, stateForMemberCount) plus a dozen styles, and hauling all of that across right
// before a build is a lot of churn for no behaviour change. The route is a four-line wrapper.
export function ValleyPage({ myGroups, heatByGroupId }: { myGroups: MyGroup[]; heatByGroupId: Record<string, number> }) {
  const router = useRouter();
  const { profile } = useAuth();
  const [filter, setFilter] = useState<Filter>('mine');
  const [search, setSearch] = useState('');
  const [discoverable, setDiscoverable] = useState<DiscoverableGroup[]>([]);
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (filter === 'mine') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchDiscoverableGroups(undefined, search, 50);
        if (!cancelled) setDiscoverable(data);
      } catch {
        if (!cancelled) setDiscoverable([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filter, search]);

  // Switching filters repopulates the valley (PHILOI_UI_SPEC.md §10).
  const discoveryPool = useMemo(() => {
    let pool = discoverable;
    if (filter === 'school' && profile?.university) {
      pool = pool.filter((g) => (g.school ?? g.owner_university) === profile.university);
    } else if (filter === 'classes') {
      pool = pool.filter((g) => g.course_code != null);
    } else if (filter === 'popular') {
      pool = [...pool].sort((a, b) => b.member_count - a.member_count);
    }
    return pool;
  }, [filter, discoverable, profile]);

  const mineFiltered = useMemo(
    () => myGroups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())),
    [myGroups, search]
  );

  const laidOutMine = useMemo(
    () => layoutValleyNodes(mineFiltered, (g) => g.id, (g) => heatToFlameState(heatByGroupId[g.id] ?? 0)),
    [mineFiltered, heatByGroupId]
  );
  const laidOutDiscovery = useMemo(
    () => layoutValleyNodes(discoveryPool, (g) => g.id, (g) => stateForMemberCount(g.member_count)),
    [discoveryPool]
  );

  return (
    // 'position' behavior (not 'padding') — the discovery search bar (styles.disc) is
    // absolutely positioned at the bottom, which padding-based avoidance can't reach at all
    // (padding only affects normal-flow layout). 'position' shifts this whole wrapped view,
    // absolutely-positioned children included, so the search bar actually clears the keyboard
    // (PHILOI_UI_SPEC.md §4b — "no input should ever sit behind the keyboard").
    <KeyboardAvoidingView style={styles.valley} behavior={Platform.OS === 'ios' ? 'position' : undefined}>
      <View style={styles.stage2}>
        {filter === 'mine'
          ? laidOutMine.map(({ item: group, left, top }) => (
              <MyFireValleyNode
                key={group.id}
                group={group}
                heat={heatByGroupId[group.id] ?? 0}
                left={left}
                top={top}
                dimmed={previewGroupId !== null && previewGroupId !== group.id}
                active={previewGroupId === group.id}
                onPress={() => setPreviewGroupId(group.id)}
              />
            ))
          : laidOutDiscovery.map(({ item: group, left, top }) => (
              <ValleyNode
                key={group.id}
                id={group.id}
                name={group.name}
                emoji={group.emoji}
                cue={
                  filter === 'classes' && group.course_code
                    ? `class · ${group.member_count} in`
                    : `${group.member_count} member${group.member_count === 1 ? '' : 's'}`
                }
                state={stateForMemberCount(group.member_count)}
                heat={HEAT_FOR_STATE[stateForMemberCount(group.member_count)]}
                gated={group.privacy === 'gated'}
                left={left}
                top={top}
                dimmed={previewGroupId !== null && previewGroupId !== group.id}
                active={previewGroupId === group.id}
                onPress={() => setPreviewGroupId(group.id)}
              />
            ))}
      </View>

      <View style={styles.disc}>
        <View style={styles.search}>
          <Ionicons name="search" size={13} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search campfires, courses, schools"
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={styles.chips}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipOn]}
              onPress={() => setFilter(f.key)}>
              <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelOn]} numberOfLines={1}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.codeRow} onPress={() => router.push('/join')}>
          <Ionicons name="key-outline" size={12} color={Colors.muted} />
          <Text style={styles.codeLabel}>Have a code? Join a private campfire</Text>
        </Pressable>

        <Pressable style={styles.startRow} onPress={() => router.push('/group/create')}>
          <Ionicons name="add" size={13} color={Colors.amber} />
          <Text style={styles.startLabel}>Start a campfire of your own</Text>
        </Pressable>
      </View>

      <CampfirePreviewSheet groupId={previewGroupId} onClose={() => setPreviewGroupId(null)} />
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────── Shell ───────────────────────────
//
// Was a two-page horizontal pager (your fire / campfires). Campfires moved to the hamburger and
// its own route in punchlist 16 §4, so the pager, its page dots, and the group/heat data that only
// the campfires page consumed are all gone from here.

export default function TodayScreen() {
  const router = useRouter();
  const [rank, setRank] = useState<MyRank | undefined>(undefined);
  const [lockInPickerVisible, setLockInPickerVisible] = useState(false);
  // A tapped "lock in?" nudge (design-mocks/21) deep-links here with ?lockin=1 — pop the goal
  // picker straight away, then clear the param so it doesn't re-fire on the next render.
  const { lockin } = useLocalSearchParams<{ lockin?: string }>();
  useEffect(() => {
    if (lockin === '1') {
      setLockInPickerVisible(true);
      router.setParams({ lockin: undefined });
    }
  }, [lockin, router]);

  useEffect(() => {
    fetchMyRanks()
      .then((ranks) => setRank(findUniversal(ranks)))
      .catch(() => {
        // Rank is contextual flavor here, not core data — a failed fetch just hides the stat.
      });
  }, []);

  return (
    <Screen padded={false} style={styles.screen}>
      {/* Overlaid on the header band, not stacked above it — as a normal-flow row it added ~19px
          of height that the other three tabs don't have, pushing "Your fire" below their titles.
          Absolute + the shared TabHeader geometry puts the dots in the header's empty centre and
          the title at the exact same Y as Leaderboard/Challenges/Profile. */}
      
      {/* No pager. Home is the flame / lock-in hub (§4) — campfires moved to the hamburger, so
          the horizontal swipe and its page dots are gone with it. */}
      <YourFirePage rank={rank} onLockIn={() => setLockInPickerVisible(true)} />

      <LockinGoalPicker visible={lockInPickerVisible} onClose={() => setLockInPickerVisible(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // NO backgroundColor (punchlist 20.1). This style lands on the content view INSIDE <Screen>,
  // i.e. on top of the deep-purple radial <Screen> just painted — so a flat Colors.cream here was
  // literally covering the gradient with the near-black it exists to replace, on the one screen
  // the gradient matters most.
  screen: {},
  page: {
    flex: 1,
  },
  // Two right-side actions now (Shop + Your people), so they need their own row inside
  // TabHeader's `right` slot rather than being a single bare icon.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  // Horizontal padding only — TabHeader supplies its own matching top inset above this, and
  // stacking page's own paddingTop on top of it would push the title further down than the
  // other three tabs' (see TabHeader's comment).
  pageContent: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  greet: {
    // Centered, per mock 92's `.greet{text-align:center}` — it was left-aligned, which pulled the
    // eye off the flame the hero is built around.
    textAlign: 'center',
    fontFamily: Fonts.display,
    fontSize: 22,
    lineHeight: 26.4,
    color: Colors.ink,
    marginTop: 14,
  },
  // The hero row (design-mocks/30 option B) — fire flanks the left, rank flanks the right, the
  // living campfire flame centers between them. Sized to its own content (not flex:1) so the
  // freed vertical space goes to `journal` below instead — see that style's comment.
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    // Breathing room before the CTA — the column captions ("Today's fire" / rank name) were
    // reading cramped right against the Lock in button (Dispatch review).
    marginBottom: Spacing.four,
  },
  markerRow: {
    alignItems: 'center',
    // Was -Spacing.two, which lifted this chip over the bottom of HomeXpBar — i.e. straight onto
    // the "N XP to today's fire" label. Nothing on this screen overlaps anything now.
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  heroCol: {
    width: 84,
    alignItems: 'center',
    gap: 9,
  },
  heroBadge: {
    width: HERO_BADGE_SIZE,
    height: HERO_BADGE_SIZE,
    borderRadius: 10,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  // Equal flex on both sides is what actually CENTRES the season pill — with one glyph on each
  // side, space-between would push the pill off-centre by the difference between them.
  topSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.three,
  },
  topSideLeft: {
    justifyContent: 'flex-start',
  },
  // Mock 92's `.rankrow`: 238 wide, centered, 14 below the hero — NOT crammed against it or the
  // CTA. The hero above is flex:1 so the flame keeps room to breathe (punchlist 17 P1).
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.two,
    width: 238,
    maxWidth: '100%',
    marginTop: 14,
  },
  // `.cta{padding:0 18px 18px}` — its own padded block, so the button never sits flush against
  // the rank row.
  ctaBlock: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 18,
  },
  // "💬 tap Cindy to talk" (mock 115 frame 1). Hidden during a live session — the flame is busy
  // being the session's flame then, and the screen already has a Return-to-lock-in CTA.
  cindyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  cindyHintText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  cindyHintName: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.amber,
  },
  heroCenter: {
    // grow-but-never-shrink, NOT `flex: 1`. A CSS column flex item gets `min-height: auto`, so
    // mock 92's .hero can't be squeezed under its own content — Yoga defaults minHeight to 0, and
    // `flex: 1` (flexShrink 1, flexBasis 0) let this box compress below the 132px flame on shorter
    // screens. Overflow is visible, so the streak line then rendered ON TOP of the XP bar's labels
    // (punchlist 21). flexBasis 'auto' floors the box at its content height; heroSpacer above
    // still absorbs the slack, so the hero stays optically centred.
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // Fixed lineHeight (not just fontSize) so this slot is exactly as tall as the size=16
  // checkmark icon it swaps with when today's fire completes — otherwise the fire column's
  // rhythm shifts vs. the rank column's (which always renders this same Text), reading as
  // "the two bars are misaligned" (Punchlist 3 §5).
  heroXp: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.ember,
  },
  heroErrorXp: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.textTertiary,
  },
  // Shared style for both "Today's fire" and the rank name (e.g. "Bronze I") — same size/weight
  // so the two columns read as a matched pair, per this layout's explicit normalization rule.
  heroCaption: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    textAlign: 'center',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // 6 on top of heroCenter's gap:8 = 14, the same step rankRow uses below it. flame → streak →
    // rank/XP bar now breathe on one rhythm instead of the streak hugging the flame.
    marginTop: 6,
  },
  offscreenCard: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
  livenow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  livenowText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.achieverText,
  },
  streakText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ember,
  },
  // Claims whatever vertical space the hero row + CTA did not use, so the fire reads as the
  // hero with open room beneath it. Replaced the recent-lock-ins journal (punchlist 4B); this
  // is the area the season graphic (mock 69) will occupy.
  heroSpacer: {
    flex: 1,
  },
  // ── valley ──
  // Was Colors.twilight900 (a deliberate darker "twilight-valley" look from earlier in this
  // project) — PHILOI_UI_SPEC.md §4b now mandates ONE background everywhere except the tab bar
  // and the two immersive routes, explicitly naming "campfire interior/valley" as the repeat
  // offender. Flagging the tension with §10's older "twilight-900 night" field description in
  // the report — following §4b here since it's the newer, more explicit instruction.
  valley: {
    flex: 1,
    // Transparent so the radial shows through on /campfires (Ember reskin sweep).
    backgroundColor: 'transparent',
  },
  stage2: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Was 44 to clear the now-removed "Your fire · swipe back" hint bar — tightened now that
    // there's nothing up there to clear.
    top: 16,
    bottom: 150,
  },
  node: {
    position: 'absolute',
    alignItems: 'center',
    width: 100,
    marginLeft: -50,
  },
  nodeTouch: {
    alignItems: 'center',
  },
  nodeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    maxWidth: 100,
  },
  nodeLockIcon: {
    marginTop: 1,
  },
  nodeLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
    flexShrink: 1,
  },
  nodeCue: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.achieverText,
  },
  disc: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.cream,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 13,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontSize: 12.5,
    color: Colors.ink,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 9,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  chipOn: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.coral,
  },
  chipLabel: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
  chipLabelOn: {
    color: Colors.achieverText,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
  },
  codeLabel: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 9,
  },
  startLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.amber,
  },
  // ── pager ──
  pager: {
    flex: 1,
  },
  dotsRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    height: TAB_HEADER_HEIGHT,
    paddingTop: TAB_HEADER_PADDING_TOP,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.lineStrong,
  },
  dotOn: {
    backgroundColor: Colors.coral,
    width: 18,
  },
});
