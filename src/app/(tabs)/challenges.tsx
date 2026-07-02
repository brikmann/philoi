import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ChallengeCard } from '@/components/challenge-card';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useMyGroups } from '@/hooks/use-my-groups';
import { deleteChallenge } from '@/lib/api/challenges';
import type { Challenge } from '@/types/database';

export default function ChallengesScreen() {
  const router = useRouter();
  const { challenges, loading, error, refetch } = useMyChallenges();
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
      {celebrating && <RewardBurst ref={rewardBurstRef} tier="bloom" />}
      <FlatList
        data={sections}
        keyExtractor={(item: Challenge) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Challenges</Text>
            <Text style={styles.headerSubtitle}>Quantified goals your circle can see.</Text>
            <PrimaryButton label="New challenge" onPress={() => router.push('/challenge/create')} />
            {error && <Text style={styles.error}>{error}</Text>}
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
          !loading ? (
            <EmptyState
              emoji="🎯"
              title="No challenges yet"
              body="Set a quantified goal — steps, gym visits, study hours — and let your circle keep you honest."
              action={<PrimaryButton label="New challenge" onPress={() => router.push('/challenge/create')} />}
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
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.ink,
  },
  headerSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.muted,
    marginBottom: Spacing.one,
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
