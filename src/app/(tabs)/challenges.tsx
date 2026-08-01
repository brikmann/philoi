import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ChallengeCard } from '@/components/challenge-card';
import { SpartanArmorEmpty } from '@/components/empty-states/spartan-armor-empty';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { TabHeader } from '@/components/ui/tab-header';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
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

  // Finished work moves out of the way (punchlist 4E) — the tab was accumulating every past
  // challenge above the live ones. `sections` (the FlatList's data) is now ACTIVE personal goals
  // only; everything finished collects in the collapsed History block below.
  const active = challenges.filter((c) => !c.completed_at);
  const completed = challenges.filter((c) => c.completed_at);
  const sections = active;

  // Pending invites stay up top with the live ones — they're the most actionable card on the
  // screen (Accept/Decline), so "not active" is the wrong cut for what belongs in History.
  const liveSocial = socialChallenges.filter((c) => c.status === 'pending' || c.status === 'active');
  const pastSocial = socialChallenges.filter((c) => c.status === 'completed' || c.status === 'expired');
  const historyCount = pastSocial.length + completed.length;
  const [historyOpen, setHistoryOpen] = useState(false);

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

  function goWatch(challengeId: string, mode: 'h2h' | 'group') {
    router.push({ pathname: '/watch/[challengeId]', params: { challengeId, mode } });
  }

  // Truly nothing at all — personal goals AND social challenges both empty. Mock 41's empty
  // layout has no title bar and puts the CTA INSIDE the centered illustration column (not a
  // persistent header button above it) — a meaningfully different layout from the populated
  // state below, not just a conditional empty row inside the same FlatList.
  const isEmpty = !loading && !socialLoading && socialChallenges.length === 0 && challenges.length === 0;

  if (isEmpty) {
    return (
      <Screen padded={false}>
        <View style={styles.emptyScreen}>
          <EmptyState
            icon={<SpartanArmorEmpty />}
            title="No challenges yet."
            body="There's no battle. Challenge a friend, race your Campfire, or set a personal goal to see who burns brightest."
            action={
              <Pressable style={styles.emptyCta} onPress={() => router.push('/challenge/create')}>
                <Text style={styles.emptyCtaLabel}>Start a challenge</Text>
              </Pressable>
            }
          />
        </View>
      </Screen>
    );
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

            {liveSocial.length > 0 && (
              <View style={styles.socialList}>
                {liveSocial.map((c) => {
                  // A pending invite's own Accept/Decline buttons are the only tap targets on
                  // that card — wrapping it would swallow them.
                  const watchable = c.status === 'active';
                  return (
                    <Pressable key={c.id} onPress={watchable ? () => goWatch(c.id, c.mode) : undefined}>
                      <SocialChallengeCard challenge={c} myUserId={session?.user.id ?? ''} onChanged={refetchSocial} />
                    </Pressable>
                  );
                })}
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
        ListFooterComponent={
          historyCount > 0 ? (
            <View style={styles.history}>
              <Pressable
                onPress={() => setHistoryOpen((v) => !v)}
                style={styles.historyToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: historyOpen }}
                accessibilityLabel={`History, ${historyCount} finished`}>
                <Text style={styles.historyLabel}>History</Text>
                <Text style={styles.historyCount}>{historyCount}</Text>
                <Ionicons name={historyOpen ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textTertiary} />
              </Pressable>

              {historyOpen && (
                <View style={styles.historyList}>
                  {/* Finished duels/group races ARE tappable now — the watch RPCs accept
                      completed/expired (migration 0056), so this opens the final standings. */}
                  {pastSocial.map((c) => (
                    <Pressable key={c.id} onPress={() => goWatch(c.id, c.mode)}>
                      <SocialChallengeCard challenge={c} myUserId={session?.user.id ?? ''} onChanged={refetchSocial} />
                    </Pressable>
                  ))}
                  {completed.map((item) => {
                    const circleId = item.circle_id;
                    const circleName = circleId ? (circleNameById.get(circleId) ?? null) : null;
                    return (
                      <ChallengeCard
                        key={item.id}
                        challenge={item}
                        circleName={circleName}
                        onLogged={handleLogged}
                        onDeleted={() => handleDelete(item.id)}
                      />
                    );
                  })}
                </View>
              )}
            </View>
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
  // Collapsed by default (punchlist 4E) — finished challenges are a record to go looking for,
  // not something that should push live ones down the screen.
  history: {
    marginTop: Spacing.two,
  },
  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  // Deliberately NOT sectionLabel: that carries marginTop:24 for its use as a standalone heading,
  // which inside this centered row would drop the text below the chevron.
  historyLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  historyCount: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  historyList: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
  emptyScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCta: {
    marginTop: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  emptyCtaLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
  },
});
