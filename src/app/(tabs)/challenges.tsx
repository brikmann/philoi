import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ChallengeCard } from '@/components/challenge-card';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TabHeader } from '@/components/ui/tab-header';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useMyGroups } from '@/hooks/use-my-groups';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { deleteChallenge } from '@/lib/api/challenges';
import type { Challenge } from '@/types/database';

export default function ChallengesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { challenges, loading, error, refetch } = useMyChallenges();
  const { challenges: socialChallenges, loading: socialLoading, refetch: refetchSocial } = useSocialChallenges();
  const { groups } = useMyGroups();
  const [celebrating, setCelebrating] = useState(false);
  const [fireToken, setFireToken] = useState(0);
  const rewardBurstRef = useRef<RewardBurstHandle>(null);

  const circleNameById = useMemo(() => new Map(groups.map((g) => [g.id, `${g.emoji} ${g.name}`])), [groups]);

  const active = challenges.filter((c) => !c.completed_at);
  const completed = challenges.filter((c) => c.completed_at);
  const sections = [...active, ...completed];

  // RewardBurst only mounts once `celebrating` flips true (conditional render below) — an
  // already-mounted burst can just be fired again directly, but the very first completion
  // needs to wait a render for the ref to attach, same gotcha as check-in.tsx's handlePost.
  useEffect(() => {
    if (fireToken > 0) rewardBurstRef.current?.fire();
  }, [fireToken]);

  function handleLogged(justCompleted: boolean) {
    refetch();
    if (justCompleted) {
      setCelebrating(true);
      setFireToken((t) => t + 1);
    }
  }

  async function handleDelete(challengeId: string) {
    await deleteChallenge(challengeId);
    refetch();
  }

  return (
    <Screen padded={false}>
      <TabHeader title="Challenges" />
      {celebrating && <RewardBurst ref={rewardBurstRef} cue="settle" />}
      <FlatList
        data={sections}
        keyExtractor={(item: Challenge) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={loading || socialLoading}
            onRefresh={() => {
              refetch();
              refetchSocial();
            }}
            tintColor={Colors.coral}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <PrimaryButton label="Start a challenge" onPress={() => router.push('/challenge/create')} />
            {error && <Text style={styles.error}>{error}</Text>}

            {socialChallenges.length > 0 && (
              <View style={styles.socialList}>
                {socialChallenges.map((c) => (
                  <SocialChallengeCard
                    key={c.id}
                    challenge={c}
                    myUserId={session?.user.id ?? ''}
                    onChanged={refetchSocial}
                  />
                ))}
              </View>
            )}

            {sections.length > 0 && <Text style={styles.sectionLabel}>Personal goals</Text>}
          </View>
        }
        renderItem={({ item }) => {
          const circleId = item.circle_id;
          const circleName = circleId ? (circleNameById.get(circleId) ?? null) : null;
          return (
            <ChallengeCard
              challenge={item}
              circleName={circleName}
              onLogged={handleLogged}
              onDeleted={() => handleDelete(item.id)}
              onViewLeaderboard={
                circleId
                  ? () =>
                      router.push(
                        `/challenge-leaderboard?circleId=${circleId}&type=${item.type}&title=${encodeURIComponent(circleName ?? 'Challenge')}`
                      )
                  : undefined
              }
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          // No action button here — the header's "New challenge" button above is always
          // visible regardless of whether the list is empty, so a second one here was a
          // duplicate CTA, not a fallback. Only shown when there's truly nothing at all —
          // personal goals AND social challenges both empty.
          !loading && !socialLoading && socialChallenges.length === 0 ? (
            <EmptyState
              emoji="🎯"
              title="No challenges yet"
              body="Challenge a friend, race your Campfire, or set a quantified personal goal."
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  socialList: {
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: Spacing.four,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
});
