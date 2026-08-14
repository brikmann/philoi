import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { deleteChallenge } from '@/lib/api/challenges';
import type { Challenge } from '@/types/database';

export default function ChallengesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { challenges, loading, error, refetch } = useMyChallenges();
  const { challenges: socialChallenges, loading: socialLoading, refetch: refetchSocial } = useSocialChallenges();
  const { connected: fitnessConnected } = useFitnessConnection();
  const [celebrating, setCelebrating] = useState(false);
  const [fireToken, setFireToken] = useState(0);
  const rewardBurstRef = useRef<RewardBurstHandle>(null);


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

  // Collapsed by default (punchlist 4E) — finished challenges are a record to go looking for, not
  // something that should push live ones down the screen. Shared by both layouts: the footer of
  // the populated list, and the block below the centered empty state when nothing is active but
  // History still has entries.
  const historySection =
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
            {completed.map((item) => (
              <ChallengeCard
                key={item.id}
                challenge={item}
                autoConnected={fitnessConnected}
                onLogged={handleLogged}
                onDeleted={() => handleDelete(item.id)}
              />
            ))}
          </View>
        )}
      </View>
    ) : null;

  // Nothing live to race — either the tab is brand new, or everything finished and moved into
  // History. Both get mock 41's empty layout: no title bar, and the CTA INSIDE the centered
  // illustration column (not a persistent header button above it) so it lands directly under the
  // body copy. Header-at-top over a CTA-above-the-empty-text read broken (punchlist 6, ex-5.3).
  const hasActive = liveSocial.length > 0 || sections.length > 0;
  const nothingAtAll = socialChallenges.length === 0 && challenges.length === 0;
  // Still fetching keeps the populated chrome — flashing the empty layout for a frame and then
  // yanking it back is worse than a briefly-bare list.
  const showEmpty = !loading && !socialLoading && !hasActive;

  return (
    <Screen padded={false}>
      {!showEmpty && <TabHeader title="Challenges" />}
      {/* Hoisted above the branch on purpose: completing your last active goal flips this screen
          into the empty layout mid-animation, and a burst mounted inside either branch would be
          unmounted by that flip. Held at a stable child position so it survives the swap. */}
      {celebrating && <RewardBurst ref={rewardBurstRef} cue="settle" />}
      {showEmpty ? (
        // Scrolls rather than flexes so an expanded History can't push the empty block off-screen;
        // flexGrow keeps that block centered in the leftover space while History is collapsed.
        <ScrollView contentContainerStyle={styles.emptyScroll}>
          <View style={styles.emptyScreen}>
            <EmptyState
              icon={<SpartanArmorEmpty />}
              title={nothingAtAll ? 'No challenges yet.' : 'No active challenges'}
              body={
                historyCount > 0
                  ? 'Race a friend or set a personal goal — your finished ones are in History below.'
                  : "There's no battle. Challenge a friend, race your Campfire, or set a personal goal to see who burns brightest."
              }
              action={
                <Pressable style={styles.emptyCta} onPress={() => router.push('/challenge/create')}>
                  <Text style={styles.emptyCtaLabel}>Start a challenge</Text>
                </Pressable>
              }
            />
          </View>
          {historySection}
        </ScrollView>
      ) : (
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
          renderItem={({ item }) => (
            <ChallengeCard challenge={item} autoConnected={fitnessConnected} onLogged={handleLogged} onDeleted={() => handleDelete(item.id)} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          ListFooterComponent={historySection}
        />
      )}
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
  // Matches listContent's gutters so History lines up whichever layout it's rendered under.
  emptyScroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  // flexGrow, not flex:1 — flex's flexBasis:0 lets an expanded History squeeze this to nothing
  // once the two together overflow the viewport. Grow-only fills the leftover space when History
  // is collapsed and keeps its natural height when it isn't.
  emptyScreen: {
    flexGrow: 1,
    flexShrink: 0,
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
