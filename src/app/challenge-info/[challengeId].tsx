import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeRewardScreen } from '@/components/economy/challenge-reward-screen';
import { ChallengeWinShareCard } from '@/components/economy/challenge-win-share-card';
import { prefetchAvatars } from '@/components/economy/king-statue';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { Avatar } from '@/components/ui/avatar';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { ScreenBackground } from '@/components/ui/screen-background';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useChallengeReward, challengeRewardResult } from '@/hooks/use-challenge-reward';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useOpponentAvatar } from '@/hooks/use-duel-avatars';
import { useShareRank } from '@/hooks/use-share-rank';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { challengeTitle, formatMetricValue, isDuel, isPlacement, metricLabel, metricNoun } from '@/lib/challenge-metric';
import { challengeClockText, challengeRevealKind, duelOutcome, type ChallengeVerdict } from '@/lib/challenge-outcome';
import { fetchChallengeResults } from '@/lib/api/social-challenges';
import { rewardChips } from '@/lib/challenge-reward-summary';
import { getErrorMessage } from '@/lib/errors';
import { CHALLENGE_TYPE_GLYPH, canonicalGoalUnit } from '@/lib/goal-types';
import { shareCardImage } from '@/lib/share-card';
import type { ChallengeResultRow, SocialChallenge, SocialChallengeRaceMetric } from '@/types/database';

// Challenge / Goal info — design-mocks/102 v2, the screen that makes the minimal card possible.
//
// THE POINT: the browse cards used to carry "Winner +200 XP", "+50 embers on complete" and the
// tiebreak rules inline, which is what made a list of three challenges read as a wall. Moving all
// of it one tap away lets the card be avatars + bar + lead + clock, and gives the rules somewhere
// to be COMPLETE rather than abbreviated to whatever fits under a progress bar.
//
// Two variants behind one route, because they answer the same question ("what are the rules of the
// thing I'm looking at?") and splitting them into two screens would duplicate the row chrome.

type Row = { k: string; v: string; highlight?: boolean };

export default function ChallengeInfoScreen() {
  const router = useRouter();
  const { challengeId, kind } = useLocalSearchParams<{ challengeId: string; kind?: string }>();
  const isGoal = kind === 'goal';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{isGoal ? 'Goal info' : 'Challenge info'}</Text>
      </View>

      {isGoal ? <GoalInfo challengeId={challengeId} /> : <SocialInfo challengeId={challengeId} />}
    </Screen>
  );
}

/**
 * THE RESULT (0111's get_challenge_results, wired here by 0112).
 *
 * This screen is where challenge_won / challenge_lost / campfire_settled deep-link (0089), and
 * until now the tap landed on a rules table with the "Watch live" button gone and nothing in its
 * place — the reward arc's last step was a page that said what the race WOULD have been. The
 * standings were being written at settlement and read by nobody.
 *
 * Figures come from the server as they were decided. Recomputing them here from live data would
 * eventually disagree with the ledger, and the ledger is what actually moved.
 */
function Results({
  challengeId,
  myUserId,
  onShare,
  sharing,
  placement,
  raceMetric,
}: {
  challengeId: string;
  myUserId: string | undefined;
  /** Null when this viewer has no result of their own to advertise (a spectator, or a challenge
   * that settled before 0111 wrote standings). */
  onShare: (() => void) | null;
  sharing: boolean;
  /** Draws mock 114's podium above the list, and prints each racer's figure beside their rank —
   *  on a ranked board the number people came for is the metric, not the XP it converted to. */
  placement: boolean;
  raceMetric: SocialChallengeRaceMetric | null;
}) {
  const [rows, setRows] = useState<ChallengeResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchChallengeResults(challengeId)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(getErrorMessage(e, 'Could not load the result.')));
    return () => {
      live = false;
    };
  }, [challengeId]);

  if (error) return <Text style={styles.resultsError}>{error}</Text>;
  if (!rows) return <ActivityIndicator color={Colors.amber} style={styles.resultsLoading} />;
  // A challenge that settled before 0111/0112 has no roster, so there are no standings to show.
  // Says so rather than drawing an empty podium.
  if (rows.length === 0) {
    return <Text style={styles.resultsError}>No standings were recorded for this one.</Text>;
  }

  return (
    <View style={styles.results}>
      <Text style={styles.sectionLabel}>Final standings</Text>

      {/* Mock 114's podium. Only for a placement race, and only once there are enough people for a
          podium to mean anything — three racers standing on three steps is just the list again,
          drawn taller. `place`, not row order: settlement ranks ties equally (1, 1, 3), and a
          podium built from array positions would silently break one of them. */}
      {placement && rows.length > 3 ? (
        <View style={styles.podium}>
          {[2, 1, 3].map((place) => {
            const r = rows.find((x) => x.place === place);
            if (!r) return <View key={place} style={styles.podiumCol} />;
            return (
              <View key={place} style={styles.podiumCol}>
                <Avatar label={r.member_name} size={place === 1 ? 46 : 36} lit={r.member_id === myUserId} />
                <Text style={styles.podiumName} numberOfLines={1}>
                  {r.member_id === myUserId ? 'You' : r.member_name}
                </Text>
                <Text style={styles.podiumValue}>
                  {r.score_value != null ? formatMetricValue(raceMetric, r.score_value) : '—'}
                </Text>
                <View style={[styles.podiumStep, place === 1 && styles.podiumStepFirst]}>
                  <Text style={styles.podiumPlace}>{place}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {rows.map((r) => (
        <View key={r.member_id} style={[styles.resultRow, r.member_id === myUserId && styles.resultRowMe]}>
          <Text style={[styles.resultPlace, r.is_winner && styles.resultPlaceWin]}>
            {r.place != null ? `#${r.place}` : '—'}
          </Text>
          <Avatar label={r.member_name} size={28} lit={r.member_id === myUserId} />
          <View style={styles.resultWho}>
            <Text style={styles.resultName} numberOfLines={1}>
              {r.member_id === myUserId ? 'You' : r.member_name}
              {r.is_winner ? ' 👑' : ''}
            </Text>
              {r.percentile != null && rows.length > 2 ? (
              <Text style={styles.resultBand}>Top {Math.max(1, Math.round((1 - r.percentile) * 100))}%</Text>
            ) : null}
            {/* §3 — WHAT THIS RACER WAS ACTUALLY PAID, beside their rank rather than only inside a
                reveal that fires once. The XP already had a column on the right; the embers, the
                box and the badge had nowhere on this screen at all, which is why a settled race
                could not answer "what did I get for that" the day after. Read from the payload
                grant_reward stored (0154), never re-derived. XP is dropped from the chips here —
                it has its own column two elements over, and printing it twice on one row reads as
                a bug. */}
            {(() => {
              const chips = rewardChips(null, r.reward);
              return chips.length > 0 ? (
                <Text style={styles.resultReward} numberOfLines={1}>
                  {chips.map((chip) => chip.text).join(' · ')}
                </Text>
              ) : null;
            })()}
          </View>
          {/* What the ledger paid, not what the screen thinks it should have. 0 is shown as a
              dash: a group race nobody completed pays nobody, and "+0 XP" reads like a bug.

              On a ranked board the figure racers came for is the METRIC — "142h", not the XP it
              converted to — so placement leads with that and keeps the payout underneath. */}
          {placement ? (
            <View style={styles.resultFigures}>
              <Text style={styles.resultValue}>
                {r.score_value != null ? formatMetricValue(raceMetric, r.score_value) : '—'}
              </Text>
              {r.awarded_xp > 0 ? (
                <Text style={styles.resultXpUnder}>+{r.awarded_xp.toLocaleString('en-US')} XP</Text>
              ) : null}
            </View>
          ) : (
            <Text style={[styles.resultXp, r.awarded_xp > 0 && styles.resultXpPaid]}>
              {r.awarded_xp > 0 ? `+${r.awarded_xp.toLocaleString('en-US')} XP` : '—'}
            </Text>
          )}
        </View>
      ))}

      {/* SHARING IS NOT ONE-SHOT. The reveal's primary CTA is Share, but the reveal fires exactly
          once — and a win is worth advertising the day after too, which is the whole "advertise
          your wins" ethos the milestone surfaces are built on. Same card, reachable forever. */}
      {onShare ? (
        <Pressable
          style={styles.resultShare}
          onPress={onShare}
          disabled={sharing}
          accessibilityRole="button">
          <Ionicons name="share-outline" size={15} color={Colors.muted} />
          <Text style={styles.resultShareText}>{sharing ? 'Preparing…' : 'Share your result'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * THE DURATION ROW, IN THE RIGHT TENSE.
 *
 * 🔴 "Duration · 72h · ending soon" on a duel that had ended. All three shapes built this row from
 * `formatTimeLeft(ends_at)`, which only knows about a clock and therefore kept promising a future
 * on a race with a result. challengeClockText is the one derivation every challenge surface now
 * shares — it prefers the stored verdict and falls back to the countdown only while the race is
 * genuinely undecided.
 *
 * The window itself ("72h") stays either way: it is a rule of the challenge, not a countdown, and
 * it is exactly the thing somebody opens this table to read.
 */
function durationValue(c: SocialChallenge, verdict?: ChallengeVerdict): string {
  if (!c.ends_at) return `${c.window_hours}h`;
  return `${c.window_hours}h · ${challengeClockText(c.status, c.ends_at, verdict)}`;
}

function SocialInfo({ challengeId }: { challengeId: string }) {
  const { challenges, loading } = useSocialChallenges();
  const c = challenges.find((x) => x.id === challengeId);

  // 🔴 "That challenge isn't available any more." on a race that exists. The list starts EMPTY and
  // `loading` starts true (use-social-challenges), so every open of this screen missed on the first
  // frame — including the ones arriving from a challenge_won deep-link, which is the single most
  // important door onto it. The dead end was a race condition, not a missing row.
  //
  // The RPC does return settled challenges to their racers, so once the fetch lands a finished duel
  // resolves and this screen shows its result. It is only genuinely gone when the fetch has
  // completed and still has no row for this id.
  if (!c) return loading ? <ActivityIndicator color={Colors.amber} style={styles.resultsLoading} /> : <Missing what="challenge" />;
  // Split so the body can use hooks. The lookup above can miss (a deep link into a cache that
  // hasn't loaded, a stale back-stack entry), and an early return above a useEffect is the
  // hook-order bug that comes back the next time somebody adds one.
  return <SocialInfoBody c={c} />;
}

function SocialInfoBody({ c }: { c: SocialChallenge }) {
  const router = useRouter();
  const { session, profile } = useAuth();
  const shareRank = useShareRank();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const isCreator = session?.user.id === c.created_by;
  // `shape` (0096), not `opponent_id != null`. A collective goal used to draw the duel arena
  // below — CAMPFIRE_REDESIGN_SPEC's 🔴 "a group goal renders as a 1v1 VS card" — and since a
  // group challenge has no opponent_id, the empty half of that arena rendered the literal string
  // "Opponent", which is the spec's other 🔴 on the same line.
  const duel = isDuel(c);
  // The third branch (mock 114). A placement race is `mode = 'group'` like a collective goal, so
  // every "is this a duel?" test already routes it correctly — what it must NOT inherit is the
  // collective's target language, because it has no target: `target_count` is null by constraint
  // (0126) and its result is a rank, not a pass/fail.
  const placement = isPlacement(c);
  const settled = c.status === 'completed' || c.status === 'expired';
  const otherName = (isCreator ? c.opponent_name : c.created_by_name) ?? 'them';
  // The stored verdict, from the one module that knows who won. Only a duel has one — a group or
  // placement race reads "Final" — so this is null for the other two shapes and the rows below
  // pass undefined.
  const outcome = duel ? duelOutcome(c, session?.user.id, otherName) : null;

  /**
   * THE REVEAL (ledger #3 / DECISION_reward_screen_and_goal_drip.md).
   *
   * `my_state === 'accepted'` rather than "am I the creator or the opponent": since 0096 the
   * roster is what settlement scores against, and an invitee who never answered is not owed a
   * result. It is also the only check that works for a group race, where being in the campfire
   * has not implied being in the race since 0096 either.
   *
   * Everyone who raced sees this once — a fourth-place finisher gets their placement and whatever
   * consolation landed, not a victory screen. It is a RESULT screen; losing is a result.
   */
  const { reward, owed, dismiss } = useChallengeReward(c.id, settled && c.my_state === 'accepted');
  // THROUGH THE SHARED QUEUE, like every other reveal in the app.
  //
  // The global ChallengeSettlementWatcher has taken the floor before presenting since the
  // reward-rays pass; this screen — the OTHER door onto the same reveal, and the one a
  // challenge_won deep-link opens — was still presenting unconditionally. So opening a settled
  // race while a rank-up was on screen stacked the two, which is the exact thing the floor exists
  // to stop. `owed` holds the reveal until the floor is free rather than dropping it: the reward
  // is in the ledger either way and the seen-flag is only stamped on dismiss.
  const hasRevealFloor = useRevealFloor(challengeRevealKind(c), Boolean(owed && reward));
  // Memoised on the reward itself, not on `c`: useSocialChallenges hands back a fresh object every
  // poll, and a new `result` identity each render would rebuild the reveal's reward rows underneath
  // a running animation. The settled figures cannot change once written.
  const result = useMemo(
    () => (reward && reward.placement != null ? challengeRewardResult(reward, c, session?.user.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reward, c.id, session?.user.id]
  );

  // Only for a settled duel — see the hook. Null on every board race, so this costs nothing there.
  const opponentAvatarUrl = useOpponentAvatar(
    result?.context === 'duel' ? c.opponent_id ?? null : null
  );

  async function handleShare() {
    setSharing(true);
    try {
      // Warm the avatar cache first: captureRef photographs the current frame, and an unloaded
      // remote image exports as an empty circle. See the same note in the settlement watcher.
      await prefetchAvatars(profile?.avatar_url, opponentAvatarUrl);
      await shareCardImage(cardRef, 'Share your result');
      track('challenge_result_shared', { challenge_id: c.id, placement: reward?.placement ?? null });
    } finally {
      setSharing(false);
    }
  }

  /**
   * "Open your Hephaestus box" — the reveal's second CTA, live at last (ledger item 3 / B4).
   *
   * The box id comes from the payload grant_reward wrote at settlement (0125), so this opens the
   * exact row this challenge minted rather than the newest box of that key — which would be the
   * wrong one the moment two challenges settle in the same sweep.
   *
   * `dismiss()` FIRST. It stamps reward_seen_at and closes the modal; navigating out from under an
   * open Modal leaves it mounted over the box-open screen, and skipping the stamp would re-fire the
   * whole reveal the next time they come back for their standings.
   */
  function handleOpenBox(boxId: string, boxKey: string) {
    dismiss();
    track('challenge_reward_box_opened', { challenge_id: c.id, box_key: boxKey });
    router.push({ pathname: '/shop/open', params: { boxIds: boxId, boxKey } });
  }

  const rows: Row[] = duel
    ? [
        { k: 'Type', v: 'Head-to-head' },
        { k: 'The race', v: metricLabel(c.race_metric) },
        { k: 'Duration', v: durationValue(c, outcome?.verdict) },
        // Past tense once it is decided. "Winner takes +200 XP" over a finished race reads as an
        // offer that is still open.
        { k: settled ? 'Winner took' : 'Winner takes', v: `+${c.payout_xp} XP`, highlight: true },
        // The tiebreak is the spec's resolution rule, stated here because it is precisely the
        // sort of thing nobody thinks about until it decides their challenge.
        { k: "If it's a tie", v: 'First to reach it' },
        { k: 'Campfire watching', v: c.circle_id ? 'On' : 'Off' },
      ]
    : placement
      ? [
          { k: 'Type', v: 'Placement race' },
          { k: 'The race', v: metricLabel(c.race_metric) },
          { k: 'Duration', v: durationValue(c) },
          { k: settled ? 'Everyone took' : 'Everyone takes', v: `up to +${c.payout_xp} XP by band`, highlight: true },
          // The whole campfire is the field — nobody was invited and nobody had to answer, so the
          // collective row's "N yet to answer" would always read zero and imply a step that
          // doesn't exist here.
          { k: 'Racing', v: `${c.accepted_count} in` },
          { k: 'Tiebreak', v: 'Same figure, same rank' },
          { k: 'Campfire', v: c.circle_name ?? '—' },
        ]
      : [
          { k: 'Type', v: 'Collective goal' },
          { k: 'The goal', v: `Everyone locks in ${c.target_count ?? 1}×` },
          { k: 'Duration', v: durationValue(c) },
          { k: settled ? 'Everyone took' : 'Everyone takes', v: `up to +${c.payout_xp} XP`, highlight: true },
          // The racers, not the campfire — since 0096 this is an invited subset, and the count on
          // the card is the one settlement uses (0112).
          { k: 'Racing', v: `${c.accepted_count} in${c.invited_count > 0 ? ` · ${c.invited_count} yet to answer` : ''}` },
          { k: 'Campfire', v: c.circle_name ?? '—' },
        ];

  return (
    <>
      {/* 🔴 The header was rendering the literal route string `challenge-info/[challengeId]`. The
          root layout now registers this screen so it can never fall back to its own path again;
          this names it with the actual challenge, which is what a title is for. Set here rather
          than in the layout because only this screen knows the name — the layout has the id and
          nothing else. */}
      <Stack.Screen options={{ title: challengeTitle(c) }} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.publicName} numberOfLines={2}>
          {challengeTitle(c)}
        </Text>

        {duel ? (
          <View style={styles.arena}>
            <View style={styles.competitor}>
              <Avatar label="You" size={44} lit />
              <Text style={styles.competitorName}>You</Text>
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={styles.competitor}>
              <Avatar label={otherName} size={44} />
              <Text style={styles.competitorName} numberOfLines={1}>
                {otherName}
              </Text>
            </View>
          </View>
        ) : placement ? (
          // A ranked board's hero is the SIZE OF THE FIELD, not a completion count — "1 of 48" is
          // the thing a placement race asks you to care about, and there is no denominator of
          // "done" to draw because nothing has to be finished.
          <View style={styles.houseHero}>
            <View style={styles.houseIcon}>
              <Ionicons name="trophy" size={26} color={Colors.amber} />
            </View>
            <Text style={styles.houseCount}>
              <Text style={styles.houseCountBig}>{c.member_count ?? c.accepted_count}</Text>
              <Text style={styles.houseCountMuted}> racing</Text>
            </Text>
            <Text style={styles.competitorName} numberOfLines={1}>
              {c.circle_name ?? 'the campfire'}
            </Text>
          </View>
        ) : (
          // A collective goal is a house passing together, so the hero is the house — a count and
          // the campfire's name, not two faces with a VS between them.
          <View style={styles.houseHero}>
            <View style={styles.houseIcon}>
              <Ionicons name="people" size={26} color={Colors.amber} />
            </View>
            <Text style={styles.houseCount}>
              <Text style={styles.houseCountBig}>{c.completed_count ?? 0}</Text>
              <Text style={styles.houseCountMuted}> / {c.member_count ?? c.accepted_count} done</Text>
            </Text>
            <Text style={styles.competitorName} numberOfLines={1}>
              {c.circle_name ?? 'the campfire'}
            </Text>
          </View>
        )}

        <Rules rows={rows} />

        <View style={styles.note}>
          {duel ? (
            <Text style={styles.noteText}>
              <Text style={styles.noteStrong}>Winner +{c.payout_xp} XP</Text> — scales with effort, capped to keep
              it fair. The loser gets a rematch, not a penalty. Whoever has the most{' '}
              {metricNoun(c.race_metric)} when the clock hits zero takes it.
            </Text>
          ) : placement ? (
            <Text style={styles.noteText}>
              <Text style={styles.noteStrong}>Everyone places.</Text> The whole campfire is entered and the
              board is ranked on {metricNoun(c.race_metric)} when the clock hits zero. There is nothing to
              pass or fail — your reward scales with the band you finish in, and a bigger field pays more
              for the same band. Race nothing and you still get a rank, just no payout.
            </Text>
          ) : (
            <Text style={styles.noteText}>
              <Text style={styles.noteStrong}>All or nothing.</Text> Nobody is paid unless every racer hits{' '}
              {c.target_count ?? 1} qualifying lock-ins before the clock runs out — and once they do, each
              share scales with where you placed. Only the people who accepted are in it.
            </Text>
          )}
        </View>

        {settled ? (
          <Results
            challengeId={c.id}
            myUserId={session?.user.id}
            onShare={result ? handleShare : null}
            sharing={sharing}
            placement={placement}
            raceMetric={c.race_metric}
          />
        ) : null}

        {/* Watchable while it runs AND once it is over: 0112 opened the settled band on the group
            watch RPC, which is what made a finished campfire race a dead end where a finished duel
            was not. */}
        {c.status === 'active' || settled ? (
          <View style={styles.actions}>
            <PrimaryButton
              label={settled ? 'See the race' : 'Watch live'}
              onPress={() =>
                router.push({ pathname: '/watch/[challengeId]', params: { challengeId: c.id, mode: c.mode } })
              }
            />
          </View>
        ) : null}
      </ScrollView>

      {/* FIRE-ONCE, ON THE FIRST SETTLED VIEW. A modal rather than a route so there is exactly one
          entry point: the challenge_won / challenge_lost / campfire_settled deep-links all land on
          this screen, and a second route would need the same seen-flag logic written twice. On
          dismiss the flag is stamped and this falls through to the standings underneath. */}
      {owed && result && hasRevealFloor ? (
        <Modal visible animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
          <ScreenBackground>
            <SafeAreaView style={styles.revealSafe}>
              <ChallengeRewardScreen
                result={result}
                displayName={profile?.display_name ?? 'you'}
                // The same kind this screen already took the floor with, so the rays are tinted by
                // the row that ordered the queue rather than by a second guess at the shape.
                revealKind={challengeRevealKind(c)}
                // §F.1 — the king's two faces, the same pair the share card below already uses.
                winnerAvatarUrl={profile?.avatar_url ?? null}
                opponentAvatarUrl={opponentAvatarUrl}
                onShare={handleShare}
                sharing={sharing}
                onClose={dismiss}
                onOpenBox={result.box?.id ? () => handleOpenBox(result.box!.id!, result.box!.key) : undefined}
              />
            </SafeAreaView>
          </ScreenBackground>
        </Modal>
      ) : null}

      {/* Off-screen, so captureRef has a laid-out card to photograph without it ever being visible.
          Mounted for the whole settled screen because BOTH share entry points (the reveal's CTA and
          the standings row below it) capture this one ref. */}
      {result ? (
        <View style={styles.offscreenCard} pointerEvents="none">
          <ChallengeWinShareCard
            ref={cardRef}
            tier={result.tier}
            // The same branch the watcher makes, from the same field — this screen is the other
            // door onto the identical reveal, and the two have to produce the same card.
            context={result.context === 'duel' ? 'duel' : 'board'}
            contextLine={shareContextLine(c, result.opponentName ?? null)}
            metricLabel={metricLabel(c.race_metric)}
            placement={result.placement}
            fieldSize={result.fieldSize}
            winnerName={profile?.display_name ?? 'You'}
            winnerAvatarUrl={profile?.avatar_url ?? null}
            opponentName={result.opponentName ?? null}
            opponentAvatarUrl={opponentAvatarUrl}
            boxKey={result.box?.key ?? null}
            handle={profile?.handle ?? null}
            rankTier={shareRank.tier}
            division={shareRank.division}
          />
        </View>
      ) : null}
    </>
  );
}

/**
 * The card's one line of context — "You beat Dee", "Push Week · Gym squad".
 *
 * Deliberately not the placement: TIER_MEDAL already prints that in 40px above it, and repeating
 * "2nd" underneath reads like a bug. This is the WHAT, the medal is the HOW WELL.
 */
function shareContextLine(c: SocialChallenge, opponentName: string | null): string {
  if (opponentName) return `You beat ${opponentName}`;
  return [challengeTitle(c), isDuel(c) ? null : c.circle_name].filter(Boolean).join(' · ');
}

function GoalInfo({ challengeId }: { challengeId: string }) {
  const { challenges, loading } = useMyChallenges();
  const g = challenges.find((x) => x.id === challengeId);

  // Same first-frame miss as SocialInfo above — the list is empty until the fetch lands, and
  // "isn't available any more" is a lie about a goal that is sitting on the tab behind you.
  if (!g) return loading ? <ActivityIndicator color={Colors.amber} style={styles.resultsLoading} /> : <Missing what="goal" />;

  const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
  const isAuto = g.count_mode !== 'manual';

  // §4a — the metric decides the unit for a built-in goal; a custom one keeps the owner's word and
  // falls back to its own name. Same helper the card reads, so the two cannot disagree.
  const unit = canonicalGoalUnit(g.type, g.unit, g.label);
  const oneTime = g.period === 'once';

  const rows: Row[] = [
    { k: 'Type', v: oneTime ? 'Personal goal · one-time' : 'Personal goal' },
    { k: 'Target', v: `${g.target.toLocaleString('en-US')} ${unit}` },
    { k: 'Source', v: isAuto ? 'Tracked automatically' : 'Logged by hand' },
    // Plain "midnight" is now true — migration 0084 rolls each user at their OWN midnight rather
    // than a single 00:10 UTC sweep. Weekly is still the shared UTC boundary. §5 — a one-time goal
    // is not rolled by either arm of that sweep, so it has no reset to name.
    {
      k: 'Resets',
      v: oneTime ? 'Never — finish it once' : g.period === 'day' ? 'Every night at midnight' : 'Every Sunday (UTC)',
    },
    { k: 'Reward', v: 'Embers on completion', highlight: true },
    // A streak needs consecutive windows to be a streak, and a one-time goal has exactly one.
    ...(oneTime ? [] : [{ k: 'Goal streak', v: 'Milestones at 3 · 7 · 14 · 30 days' }]),
  ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      {/* Same reason as the social variant: this route reaches the header with nothing but an id,
          so the name has to be set from whichever body knows it. */}
      <Stack.Screen options={{ title: g.label ?? 'Goal' }} />
      <View style={styles.goalHero}>
        <View style={styles.goalIcon}>
          <DisciplineIcon name={CHALLENGE_TYPE_GLYPH[g.type]} size={30} color={Colors.amber} />
        </View>
        <Text style={styles.goalTitle}>
          {g.label ?? `${g.target.toLocaleString('en-US')} ${unit}`}
        </Text>
        <Text style={styles.goalProgress}>
          {g.progress.toLocaleString('en-US')} / {g.target.toLocaleString('en-US')}{' '}
          {g.period === 'day' ? 'today' : oneTime ? 'total' : 'this week'} · {pct}%
        </Text>
      </View>

      <Rules rows={rows} />

      <View style={styles.note}>
        {oneTime ? (
          <Text style={styles.noteText}>
            <Text style={styles.noteStrong}>One target, no reset.</Text> This counter keeps running
            until you hit {g.target.toLocaleString('en-US')} {unit} — midnight and Sunday do nothing
            to it. Clearing it banks an ember drip once, and then it stays done.
          </Text>
        ) : (
          <Text style={styles.noteText}>
            Each day you clear this banks a small ember drip that scales with how ambitious the target
            is. An unbroken run pays a bonus on top at{' '}
            <Text style={styles.noteStrong}>3, 7, 14 and 30 days</Text> — the 30-day milestone also
            drops a box.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

function Rules({ rows }: { rows: Row[] }) {
  return (
    <View style={styles.rules}>
      {rows.map((r, i) => (
        <View key={r.k} style={[styles.rule, i > 0 && styles.ruleDivider]}>
          <Text style={styles.ruleKey}>{r.k}</Text>
          <Text style={[styles.ruleValue, r.highlight && styles.ruleValueWin]} numberOfLines={1}>
            {r.v}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The list this screen reads from is a cache, so a deep link or a stale back-stack entry can land
 * here with nothing to show. Says so plainly rather than rendering an empty rules table. */
function Missing({ what }: { what: string }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>That {what} isn&apos;t available any more.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  body: {
    paddingBottom: Spacing.four,
  },
  // The public name (0096) — the thing the user actually called this race. It was written at
  // creation and rendered nowhere until 0112 started selecting it.
  publicName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    lineHeight: 25,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  houseHero: {
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.four,
  },
  houseIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(242,163,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  houseCount: {
    fontFamily: Fonts.body,
  },
  houseCountBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
  },
  houseCountMuted: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: Colors.muted,
    marginBottom: Spacing.two,
  },
  results: {
    marginTop: Spacing.four,
  },
  resultsLoading: {
    marginTop: Spacing.four,
  },
  resultsError: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.achieverBg,
    marginBottom: 6,
  },
  resultRowMe: {
    borderWidth: 1,
    borderColor: Colors.ember,
  },
  resultPlace: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
    minWidth: 26,
  },
  resultPlaceWin: {
    color: Colors.amber,
  },
  resultWho: {
    flex: 1,
    gap: 1,
  },
  resultName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  resultReward: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.amber,
    marginTop: 1,
  },
  resultBand: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  resultXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.textTertiary,
  },
  resultXpPaid: {
    color: Colors.ember,
  },
  // ─── placement (mock 114) ───
  resultFigures: {
    alignItems: 'flex-end',
    gap: 1,
  },
  resultValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  resultXpUnder: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.ember,
  },
  podium: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  podiumCol: {
    flex: 1,
    maxWidth: 96,
    alignItems: 'center',
    gap: 3,
  },
  podiumName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.ink,
    maxWidth: '100%',
  },
  podiumValue: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  podiumStep: {
    width: '100%',
    height: 26,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: Colors.trackAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  // First place stands taller and lit — the ladder is the whole reason a podium beats three rows.
  podiumStepFirst: {
    height: 40,
    backgroundColor: Colors.amber,
  },
  podiumPlace: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.twilight900,
  },
  resultShare: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.two,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  resultShareText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  // Inside a <Modal>, which renders outside this screen's SafeAreaView, so the OS inset is the
  // reveal's own problem.
  revealSafe: {
    flex: 1,
  },
  // Laid out but never visible — captureRef needs real dimensions to photograph.
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
  arena: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  competitor: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 110,
  },
  competitorName: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  vs: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  goalHero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.four,
  },
  goalIcon: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: 'rgba(242,163,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
  },
  goalProgress: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  rules: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    overflow: 'hidden',
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  ruleDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  ruleKey: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  ruleValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  ruleValueWin: {
    color: Colors.ember,
  },
  // Mock 102's `.note` — the one place on the screen that explains rather than lists.
  note: {
    backgroundColor: '#231A2E',
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: Spacing.three,
  },
  noteText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  noteStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
  actions: {
    marginTop: Spacing.four,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
