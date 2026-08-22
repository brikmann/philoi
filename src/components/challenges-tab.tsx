import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import type { SocialChallenge } from '@/types/database';

// ┌────────────────────────────────────────────────────────────────────────────────────────────┐
// │ THE A/B SEAM. This file is the CHALLENGES TAB SLOT and belongs to the challenge subsystem   │
// │ (handoff B). The campfire container (handoff A) owns the screen, the header and the tab bar │
// │ and mounts this component for the Challenges tab's CONTENT — it does not build challenge     │
// │ cards.                                                                                      │
// │                                                                                             │
// │ What is below is a THIN PLACEHOLDER that preserves exactly what the tab did before the       │
// │ container was rebuilt (the filtered SocialChallengeCard list + empty state + create CTA), so │
// │ the screen is never broken while B lands the real thing. B replaces the body wholesale and   │
// │ keeps the props: they are the contract the container renders against.                        │
// │                                                                                             │
// │ Not in this file, by agreement: group-goal-vs-duel rendering, the ⋯ manage kebab, Delete     │
// │ challenge, and the Watch screen. All B.                                                      │
// └────────────────────────────────────────────────────────────────────────────────────────────┘

export type ChallengesTabProps = {
  groupId: string;
  myUserId: string;
  /** May this viewer start/manage challenges here? From useCampfireRole — owner OR admin. */
  isAdmin: boolean;
  /** The container's header + tab bar. Render it as the list header so the tab scrolls as one. */
  ListHeaderComponent?: React.ReactElement | null;
  /** Room below the last row. The screen's SafeAreaView already clears the home indicator; this
   *  is the gap ON TOP of it, so cards and CTAs never end flush against the edge. */
  bottomGap: number;
};

export function ChallengesTab({ groupId, myUserId, isAdmin, ListHeaderComponent, bottomGap }: ChallengesTabProps) {
  const router = useRouter();
  const { challenges, refetch } = useSocialChallenges();

  // useSocialChallenges is the whole cross-campfire feed, so this is a filter on it rather than
  // a second fetch of the same table.
  const groupChallenges = useMemo(
    () => challenges.filter((c) => c.circle_id === groupId && (c.status === 'active' || c.status === 'pending')),
    [challenges, groupId]
  );

  function startChallenge() {
    router.push({ pathname: '/challenge/create', params: { mode: 'group', circleId: groupId } });
  }

  return (
    <FlatList
      data={groupChallenges}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingBottom: bottomGap }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.coral} />}
      ListHeaderComponent={ListHeaderComponent}
      renderItem={({ item }: { item: SocialChallenge }) => (
        <View style={styles.cardWrap}>
          <SocialChallengeCard challenge={item} myUserId={myUserId} onChanged={refetch} />
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <EmptyState title="No live challenges" body="Nobody in this campfire has anything running right now." />
          {isAdmin && (
            <Pressable style={styles.cta} onPress={startChallenge}>
              <Text style={styles.ctaLabel}>＋ Start a challenge</Text>
            </Pressable>
          )}
        </View>
      }
      ListFooterComponent={
        groupChallenges.length > 0 && isAdmin ? (
          <Pressable style={[styles.cta, styles.ctaFooter]} onPress={startChallenge}>
            <Text style={styles.ctaLabel}>＋ Start a challenge</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    paddingHorizontal: Spacing.twelve,
    paddingTop: Spacing.two,
  },
  empty: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  cta: {
    alignSelf: 'center',
    marginTop: Spacing.three,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: '#171226',
    borderWidth: 1,
    borderColor: '#2A2140',
  },
  ctaFooter: {
    marginTop: Spacing.twelve,
  },
  ctaLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.amber,
  },
});
