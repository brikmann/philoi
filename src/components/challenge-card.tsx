import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { TextInput } from '@/components/ui/text-input';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { GoalEditSheet } from '@/components/goal-edit-sheet';
import { GoalGradeSheet } from '@/components/goal-grade-sheet';
import { GoalManageSheet } from '@/components/goal-manage-sheet';
import { useVouchedReward, VouchUnlockLine } from '@/components/vouch-unlock-line';
import {
  deleteGoal,
  hideGoal,
  logChallengeProgress,
  previewScopedReward,
  type GoalDayAward,
} from '@/lib/api/challenges';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { RARITIES } from '@/lib/economy/rarity';
import { CHALLENGE_TYPE_GLYPH, canonicalGoalUnit, personalGoalTitle } from '@/lib/goal-types';
import { getErrorMessage } from '@/lib/errors';
import { AUTO_SOURCE_NAME, getRealFitnessSourceForChallengeType, sourceNeedsConnection } from '@/lib/fitness-sync';
import type { Challenge, ChallengeType, DifficultyTier, GradeDiscipline, ScopedRewardPreview } from '@/types/database';

/**
 * "90%+ → EPIC · pass → RARE · under 50% → nothing" — the grade ladder spelled out, from the goal's
 * own numbers. The old "STEM · any pass pays at least RARE" left the reader to work out whether the
 * floor and the badge were the same thing.
 *
 * Mirrors grade_band / grade_goal_tier (0210): the floor is rare for stem and uncommon for arts, and
 * a pass under the target steps down from the scoped tier, never below the floor. The ladder is
 * display only — report_goal_grade prices the real mark.
 */
function gradeLadderLine(tier: DifficultyTier, discipline: GradeDiscipline, target: number, passMark?: number | null) {
  const floor: DifficultyTier = discipline === 'stem' ? 'rare' : 'uncommon';
  const passLine = Math.min(passMark ?? 50, target);
  const steps = RARITIES.indexOf(tier) - RARITIES.indexOf(floor);
  const miss = `under ${passLine}% → nothing`;
  // Target at the pass line, or a goal scoped at the floor: every pass pays the same tier.
  if (steps <= 0 || passLine >= target) return `${passLine}%+ → ${tier.toUpperCase()} · ${miss}`;
  // One step above the floor, any pass short of the target lands exactly on it; further up there
  // are tiers in between, so the floor is where it bottoms out rather than what every pass pays.
  const pass = steps === 1 ? `pass → ${floor.toUpperCase()}` : `lower pass → down to ${floor.toUpperCase()}`;
  return `${target}%+ → ${tier.toUpperCase()} · ${pass} · ${miss}`;
}

// Quick-add amounts only. The glyph moved to CHALLENGE_TYPE_GLYPH in lib/goal-types — these were
// emoji, which draw differently on every OS and font version and cannot take the row's tint (§A3).
const TYPE_QUICK_ADDS: Record<ChallengeType, number[]> = {
  steps: [1000, 2500, 5000],
  run_distance: [1, 5, 10],
  ride_distance: [5, 10, 20],
  gym_visits: [1],
  study_hours: [1, 2],
  custom: [1],
  workout_minutes: [15, 30, 60],
  strain: [1, 2],
  sleep_hours: [1],
};

/**
 * The quiet closing line — when this goal's counter goes back to zero.
 *
 * This promise is finally real: until migration 0072 nothing ever reset a challenge, and the card
 * said "Resets Monday" over a counter that ran forever (task #89).
 *
 * DAILY now says plain "midnight" because migration 0084 made it true: roll_over_challenges()
 * reads each user's own timezone off their profile, and the job runs every 15 minutes so it
 * catches each zone's midnight as it passes. Before that it was a single 00:10 UTC sweep, so
 * "midnight UTC" was accurate but wrong behaviour — a user in UTC+13 lost their day at 11am.
 *
 * WEEKLY still says UTC, and still means it. week_start() is the shared boundary leaderboards,
 * streak decay and the pass period all key off; per-user weeks would make "this week" mean
 * different windows in different parts of the app, so it stays global — and a Saturday-evening
 * user in the Americas is genuinely hours from a reset the word "Sunday" alone would put a day
 * away.
 */
function resetLabel(period: Challenge['period']): string {
  // §5 — a ONE-TIME goal has no reset to promise, and the honest line is the one that says so.
  // Printing "Resets Sunday (UTC)" here (which is what the old `else` did for any non-daily value)
  // would tell somebody their half-marathon target was about to go back to zero.
  if (period === 'once') return 'One-time · never resets';
  return period === 'day' ? 'Resets at midnight' : 'Resets Sunday (UTC)';
}

/** The chip in the card's top-right. Same three-way split, in the shortest words that fit. */
function cadenceLabel(period: Challenge['period']): string {
  return period === 'day' ? 'Daily' : period === 'once' ? 'One-time' : 'Weekly';
}

type ChallengeCardProps = {
  challenge: Challenge;
  /** True when the device source that COULD track this goal is actually connected — the card
   * only claims "Auto" when something is genuinely feeding it. */
  autoConnected?: boolean;
  /** Carries the SERVER's payout up with the completion so the tab can show mock 103's reward
   * screen. Null when nothing was granted (already awarded today, or the RPC failed) — the caller
   * shows the plain burst in that case rather than an empty reward screen. */
  /**
   * `difficultyTier` is the scope Cindy priced this feat at (0159/0160), or null for an ordinary
   * recurring target. Appended rather than folded into an object so every existing caller keeps
   * working — it exists so the share card can tell a one-off FEAT from a habit, which are opposite
   * flexes (see goal-streak-share-card).
   */
  onLogged: (
    justCompleted: boolean,
    award: GoalDayAward | null,
    goalLabel: string,
    difficultyTier: DifficultyTier | null
  ) => void;
  /**
   * "Something about this goal moved — reload the list."
   *
   * ⚠️ RENAMED FROM `onDeleted`, and the rename is load-bearing rather than cosmetic. It used to be
   * the card's way of asking the LIST to perform the delete, so the tab's handler was
   * `deleteChallenge(id); refetch()`. Three callers now report through this — a delete, an edit and
   * a reported grade — and under the old name and the old handler two of them would have DELETED
   * the goal they had just changed. The delete itself moved into the card (through the guarded
   * `delete_goal` RPC), so what is left for the list to do is exactly one thing: refetch.
   */
  onChanged: () => void;
  /** Opens the Goal info screen (mock 102 v2), where the target, source, reset and reward rules
   * live now that the card itself stays minimal. */
  onInfo?: () => void;
};

// An individual goal (design-mocks/73B). The old card stacked 🔗 / ✅ / 🏆 into the corner and
// made you decode three glyphs; this reads straight left→right — icon, name, cadence — then one
// sub-line saying only how it's tracked, one bar, and ONE status. No campfire binding anywhere:
// a goal is the user's own (migration 0059), and sharing the work is a per-lock-in choice.
export function ChallengeCard({ challenge, autoConnected = false, onLogged, onChanged, onInfo }: ChallengeCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState('');
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §D — three sheets, one kebab. They are separate components rather than modes of one because
  // they answer three different questions, and a single sheet with a `mode` prop would carry all
  // three sets of state whichever one was open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [gradeOpen, setGradeOpen] = useState(false);
  // 🔴 §C — WHAT THEY ARE CHASING, ON THE CARD, FROM CREATION ONWARD. The scoped reward used to
  // exist only on the verdict screen, which is shown once and never again — so a user who set a
  // goal on Tuesday had no way to see what it was worth on Wednesday. Server's figure, same as
  // everywhere: a local tier→crate table would be a second source of truth.
  const [reward, setReward] = useState<ScopedRewardPreview | null>(null);

  // ⚠️ `TYPE_QUICK_ADDS[challenge.type]` with no fallback is why a grade goal is `type = 'custom'`
  // rather than a ninth ChallengeType — see migration 0183's header. Defended here as well, because
  // a map lookup that can return undefined and is then `.map`ped is one economy_config change away
  // from being a crash on the Challenges tab whatever this file believes about the union.
  const quickAdds = TYPE_QUICK_ADDS[challenge.type] ?? [];
  const isComplete = challenge.completed_at !== null;
  // A grade goal that came in under the bar. Settled, and NOT complete — the card has to say so
  // rather than showing an 84/85 progress bar that reads as "nearly there" on a finished goal.
  const isMissed = challenge.missed_at != null;
  const isGrade = challenge.grade_target != null;
  const pct = Math.min(100, Math.round((challenge.progress / challenge.target) * 100));

  const tier = challenge.difficulty_tier ?? null;
  const claimLevel = challenge.verifiability ?? 'honor';
  useEffect(() => {
    // Only a SCOPED goal has a price to show. An unscoped legacy row pays what it always paid, and
    // inventing a crate for it on the card would promise something settlement will not deliver.
    if (!tier) return;
    let alive = true;
    previewScopedReward(tier, claimLevel).then((r) => {
      if (alive) setReward(r);
    });
    return () => {
      alive = false;
    };
  }, [tier, claimLevel]);
  // What two vouches would lift it to — fetched only while the price above is honour-capped.
  const vouchedReward = useVouchedReward(tier, reward);

  // 🐛 0198 — "Auto" is the owner's SAVED choice, not a guess. This line used to be rebuilt from the
  // phone's live connection flag on every render, so a goal set to "Automatically" read "Logged by
  // hand" whenever that flag happened to be false — which looked exactly like the choice had been
  // lost. `!== false` so a row from a server older than 0198 (no flag) reads as it always did.
  const realSource = getRealFitnessSourceForChallengeType(challenge.type);
  const chosenAuto = challenge.auto_track !== false && realSource !== null;
  // Lock-in-sourced metrics (study, gym) need no connection at all — the app already has the
  // check-ins — so a chosen-auto one is live from creation. A device/Strava/Whoop one needs its
  // grant; when that has dropped, the card says so rather than pretending the choice was manual.
  const needsReconnect = chosenAuto && sourceNeedsConnection(realSource) && !autoConnected;
  // Auto AND actually filling itself. The quick-add controls hide only for this — a chosen-auto goal
  // whose connection dropped keeps them, so it can still be logged by hand until it's reconnected.
  const isAuto = chosenAuto && !needsReconnect;
  // A described feat is not "logged by hand" — there is no number to log. Mock 176 frame 0 says
  // what it actually is, so the card explains the missing progress bar rather than looking broken.
  const sourceLine = chosenAuto
    ? needsReconnect
      ? `⚡ Auto · ${AUTO_SOURCE_NAME[realSource]} (reconnect)`
      : `⚡ Auto · ${AUTO_SOURCE_NAME[realSource]}`
    : isGrade
      ? // A mark is reported once, not filled — so this names the button that settles it, and is
        // allowed a second line rather than truncating to "tap when y…".
        "🏅 No auto-track — tap 'Report your grade' when you have your mark"
      : challenge.difficulty_tier != null && challenge.verifiability !== 'auto'
      ? "🏅 No auto-track — tap when you've done it"
      : '✏️ Logged by hand';

  async function handleLog(value: number) {
    if (value <= 0) return;
    setLogging(true);
    setError(null);
    try {
      const result = await logChallengeProgress(challenge.id, value);
      setAmount('');
      setExpanded(false);
      // ONE PAYOUT, ONE REVEAL (0167). A 'once' goal that finishes here pays TWICE, through two
      // different doors: economy_award_goal_day banks the drip (this `award`), and
      // economy_on_challenge_completed mints the scoped crate. The second one now has its own
      // watcher, which draws the crate, the embers AND names the goal — so handing the drip screen
      // over as well would open two full-screen celebrations back to back for one tap.
      //
      // The drip screen is the one that gives way, because it is the smaller half and it has
      // nothing to say a one-time goal cares about: its hero is the streak meter, and a target that
      // never resets has no streak. A recurring daily/weekly goal is unaffected — that reveal is
      // still entirely GoalRevealWatcher's, and get_unseen_goal_rewards deliberately excludes it.
      // The server names the period from 0200 on; the goal row covers an older server.
      const drip =
        challenge.period === 'once' || !result.award
          ? null
          : { ...result.award, period: result.award.period ?? challenge.period };
      onLogged(result.justCompleted, drip, personalGoalTitle(challenge), challenge.difficulty_tier ?? null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not log progress.'));
    } finally {
      setLogging(false);
    }
  }

  /**
   * §D — "Delete this goal? This can't be undone", then the DELETE, then the list refresh.
   *
   * Routed through `delete_goal` (0183) rather than the raw table delete the long-press used to
   * call. The difference matters exactly once and badly: a settled goal's `reward_payload` is the
   * receipt for embers the ledger already moved, and destroying it leaves a payout with no source.
   * The RPC refuses that case with a sentence, which is what the catch below shows — the kebab
   * already offers Hide instead, so this is the belt to that braces.
   */
  function handleDelete() {
    Alert.alert('Delete this goal?', "This can't be undone — you'll lose your logged progress.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGoal(challenge.id);
            onChanged();
          } catch (e) {
            Alert.alert('Not deleted', getErrorMessage(e, 'Could not delete that goal.'));
          }
        },
      },
    ]);
  }

  /** The offer a settled goal gets instead of Delete — it keeps the reward receipt and takes the
   *  row out of History. Reversible server-side, which is why it does not ask for confirmation. */
  async function handleHide() {
    try {
      await hideGoal(challenge.id);
      onChanged();
    } catch (e) {
      Alert.alert('Not hidden', getErrorMessage(e, 'Could not hide that goal.'));
    }
  }

  /**
   * 🔴 §4c — "you can't delete a challenge." The history of this menu, in two acts.
   *
   * ACT ONE: everything behind delete already worked, and the only way to reach it was a LONG-PRESS
   * on the card header with nothing on screen saying so. An affordance nobody can see is the same
   * as no affordance, which is exactly how a user concludes the feature is missing. So a visible ⋯
   * was added beside the cadence chip, matching the one every social challenge card already carries
   * (ManageKebab in social-challenge-card.tsx). The long-press is KEPT — it costs nothing and it is
   * the gesture anyone who found it once will reach for again.
   *
   * ACT TWO (§D, and the reason the ⋯ still read as broken): it opened an `Alert.alert` with FOUR
   * buttons, and Android's dialog has three slots. See handleMenu below for the exact line in
   * react-native that truncates them. The menu is a Modal now, and this paragraph used to end
   * "an Alert rather than a bottom sheet … the one presentation that cannot be dismissed by
   * accident" — which was true of the presentation and wrong about the platform.
   */
  /**
   * 0164 — "Mark complete" is the honour path's ONLY entry point, so which goals get it matters.
   *
   * Offered when the goal carries a scoped tier, is not auto-tracked, and has not already been
   * claimed or finished. That set is exactly the described feat — "learn a backflip" — which
   * nothing can auto-complete: an auto goal finishes itself through log_challenge_progress when
   * its number lands, and offering a manual claim there would be a second way to complete a goal
   * that already completes on its own.
   */
  //
  // 🔴 A GRADE GOAL IS EXCLUDED even though it is also honour-scored. It has a REAL number to
  // report, and report_goal_grade is how it settles; offering "Mark complete" beside "Report your
  // grade" would be two ways to finish one goal that can disagree about whether it was met — and
  // the claim path would settle it as a PASS without ever asking what the mark was.
  const canClaim =
    !isGrade &&
    challenge.difficulty_tier != null &&
    challenge.verifiability !== 'auto' &&
    !challenge.completed_at &&
    !challenge.missed_at &&
    !challenge.claimed_at;

  /**
   * Claimed, and waiting on friends. Mock 176 frame C is a real destination from the card, because
   * a window nobody can reopen is a window nobody can check — and "did Maya ever answer" is the
   * only question anyone has during those 48 hours.
   */
  const isPendingVouch = challenge.claimed_at != null && !challenge.completed_at;

  /**
   * 🛑 §D — THE DEAD TAPS, AND WHERE THEY CAME FROM.
   *
   * This was `Alert.alert(title, undefined, [...])` with up to FOUR buttons. react-native's
   * Alert.js line 100 does `buttons.slice(0, 3)` on Android — the platform dialog has exactly three
   * slots — and then pop()s the survivors into neutral/negative/positive from the END. So on a
   * scoped goal (Mark complete · Goal info · Delete goal · Cancel) Android silently dropped Cancel
   * and re-seated the rest into slots the code never intended. A menu with no way out, whose items
   * do not sit where they are written, is what "generic UI errors / dead-taps" looks like from the
   * user's side.
   *
   * Trimming the list would not have fixed it, because §D ADDS Edit — five rows on a live grade
   * goal. A Modal has no slots, so the ceiling is gone rather than lowered, and GoalManageSheet can
   * render a row DISABLED WITH ITS REASON instead of hiding it or letting it fail at the RPC.
   */
  function handleMenu() {
    setMenuOpen(true);
  }

  /** The sheet's rows, and the one place each of them is decided. Kept next to handleMenu so a
   *  reader can see the whole menu in one screenful rather than chasing five callbacks. */
  const manageSheet = (
    <GoalManageSheet
      visible={menuOpen}
      goal={challenge}
      onClose={() => setMenuOpen(false)}
      onReportGrade={() => setGradeOpen(true)}
      onClaim={() =>
        router.push({
          pathname: '/goal/claim',
          params: {
            goalId: challenge.id,
            label: challenge.label ?? '',
            tier: challenge.difficulty_tier ?? '',
          },
        })
      }
      onEdit={() => setEditOpen(true)}
      // §D — "Goal info … never a dead tap." It used to be conditional on an `onInfo` prop the
      // History list never passed, so on a finished goal the row simply was not there. The route
      // needs nothing but the id, so it is built here and the prop is only an override.
      onInfo={() =>
        onInfo
          ? onInfo()
          : router.push({
              pathname: '/challenge-info/[challengeId]',
              params: { challengeId: challenge.id, kind: 'goal' },
            })
      }
      onDelete={handleDelete}
      onHide={handleHide}
    />
  );

  return (
    <Card style={styles.card}>
      <Pressable onPress={onInfo} onLongPress={handleDelete} style={styles.header}>
        <View style={styles.iconTile}>
          <DisciplineIcon name={CHALLENGE_TYPE_GLYPH[challenge.type]} size={18} color={Colors.ember} />
        </View>
        <View style={styles.titleColumn}>
          <Text style={styles.title} numberOfLines={1}>
            {personalGoalTitle(challenge)}
          </Text>
          <Text style={styles.source} numberOfLines={isGrade ? 2 : 1}>
            {sourceLine}
          </Text>
        </View>
        <View style={styles.cadenceChip}>
          <Text style={styles.cadenceChipText}>{cadenceLabel(challenge.period)}</Text>
        </View>
        {/* §4c — the visible way out. Sits INSIDE the header Pressable but takes its own onPress,
            so a tap here opens the menu instead of falling through to Goal info. */}
        <Pressable
          onPress={handleMenu}
          hitSlop={10}
          style={styles.kebab}
          accessibilityRole="button"
          accessibilityLabel={`Manage ${personalGoalTitle(challenge)}`}>
          <Ionicons name="ellipsis-horizontal" size={16} color={Colors.muted} />
        </Pressable>
      </Pressable>

      {/* A grade is reported once, not accumulated — a fill bar and "0 / 90 %" read as something
          you work up to. The Report button and the ladder line below carry a live grade goal. */}
      {!isGrade && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }, isComplete && styles.progressFillDone]} />
        </View>
      )}

      {/* Numbers on the left, ONE status on the right — a percentage while it's live, the green
          "Smashed" once the target's beaten. Never both, and never a third badge elsewhere. */}
      {/* Kept on a SETTLED grade goal: by then the number is the mark they reported, and "Smashed"
          is the verdict. A missed one says so in its own row instead. */}
      {(!isGrade || isComplete) && (
      <View style={styles.statusRow}>
        {/* 🔴 §4a — "Cold plunges · 0 / 1 bath". `unit` is a free text column and Cindy's
            create_challenge tool lets the model fill it with whatever noun it likes, so a goal
            could be counted in a word that has nothing to do with what it measures. For a built-in
            metric the unit is decided by the METRIC (steps count steps), and for a custom goal it
            falls back to the goal's own name rather than rendering a bare "0 / 1". Rows written
            before the write path was fixed are corrected on read by the same helper. */}
        <Text style={styles.progressLabel}>
          {challenge.progress.toLocaleString()} / {challenge.target.toLocaleString()}{' '}
          {canonicalGoalUnit(challenge.type, challenge.unit, challenge.label)}
        </Text>
        {isComplete ? (
          <View style={styles.smashed}>
            <Text style={styles.smashedText}>Smashed</Text>
            <Ionicons name="checkmark" size={12} color={Colors.green} />
          </View>
        ) : (
          <Text style={styles.pct}>{pct}%</Text>
        )}
      </View>
      )}

      <Text style={styles.reset}>
        {resetLabel(challenge.period)}
        {isComplete ? ' · +XP banked' : ''}
      </Text>

      {/* 🔴 §C — "the challenge card shows the target reward from creation onward, so it's visible
          the whole time, not just at the end." This is the line that was missing entirely: the
          scoping engine priced every scoped goal and the only place that price was ever rendered
          was the verdict screen, which a user sees once. Server's figure via
          preview_challenge_reward — never a local table, or the first economy retune has the card
          promise one crate and the reveal deliver another. */}
      {tier && reward ? (
        <View style={[styles.rewardRow, { borderColor: TIER_COLOR[tier] }]}>
          <Ionicons name="cube-outline" size={13} color={TIER_COLOR[tier]} />
          <Text style={styles.rewardText} numberOfLines={1}>
            <Text style={[styles.rewardTier, { color: TIER_COLOR[tier] }]}>{tier.toUpperCase()}</Text>
            {/* 0209 — "effort" when the payout is capped, because the tier is what Cindy judged and
                the crate is what an unvouched claim pays, and printing them side by side with no
                word between read as a pricing bug ("LEGENDARY · The Furnace"). */}
            {!isComplete && !isMissed && reward.discounted ? ' effort · ' : ' · '}
            {/* Past tense once it is settled: "Reward" over a finished goal reads as something
                still owed. */}
            {isComplete ? 'Paid ' : isMissed ? 'Was worth ' : reward.discounted ? 'earns ' : 'Reward: '}
            {asBoxKey(reward.box) ? BOXES[asBoxKey(reward.box)!].name : 'Embers only'}
            {` · ${reward.embers.toLocaleString()} embers`}
          </Text>
        </View>
      ) : null}
      {/* ...and the way out of the cap, while there still is one. Nothing once settled: a goal paid
          at honour cannot be vouched after the fact (one grant, 0164). */}
      {!isComplete && !isMissed ? (
        <VouchUnlockLine capped={reward} vouched={vouchedReward} lead="2 friends vouch → upgrades to" style={styles.unlockLine} />
      ) : null}
      {/* 0210 — the ladder, in one line: a live grade goal says a near-miss still pays, and a settled
          one that earned less than it aimed for says what it aimed for. */}
      {isGrade && !isComplete && !isMissed && !isPendingVouch && challenge.grade_discipline && tier ? (
        <Text style={styles.ladderLine}>
          {gradeLadderLine(
            tier,
            challenge.grade_discipline,
            challenge.grade_target ?? challenge.target,
            challenge.pass_mark
          )}
        </Text>
      ) : null}
      {isGrade && isComplete && challenge.scoped_tier && challenge.scoped_tier !== challenge.difficulty_tier ? (
        <Text style={styles.ladderLine}>
          Aimed for {challenge.scoped_tier.toUpperCase()} · you reported {challenge.progress.toLocaleString()}%
        </Text>
      ) : null}

      {/* ── §C · the grade goal's whole lifecycle, in one row ──
          Live: the door to reporting the mark, which is the ONLY way this goal can settle.
          Settled: the verdict, said plainly — including the miss, because a goal that quietly
          stopped mattering teaches the user nothing about whether they hit it. */}
      {/* 0209 — and not once reported: a passing grade that asked friends is claimed, not complete,
          and report_goal_grade refuses a second report. The pending row below takes over. */}
      {isGrade && !isComplete && !isMissed && !isPendingVouch ? (
        <Pressable
          style={styles.claimCta}
          onPress={() => setGradeOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Report your grade for ${personalGoalTitle(challenge)}`}>
          <Ionicons name="school-outline" size={15} color={Colors.onEmber} />
          <Text style={styles.claimCtaLabel}>Report your grade</Text>
        </Pressable>
      ) : null}

      {isMissed ? (
        <View style={styles.missedRow}>
          <Ionicons name="remove-circle-outline" size={14} color={Colors.textTertiary} />
          <Text style={styles.missedLabel}>
            {/* Worded to hold for both rules: before 0210 a miss was "under the target", since it is
                "under the pass line" — so it names the mark and the target and claims neither. */}
            Missed — you reported {challenge.progress.toLocaleString()}% (target{' '}
            {(challenge.grade_target ?? challenge.target).toLocaleString()}%). No reward.
          </Text>
        </View>
      ) : null}

      {/* ── mock 176 frame 0 · the honour path's entry point ──
          A described feat has no number to log and nothing that can finish it, so the card carries
          the tap that opens the prove-or-vouch flow. An auto-tracked goal shows its progress bar
          above and never gets this button: it cannot be self-claimed. */}
      {canClaim && (
        <Pressable
          style={styles.claimCta}
          onPress={() =>
            router.push({
              pathname: '/goal/claim',
              // The label and tier ride along so the claim screen can name the goal and price it
              // without a second round trip — it re-reads nothing the server will not re-derive
              // anyway when it settles.
              params: {
                goalId: challenge.id,
                label: challenge.label ?? '',
                tier: challenge.difficulty_tier ?? '',
              },
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`Mark ${personalGoalTitle(challenge)} complete`}>
          <Ionicons name="checkmark" size={15} color={Colors.onEmber} />
          <Text style={styles.claimCtaLabel}>Mark complete</Text>
        </Pressable>
      )}

      {isPendingVouch && (
        <Pressable
          style={styles.pendingRow}
          onPress={() => router.push({ pathname: '/goal/pending/[goalId]', params: { goalId: challenge.id } })}
          accessibilityRole="button"
          accessibilityLabel={`See who has vouched for ${personalGoalTitle(challenge)}`}>
          <Ionicons name="hourglass-outline" size={14} color={Colors.amber} />
          <Text style={styles.pendingLabel}>Waiting on friends to vouch</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
        </Pressable>
      )}

      {/* Only a hand-logged goal in progress needs controls — an auto-tracked one fills itself,
          and offering quick-adds beside it invites double-counting the same steps.
          🔴 AND NOT A CLAIMABLE FEAT. log_challenge_progress auto-completes a goal the moment
          progress crosses target, so a "+1" on a described feat would complete it behind the
          claim flow's back — settling at the unverified band with the clip and the vouch never
          offered. The card must not present two ways to finish the same goal, and the one that
          silently forfeits a box tier is the wrong one to leave lying around. */}
      {!isComplete && !isMissed && !isGrade && !isAuto && !canClaim && !isPendingVouch && (
        <>
          {expanded ? (
            <View style={styles.logRow}>
              <TextInput
                style={styles.logInput}
                placeholder="Amount"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <Pressable
                style={styles.logButton}
                disabled={logging || !amount.trim()}
                onPress={() => handleLog(Number(amount))}>
                <Text style={styles.logButtonLabel}>{logging ? '…' : 'Log'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.quickRow}>
              {quickAdds.map((qa) => (
                <Pressable
                  key={qa}
                  style={styles.quickPill}
                  disabled={logging}
                  onPress={() => handleLog(qa)}
                  accessibilityLabel={`Log +${qa} ${canonicalGoalUnit(challenge.type, challenge.unit, challenge.label)}`}>
                  <Text style={styles.quickPillLabel}>+{qa.toLocaleString()}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.quickPillGhost} onPress={() => setExpanded(true)}>
                <Text style={styles.quickPillGhostLabel}>Log amount…</Text>
              </Pressable>
            </View>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </>
      )}

      {/* All three mounted inside the Card so they travel with the row they act on — a sheet held
          by the LIST would need the selected goal in list state, which is one more thing that can
          be stale by the time the RPC reads it. */}
      {manageSheet}
      <GoalEditSheet
        visible={editOpen}
        goal={challenge}
        onClose={() => setEditOpen(false)}
        // The list reloads rather than this card patching itself: update_goal can move the target,
        // the tier AND the verifiability at once, and a card that repainted from a partial local
        // copy would show a new target beside the old goal's price.
        onSaved={() => onChanged()}
      />
      <GoalGradeSheet
        visible={gradeOpen}
        goal={challenge}
        onClose={() => setGradeOpen(false)}
        // Same reason, and one more: a PASS has already fired challenges_economy server-side, so the
        // row now carries a reward_payload this card knows nothing about. Refetching is what lets
        // GoalRevealWatcher and this card agree about what just happened.
        onSettled={() => onChanged()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 11,
    borderWidth: 1,
    backgroundColor: 'rgba(20,14,26,0.5)',
  },
  rewardTier: { fontFamily: Fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.7 },
  rewardText: { flex: 1, fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  unlockLine: { paddingHorizontal: 10, marginTop: -2 },
  ladderLine: { paddingHorizontal: 10, fontFamily: Fonts.body, fontSize: 10.5, lineHeight: 15, color: Colors.textTertiary },
  missedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  missedLabel: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary },
  claimCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.ember,
  },
  claimCtaLabel: { fontFamily: Fonts.bodyBold, fontSize: 13.5, color: Colors.onEmber },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    backgroundColor: 'rgba(242,163,60,0.07)',
  },
  pendingLabel: { flex: 1, fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.amber },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  source: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
    marginTop: 2,
  },
  kebab: {
    paddingLeft: Spacing.one,
    paddingVertical: Spacing.half,
  },
  cadenceChip: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  cadenceChipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  progressTrack: {
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.line,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.coral,
  },
  progressFillDone: {
    backgroundColor: Colors.green,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  progressLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  pct: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.muted,
  },
  smashed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  smashedText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.green,
  },
  reset: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  quickPill: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.achieverBg,
  },
  quickPillLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  quickPillGhost: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderWidth: 2,
    borderColor: Colors.line,
  },
  quickPillGhostLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  logRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
  },
  logInput: {
    flex: 1,
  },
  logButton: {
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  logButtonLabel: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.coral,
  },
});
