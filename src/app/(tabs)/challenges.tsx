import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChallengeCard } from '@/components/challenge-card';
import { GoalStreakRewardScreen } from '@/components/economy/goal-streak-reward-screen';
import { GoalStreakShareCard } from '@/components/economy/goal-streak-share-card';
import { TargetEmberHero } from '@/components/empty-states/target-ember-hero';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { SocialChallengeCard } from '@/components/social-challenge-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { ScreenBackground } from '@/components/ui/screen-background';
import { TabHeader } from '@/components/ui/tab-header';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useFitnessConnection } from '@/hooks/use-fitness-connection';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { deleteChallenge, type GoalDayAward } from '@/lib/api/challenges';
import { useNextGoalReveal } from '@/lib/goal-reveal-queue';
import { shareCardImage } from '@/lib/share-card';
import type { Challenge, SocialChallenge } from '@/types/database';

/** Mock 102's `.tab` — a count badge only when there is something to count, so an empty side
 * reads as calm rather than as a zero someone has to interpret. */
function TabPill({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabOn]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count > 0 ? `${label}, ${count}` : label}>
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
      {count > 0 ? (
        <View style={[styles.tabCount, active && styles.tabCountOn]}>
          <Text style={[styles.tabCountText, active && styles.tabCountTextOn]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * One band of the Friends list, with its heading — and nothing at all when the band is empty.
 *
 * An always-present "Waiting on an answer" heading over a blank space is worse than no heading: it
 * reads as something failing to load. Headings appear only when they have something under them,
 * which also means the common case (one live duel, nothing pending) is a single unlabelled-looking
 * list rather than a form with sections.
 */
function SocialGroup({
  label,
  challenges,
  myUserId,
  onChanged,
  onOpen,
}: {
  label: string;
  challenges: SocialChallenge[];
  myUserId: string;
  onChanged: () => void;
  onOpen?: (challengeId: string) => void;
}) {
  if (challenges.length === 0) return null;
  return (
    <>
      <Text style={styles.groupHeading}>{label}</Text>
      <View style={styles.socialList}>
        {challenges.map((c) => {
          const card = <SocialChallengeCard challenge={c} myUserId={myUserId} onChanged={onChanged} />;
          if (!onOpen) return <View key={c.id}>{card}</View>;
          return (
            <Pressable key={c.id} onPress={() => onOpen(c.id)}>
              {card}
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

export default function ChallengesScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { challenges, loading, error, refetch } = useMyChallenges();
  // Payouts that landed without a tap — a device sync finishing a goal here or on the create screen.
  // Still READ, never drawn here any more. GoalRevealWatcher (root layout) owns the queue now, so
  // a goal the device finished celebrates wherever the user is standing rather than waiting for
  // this tab. What the tab still needs from it is the knowledge that a payout is on screen SOMEWHERE
  // — its own manual-log reveal must not open underneath the global one.
  const queuedElsewhere = useNextGoalReveal() !== null;
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
  //
  // 'draft' is in this band too. It was in NEITHER band, so a challenge you created and had not
  // invited anyone to yet was returned by the RPC (0097 shows a draft to its author) and then
  // dropped on the floor by both filters — invisible on the one screen that lists your challenges,
  // while sitting in the campfire's own tab waiting to be started. A status added to the
  // vocabulary in 0096 that every literal-matching reader silently stopped covering.
  const liveSocial = socialChallenges.filter(
    (c) => c.status === 'draft' || c.status === 'pending' || c.status === 'active',
  );
  // THE THREE STATES, TOLD APART. `liveSocial` above is still the count the Friends pill shows —
  // "there is something over here" is one number — but the LIST is grouped, because racing and
  // waiting-on-an-answer are different situations and stacking them made the tab read as one
  // undifferentiated pile. A challenge nobody has answered is not live; it is a thing you are
  // waiting on, and the manage-sheet state that says so had nowhere to show on the tab itself.
  //
  // Bands, not literals: 'active' is racing and (draft|pending) is awaiting a decision, matching
  // challenge_is_live / challenge_is_awaiting server-side so the two agree (0096).
  const racingSocial = liveSocial.filter((c) => c.status === 'active');
  const awaitingSocial = liveSocial.filter((c) => c.status === 'draft' || c.status === 'pending');
  const pastSocial = socialChallenges.filter((c) => c.status === 'completed' || c.status === 'expired');
  const historyCount = pastSocial.length + completed.length;
  const [historyOpen, setHistoryOpen] = useState(false);
  // Mock 103's payout screen, held until dismissed. One nullable object rather than two parallel
  // states, so the screen can never render with an award but no label to describe it.
  const [goalAward, setGoalAward] = useState<{ award: GoalDayAward; goalLabel: string } | null>(null);
  const goalCardRef = useRef<View>(null);
  const [sharingGoal, setSharingGoal] = useState(false);
  // Which half of the tab is showing (mock 102 v2). Defaults to Friends: an incoming duel is the
  // most time-sensitive thing here — a personal goal is still there tomorrow, an invite expires.
  const [tab, setTab] = useState<'friends' | 'personal'>('friends');

  // RewardBurst only mounts once `celebrating` flips true (conditional render below) — an
  // already-mounted burst can just be fired again directly, but the very first completion
  // needs to wait a render for the ref to attach, same gotcha as check-in.tsx's handlePost.
  useEffect(() => {
    if (fireToken > 0) rewardBurstRef.current?.fire();
  }, [fireToken]);

  // ONE OWNER PER PAYOUT (§A). A goal the DEVICE finished used to be drawn here too, off the same
  // queue — that was this tab covering for the fact that nothing else could. Now the root layout's
  // GoalRevealWatcher draws every queued payout from wherever the user is, and this tab draws only
  // the one kind it is uniquely placed to: a goal the user finished by tapping a card in front of
  // them, which arrives through `onLogged` and never touches the queue at all.
  //
  // Suppressed while the global reveal holds the floor, so a manual log that lands in the same beat
  // as a queued one does not open a second screen under the first. The card's own callback is
  // synchronous with the tap, so this is a narrow window — but it is exactly the window a user who
  // taps Log while a sync is resolving lands in.
  const activeAward = queuedElsewhere ? null : goalAward;
  /** Close the reveal. Only the manual path reaches this now; the queue is retired by the watcher. */
  function dismissAward() {
    setGoalAward(null);
  }

  function handleLogged(justCompleted: boolean, award: GoalDayAward | null, goalLabel: string) {
    refetch();
    if (!justCompleted) return;

    // The full reward SCREEN when the server actually paid; the plain burst otherwise.
    // `already_awarded` means this local day was banked earlier — re-showing the payout would
    // announce embers that did not move a second time.
    if (award && !award.already_awarded) {
      setGoalAward({ award, goalLabel });
      return;
    }
    setCelebrating(true);
    setFireToken((t) => t + 1);
  }

  async function handleShareGoalStreak() {
    setSharingGoal(true);
    try {
      await shareCardImage(goalCardRef, 'Share to your story');
    } finally {
      setSharingGoal(false);
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
  // something that should push live ones down the screen.
  //
  // Pinned to the screen's bottom edge now (mock 98), split into a bar and a panel. As a
  // ListFooter/trailing block it landed wherever the content above it happened to stop, which on
  // the empty layout was an orphaned row floating mid-screen. A border-top bar on the bottom edge
  // is a place it always belongs, whichever layout is showing.
  const historyBar =
    historyCount > 0 ? (
      <Pressable
        onPress={() => setHistoryOpen((v) => !v)}
        style={styles.historyBar}
        accessibilityRole="button"
        accessibilityState={{ expanded: historyOpen }}
        accessibilityLabel={`History, ${historyCount} finished`}>
        <View style={styles.historyLeft}>
          <Text style={styles.historyLabel}>History</Text>
          <View style={styles.historyChip}>
            <Text style={styles.historyChipText}>{historyCount}</Text>
          </View>
        </View>
        {/* The drawer opens UPWARD — there's nothing below a bar sitting on the screen's edge. */}
        <Ionicons name={historyOpen ? 'chevron-down' : 'chevron-up'} size={15} color={Colors.textTertiary} />
      </Pressable>
    ) : null;

  // Its own capped scroller: the finished list opens into the space above the bar and can never
  // push the bar (or the empty block's CTA) off-screen, however many past challenges pile up.
  const historyPanel =
    historyCount > 0 && historyOpen ? (
      <ScrollView style={styles.historyPanel} contentContainerStyle={styles.historyList}>
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
      </ScrollView>
    ) : null;

  // Nothing live to race — either the tab is brand new, or everything finished and moved into
  // History. Both get mock 98's centered ember hero, with the CTA INSIDE that column (not a
  // persistent header button above it) so it lands directly under the body copy. Header-at-top
  // over a CTA-above-the-empty-text read broken (punchlist 6, ex-5.3).
  const hasActive = liveSocial.length > 0 || sections.length > 0;
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

      {/* Mock 103. Full-screen over the tab rather than a route, for the same reason the rank-up
          forge is an overlay: it fires from wherever the user happened to log the goal, and pushing
          a route would put it in the back stack for them to swipe back into afterwards. */}
      {activeAward ? (
        <View style={styles.rewardOverlay}>
          {/* Brand purple radial behind the reveal (not the near-black forgeBg), so the rays sit on
              the Philoi background the rest of the app uses. */}
          <ScreenBackground>
          {/* 🐛 A PLAIN VIEW, NOT A SECOND <Screen>. `Screen` wraps its children in a SafeAreaView,
              and react-native-safe-area-context does not subtract what an ancestor already
              consumed — so this path was applying the status-bar inset TWICE: once on the tab's own
              <Screen>, whose container this overlay absolutely fills, and again here. The reveal's
              top bar started a whole status bar lower than it does when the same screen is
              presented by GoalRevealWatcher, which has one. The keyboard avoidance Screen also
              brings is dead weight on a reveal with no inputs. */}
          <View style={styles.rewardScreen}>
            <GoalStreakRewardScreen
              // Keyed by the goal, so a second payout queued behind the first gets a fresh mount —
              // otherwise it reuses this instance and the burst's one-per-mount effect never fires
              // again, which is the same gotcha RankUpWatcher's presentToken exists for.
              key={`${activeAward.goalLabel}-${activeAward.award.streak}`}
              award={activeAward.award}
              goalLabel={activeAward.goalLabel}
              onShare={handleShareGoalStreak}
              sharing={sharingGoal}
              onClose={dismissAward}
            />
            {/* Rendered offscreen so the story image exists the instant Share is tapped — same
                pattern the rank-up watcher uses for its card. */}
            <View style={styles.offscreenCard} pointerEvents="none">
              <GoalStreakShareCard
                ref={goalCardRef}
                streakDays={activeAward.award.streak}
                goalLabel={activeAward.goalLabel}
                handle={profile?.handle ?? null}
              />
            </View>
          </View>
          </ScreenBackground>
        </View>
      ) : null}
      {showEmpty ? (
        <View style={styles.emptyScreen}>
          <EmptyState
            icon={<TargetEmberHero />}
            title="No active challenges"
            body="Race a friend or set a personal goal. Winner takes the XP."
            action={
              <View style={styles.emptyCta}>
                <PrimaryButton label="Start a challenge" onPress={() => router.push('/challenge/create')} />
              </View>
            }
          />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={tab === 'personal' ? sections : []}
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

              {/* Friends | Personal (mock 102 v2). The two lists were stacked in one scroll, so a
                  few duels pushed personal goals off-screen and neither read as a place. Counts
                  live in the tab so the other side can say it has something waiting without being
                  visible. */}
              <View style={styles.tabs}>
                <TabPill
                  label="Friends"
                  count={liveSocial.length}
                  active={tab === 'friends'}
                  onPress={() => setTab('friends')}
                />
                <TabPill
                  label="Personal"
                  count={sections.length}
                  active={tab === 'personal'}
                  onPress={() => setTab('personal')}
                />
              </View>

              {tab === 'friends' ? (
                liveSocial.length > 0 ? (
                  <>
                    <SocialGroup
                      label="Racing now"
                      challenges={racingSocial}
                      myUserId={session?.user.id ?? ''}
                      onChanged={refetchSocial}
                      onOpen={(id) =>
                        router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: id } })
                      }
                    />
                    <SocialGroup
                      label="Waiting on an answer"
                      challenges={awaitingSocial}
                      myUserId={session?.user.id ?? ''}
                      onChanged={refetchSocial}
                      // Deliberately NOT tappable. A pending invite's own Accept/Decline buttons are
                      // the only tap targets on that card, and a Pressable wrapping them swallows
                      // the taps; a draft has no info screen worth opening yet either.
                      onOpen={undefined}
                    />
                  </>
                ) : (
                  <Text style={styles.tabEmpty}>No live challenges with friends.</Text>
                )
              ) : sections.length === 0 ? (
                <Text style={styles.tabEmpty}>No personal goals yet.</Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <ChallengeCard
              challenge={item}
              autoConnected={fitnessConnected}
              onLogged={handleLogged}
              onDeleted={() => handleDelete(item.id)}
              onInfo={() =>
                router.push({ pathname: '/challenge-info/[challengeId]', params: { challengeId: item.id, kind: 'goal' } })
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        />
      )}
      {historyPanel}
      {historyBar}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: Colors.achieverBg,
  },
  tabOn: {
    backgroundColor: Colors.coral,
  },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.muted,
  },
  tabTextOn: {
    color: Colors.ink,
  },
  tabCount: {
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: Colors.disabled,
  },
  tabCountOn: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  tabCountText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.muted,
  },
  tabCountTextOn: {
    color: Colors.ink,
  },
  tabEmpty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  // Covers the tab while the payout is up. Matches the rank-up watcher: the moment fires from
  // wherever the user was, so it takes the screen rather than becoming a route to swipe back into.
  rewardScreen: {
    flex: 1,
  },
  rewardOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  offscreenCard: {
    position: "absolute",
    top: -10000,
    left: 0,
  },
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  socialList: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  groupHeading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: Spacing.four,
  },
  // A border-top row on the screen's bottom edge (mock 98's `.histbar`).
  historyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.twelve,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // Deliberately NOT sectionLabel: that carries marginTop:24 for its use as a standalone heading,
  // which inside this centered row would drop the text below the chevron.
  historyLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  historyChip: {
    backgroundColor: Colors.disabledSurface,
    borderRadius: Radius.pill,
    paddingVertical: 2,
    paddingHorizontal: Spacing.two,
  },
  historyChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  historyPanel: {
    flexShrink: 1,
    maxHeight: 360,
  },
  historyList: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  list: {
    flex: 1,
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
    paddingHorizontal: Spacing.four,
  },
  // The ember CTA is the one action on this screen, so it gets a real width rather than
  // stretching edge to edge like a form's submit button (mock 98 draws it at 220).
  emptyCta: {
    width: 220,
    marginTop: Spacing.two,
  },
});
