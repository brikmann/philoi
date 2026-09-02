import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeaderboardPanel } from '@/components/campfire/leaderboard-panel';
import { CampfireBannerArt } from '@/components/campfire-banner-art';
import { CampfireOptionsSheet } from '@/components/campfire-options-sheet';
import { CircleTimeline } from '@/components/circle-timeline';
import { ErrorBoundary } from '@/components/error-boundary';
import { heatToState } from '@/components/heat-flame';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useCampfireHeat } from '@/hooks/use-campfire-heat';
import { useCampfireStats } from '@/hooks/use-campfire-stats';
import { useGroup } from '@/hooks/use-group';
import { useMyGroups } from '@/hooks/use-my-groups';
import { track } from '@/lib/analytics';
import { fetchCampfireMembers } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
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

const HEAT_WORD: Record<ReturnType<typeof heatToState>, string> = {
  roaring: 'roaring',
  simmering: 'embers',
  cold: 'burnt out',
};

export default function GroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { session } = useAuth();
  const { group, refetch: refetchGroup } = useGroup(groupId);
  const { groups: myGroups } = useMyGroups();
  const heatByGroupId = useCampfireHeat();
  const { stats } = useCampfireStats(groupId);

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

  const heat = heatByGroupId[groupId] ?? 0;
  const memberCount = stats?.member_count ?? members.length;

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

      {/* ── the top bar (mock 101 frame 1) ──────────────────────────────────────────────────────
          Emoji + name + one member/heat line on the left; two round buttons on the right. It sits
          on its own soft gradient rather than a solid bar so the banner reads behind it. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          style={styles.fireId}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to your campfires">
          <View style={styles.fireEmoji}>
            <Text style={styles.fireEmojiGlyph}>{group?.emoji ?? '🔥'}</Text>
          </View>
          <View style={styles.fireText}>
            <Text style={styles.fireName} numberOfLines={1}>
              {group?.name ?? '…'}
            </Text>
            <Text style={styles.fireSub} numberOfLines={1}>
              🔥 {memberCount} {memberCount === 1 ? 'member' : 'members'} · {HEAT_WORD[heatToState(heat)]}
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
  fireEmoji: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  fireEmojiGlyph: {
    fontSize: 20,
    // No lineHeight multiplier: an emoji in a fixed-height box gets clipped on Android.
  },
  fireText: {
    flex: 1,
  },
  fireName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  fireSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.heatLabel,
    marginTop: 3,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  iconBtnLead: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  trophy: {
    fontSize: 16,
  },
});
