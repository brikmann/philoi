import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { LeaderboardPanel } from '@/components/campfire/leaderboard-panel';
import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { CampfireOptionsSheet } from '@/components/campfire-options-sheet';
import { CircleTimeline } from '@/components/circle-timeline';
import { ErrorBoundary } from '@/components/error-boundary';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useCampfireStats } from '@/hooks/use-campfire-stats';
import { useGroup } from '@/hooks/use-group';
import { useMyGroups } from '@/hooks/use-my-groups';
import { track } from '@/lib/analytics';
import { fetchCampfireMembers } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { useFlameRamp } from '@/lib/economy/flame-ramp';
import type { CampfireMember } from '@/types/database';

// THE CAMPFIRE, AS A FULL-SCREEN CHAT (design-mocks/101-campfire-chat.html).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS REPLACES, AND WHY THE TAB BAR HAD TO GO
//
// This screen used to be chrome around THREE surfaces — a Leaderboard / Feed / Challenges tab bar,
// a tall stat header, and whichever tab's content was mounted. Mock 101's argument is that a
// campfire is a place people talk, and the talking was one third of one tab: you opened your own
// campfire and landed on a leaderboard.
//
// So the chat is the screen. Everything the tab bar used to hold is still here, reached the way
// Discord reaches it — from the top bar (🏆 leaderboard, ⋯ options) or from the + menu next to the
// composer. Nothing was deleted; it was demoted from "a third of the screen, permanently" to "one
// tap, when you want it".
//
// WHAT WENT WITH IT:
//   · The Leaderboard/Feed/Challenges tab bar and `changeTab`. The leaderboard is a panel over
//     this screen now (LeaderboardPanel); challenges are feed embeds (see circle-timeline.tsx §7).
//   · The swipe-up-for-full-screen-feed gesture, and the ~50 lines of comment explaining the three
//     bugs it took to make it work. That mechanic existed to get the feed out from under a tall
//     header; the feed IS the screen now, so there is nothing to swipe out of. Deleting a
//     hard-won fix feels wrong, which is why it is worth saying plainly: the fix was correct and
//     the problem it solved no longer exists.
//   · The stat strip (avg streak / hours / live challenges) and the lock-in pill. Mock 101's top
//     bar is name, member/heat line, and two round buttons — nothing else earns permanent space
//     above a conversation.
//   · <ChallengesTab/>. Its LOGIC is untouched and still mounted from the top-level Challenges
//     screen; what changed is that this screen no longer renders it as a tab.
//
// WHAT STAYED: the full-screen animated banner, its ErrorBoundary, and the legibility scrim. The
// chat sits ON the banner — that is the whole look, and it is why every layer below is
// transparent.
// ══════════════════════════════════════════════════════════════════════════════════════════════

// ── the ring-lit glow behind the flame tile (mock 174's `.tile::after`) ───────────────────────
//
// `radial-gradient(circle, rgba(242,163,60,.5), transparent 70%)` has no React Native equivalent —
// there are no gradient backgrounds and expo-linear-gradient is not installed — so this is the same
// measure-and-paint-an-SVG-underneath trick EmberFill documents, with a RadialGradient instead of a
// linear one. Fixed size rather than measured: the tile is a known 44px box, so there is nothing to
// wait a layout pass for and the halo is never absent for a frame.
//
// 🔴 `useId` IS LOAD-BEARING, not tidiness. react-native-svg gradient ids are GLOBAL — ember-fill.tsx
// found this the hard way — and a shared literal blanks every instance after the first on Android.
const HALO = 62;

function TileHalo({ colour }: { colour: string }) {
  const gradId = `tile-halo-${useId()}`;
  return (
    <Svg width={HALO} height={HALO} style={styles.halo} pointerEvents="none">
      <Defs>
        <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colour} stopOpacity={0.5} />
          <Stop offset="0.62" stopColor={colour} stopOpacity={0.14} />
          <Stop offset="1" stopColor={colour} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={HALO} height={HALO} fill={`url(#${gradId})`} />
    </Svg>
  );
}

export default function GroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group, refetch: refetchGroup } = useGroup(groupId);
  const { groups: myGroups } = useMyGroups();
  const { stats } = useCampfireStats(groupId);
  // The tile glows the campfire's equipped-flame colour, so two fires never look like one.
  const ramp = useFlameRamp();

  const [optionsVisible, setOptionsVisible] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [chatMutedOverride, setChatMutedOverride] = useState<boolean | null>(null);
  const [members, setMembers] = useState<CampfireMember[]>([]);

  const chatMuted = chatMutedOverride ?? myGroups.find((g) => g.id === groupId)?.chat_muted ?? false;

  useEffect(() => {
    track('chat_opened', { group_id: groupId });
  }, [groupId]);

  // The roster, fetched once here rather than twice below: the @-mention autocomplete and the
  // ping sheet both need it, and they are both inside the timeline.
  useEffect(() => {
    fetchCampfireMembers(groupId)
      .then(setMembers)
      .catch(() => {
        // Mentions and ping degrade to an empty list rather than breaking the chat.
      });
  }, [groupId]);

  const memberCount = stats?.member_count ?? members.length;
  // §1 — STATUS, NOT PLUMBING. This line used to end in the heat word, which rendered as
  // "· embers" — Noah: "means nothing." A streak is a thing you can lose, so it is the half of the
  // line worth reading. Hidden entirely at 0 rather than shown as "0-day streak", which reads as an
  // accusation on a campfire that simply started today.
  const streakDays = Math.round(stats?.avg_streak ?? 0);
  const isOwner = myGroups.find((g) => g.id === groupId)?.role === 'owner';

  // Mock 101's top bar is 52px of status bar plus ~66px of bar. The leaderboard panel opens
  // BELOW it (frame 3), so it needs to be told where that line falls.
  const topBarHeight = insets.top + 66;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Behind everything, above nothing: absolutely filled and non-interactive, so the top bar,
          the chat and the composer all sit ON the banner rather than each painting their own
          ground. The art's own veil carries it toward Colors.bgRadialTo — the same colour
          ScreenBackground's radial settles on — so content legibility is the veil's job and
          nothing needs a second scrim. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Decorative backdrop — if a scene ever throws, degrade to no banner (Sentry logs it)
            rather than white-screen the whole campfire. */}
        <ErrorBoundary fallback={null}>
          <CampfireBannerArt itemKey={group?.banner_item_id} variant="screen" animated />
        </ErrorBoundary>
      </View>

      {/* ── the top bar (mock 101 frame 1, restyled to mock 174's cover header) ────────────────
          Ring-lit flame tile + name + one members/streak line on the left; a gold trophy and a
          quiet kebab on the right. It sits on its own soft gradient rather than a solid bar so the
          banner reads behind it as an immersive background rather than as art in a slot.
          The BAR stays compact rather than growing into 174's 172px cover: topBarHeight below is
          what the leaderboard panel opens beneath, so its height is load-bearing beyond the look. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          style={styles.fireId}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to your campfires">
          <View style={styles.fireTile}>
            <TileHalo colour={ramp.mid} />
            <View style={[styles.fireEmoji, { borderColor: ramp.mid }]}>
              <Text style={styles.fireEmojiGlyph}>{group?.emoji ?? '🔥'}</Text>
            </View>
          </View>
          <View style={styles.fireText}>
            <Text style={styles.fireName} numberOfLines={1}>
              {group?.name ?? '…'}
              {isOwner ? <Text style={styles.crown}> 👑</Text> : null}
            </Text>
            <Text style={styles.fireSub} numberOfLines={1}>
              🔥 {memberCount} {memberCount === 1 ? 'member' : 'members'}
              {streakDays > 0 ? ` · ${streakDays}-day streak` : ''}
            </Text>
          </View>
        </Pressable>

        <View style={styles.topActions}>
          <Pressable
            style={[styles.iconBtn, styles.iconBtnLead]}
            onPress={() => setLeaderboardVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Open the leaderboard">
            <Text style={styles.trophy}>🏆</Text>
          </Pressable>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setOptionsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Campfire options">
            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.ink} />
          </Pressable>
        </View>
      </View>

      {/* ── the chat ── */}
      {session && (
        <CircleTimeline
          groupId={groupId}
          myUserId={session.user.id}
          members={members}
          bottomInset={insets.bottom}
        />
      )}

      <LeaderboardPanel
        visible={leaderboardVisible}
        onClose={() => setLeaderboardVisible(false)}
        groupId={groupId}
        myUserId={session?.user.id}
        topInset={topBarHeight}
      />

      <CampfireOptionsSheet
        visible={optionsVisible}
        onClose={() => setOptionsVisible(false)}
        group={group}
        groupId={groupId}
        chatMuted={chatMuted}
        onChatMutedChanged={setChatMutedOverride}
        onGroupChanged={refetchGroup}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: 16,
    paddingBottom: 12,
    // The mock's `linear-gradient(180deg, rgba(20,14,22,.72), transparent)`. A flat translucent
    // bar would draw a visible bottom edge across the banner; this dissolves into it.
    backgroundColor: 'rgba(20,14,22,0.55)',
  },
  fireId: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // The tile and its halo share a box so the glow stays centred on the tile rather than on the
  // row, which is what makes it read as light coming OFF the flame.
  fireTile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    // (44 - 62) / 2 — centres the oversized glow on the tile.
    left: -9,
    top: -9,
  },
  fireEmoji: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B1210',
    // 2px, not 1: mock 174's tile is ring-LIT, and a hairline reads as a border rather than as a
    // rim catching the fire's own light. borderColor is set per-campfire from the flame ramp.
    borderWidth: 2,
  },
  fireEmojiGlyph: {
    fontSize: 22,
    // No lineHeight multiplier: an emoji in a fixed-height box gets clipped on Android.
  },
  fireText: {
    flex: 1,
  },
  fireName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    letterSpacing: -0.3,
    color: Colors.ink,
  },
  crown: {
    fontSize: 13,
  },
  // Was Colors.heatLabel — the ember-brown that belonged to the heat word this line no longer
  // carries. A members/streak line is status, so it takes the ordinary secondary text colour and
  // stops competing with the name above it.
  fireSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 4,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    // mock 174's `.hbtn`: a dark translucent chip that lets the banner read through it rather than
    // a light scrim that flattens into the art.
    backgroundColor: 'rgba(25,16,34,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  // `.hbtn.trophy` — the one gold affordance in the bar. The kebab beside it stays quiet on
  // purpose: two lit buttons is two calls to action, and only one of them is the prize.
  iconBtnLead: {
    backgroundColor: 'rgba(42,31,18,0.8)',
    borderColor: 'rgba(255,201,77,0.4)',
  },
  trophy: {
    fontSize: 16,
  },
});
