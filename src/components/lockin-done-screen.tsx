import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { showRewardReveal } from '@/components/economy/reward-reveal';
import { GymClipThumbnail } from '@/components/gym-clip-player';
import { RankBadge } from '@/components/rank-badge';
import { PersonalFlame } from '@/components/personal-flame';
import { PlacementMove } from '@/components/placement-move';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceButton } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';
import { postSessionToAgora, setPostToAgora } from '@/lib/api/agora';
import { fetchLockInPassCredit, type LockInPassCredit } from '@/lib/api/forge-pass';
import { fetchCheckInClips } from '@/lib/api/gym-clips';
import { postCheckInToCircle, setCheckInCaption } from '@/lib/api/lock-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { levelFromXp, SEASON } from '@/lib/economy/forge-pass';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, nextRank, RANK_TIER_METAL, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm, fireXpTick } from '@/lib/reward-feedback';
import type { GoalType, MyRank, WorkoutRecap, WorkoutSet } from '@/types/database';

type LockInDoneScreenProps = {
  goalType: GoalType;
  goalDetail: string | null;
  durationSeconds: number;
  checkInId: string;
  xpEarned: number;
  rankBefore?: MyRank;
  rankAfter?: MyRank;
  streakBefore: number;
  streakAfter: number;
  photos: { id: string; uri: string }[];
  /** The finished gym workout (§23) — persisted set-by-set during the session and rolled up at
   * Finish, so this is purely a recap. Null for every non-gym lock-in. */
  workoutRecap?: WorkoutRecap | null;
  circleId: string | null;
  circleName: string | null;
  onDone: () => void;
  /** Share this lock-in as a story card (design-mocks/96, card 2 — the proof-of-work flex). The
   * capture target lives on the screen that owns the card, so this is just the tap. */
  onShare?: () => void;
  sharing?: boolean;
};

// Mock 92's done-screen hero: a 118px flame inside a 170px glow.
const FLAME_SIZE = 118;
const GLOW_SIZE = 170;

// The "done" screen (design-mocks/81-done-screen.html) — built around the SAME big living flame
// as the work session, stripped to the four things that matter: you locked in, for how long, the
// XP it moved, and one tap to post.
//
// Everything else was pushed off this screen deliberately (punchlist 6 §3): the routine-naming
// block now lives on the gym screen, the caption is folded into the post card as an optional
// note, the campfire multi-select hides behind "change", and a gym recap collapses to one line
// with a "View" that opens the full thing.
//
// Any rank-up at all — a tier crossing or a same-tier division bump — is handled by the caller
// showing RankUpCelebration's full-screen forge instead of this component entirely (see
// lock-in/index.tsx); this screen only ever renders for a stop that didn't move the rank.
export function LockInDoneScreen({
  goalType,
  goalDetail,
  durationSeconds,
  checkInId,
  xpEarned,
  rankBefore,
  rankAfter,
  streakBefore,
  streakAfter,
  photos,
  workoutRecap = null,
  circleId,
  circleName,
  onDone,
  onShare,
  sharing = false,
}: LockInDoneScreenProps) {
  const { groups } = useMyGroups();
  const { profile, refreshProfile } = useAuth();
  // Mock 92 addresses you by name ("Nice work, Noah"). First name only, and the line still reads
  // correctly without one — a profile that hasn't loaded yet just gets "Nice work".
  const firstName = profile?.display_name?.split(' ')[0] ?? '';
  // Seeded with the campfire this session was started in, so the common case is one tap — the
  // multi-select is still there, just behind "change" instead of being a decision every time.
  const [selectedCircleIds, setSelectedCircleIds] = useState<string[]>(circleId ? [circleId] : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  // 0273 · "Post to the Agora" (mock 297). Pre-set from the sticky profile default, which is off
  // until someone turns it on here or in Settings — a session never reaches the square unasked.
  const [postToAgora, setPostToAgoraState] = useState(profile?.post_to_agora ?? false);
  // Every exit calls finishToAgora, and "Post & finish" can be retried after a campfire error —
  // the server dedupes per session too, but one fire per screen keeps the uploads from doubling.
  const agoraFired = useRef(false);
  // Phase-2 video clips (§23) — the rolled-up recap only has per-exercise totals (no individual
  // set ids), so clips need their own fetch, keyed by this same checkInId. Recap modal only.
  const [clips, setClips] = useState<WorkoutSet[]>([]);

  const [displayXp, setDisplayXp] = useState(0);
  const [plusVisible, setPlusVisible] = useState(false);
  // What this session ACTUALLY paid the Emberfall Pass — the ledger row the server's lock-in
  // trigger wrote (0227), never `hours × 250` worked out here. Null until it answers, and stays null
  // when nothing was credited (under 5 min, season not live): no Pass line at all, not a "+0".
  const [passCredit, setPassCredit] = useState<LockInPassCredit | null>(null);
  const passFill = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    fetchLockInPassCredit(checkInId)
      .then((c) => {
        if (!cancelled) setPassCredit(c);
      })
      .catch(() => {
        // The credit is already banked server-side; failing to READ it only hides the line.
      });
    return () => {
      cancelled = true;
    };
  }, [checkInId]);

  // Where the Pass was before this Stop vs. after it. "Before" subtracts the bonus credits too — the
  // same Stop can unlock a daily achievement or a rank-up, and leaving those in would start the bar
  // above where the user actually was.
  const passAfter = passCredit ? levelFromXp(passCredit.pass_xp) : null;
  const passBefore = passCredit ? levelFromXp(passCredit.pass_xp - passCredit.xp - passCredit.bonus_xp) : null;
  // Past L100 the bar is the climb to the next PRESTIGE (0232), so crossing one is a level-up too.
  const passPrestiged = !!passAfter && !!passBefore && passAfter.prestige > passBefore.prestige;
  const passLeveledUp = !!passAfter && !!passBefore && (passAfter.level > passBefore.level || passPrestiged);

  useEffect(() => {
    if (!passAfter || !passBefore) return;
    const ratio = (l: { intoLevel: number; nextLevelCost: number }) => (l.nextLevelCost > 0 ? l.intoLevel / l.nextLevelCost : 1);
    // Crossing a level fills from empty: the bar is the CURRENT level, which you entered at 0.
    passFill.value = passLeveledUp ? 0 : ratio(passBefore);
    passFill.value = withDelay(500, withTiming(ratio(passAfter), { duration: 900 }));
    // A prestige is ~36 hours past a full pass — the biggest thing this screen can report, so it gets
    // the full reveal. Nothing is listed as won: the rewards are a claim on the Flame Pass, and the
    // reveal never congratulates you for something the server has not paid yet.
    if (passPrestiged) {
      showRewardReveal({
        kind: 'pass_prestige',
        title: `Prestige +${passAfter.prestige}`,
        subtitle: `Level ${passAfter.level + passAfter.prestige} on the ${SEASON.name} Pass — your rewards are waiting on the Flame Pass.`,
        rewards: [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate once, when the credit lands
  }, [passCredit]);

  const passFillStyle = useAnimatedStyle(() => ({ width: `${Math.min(passFill.value, 1) * 100}%` }));

  useEffect(() => {
    if (!GYM_VIDEO_CLIPS_ENABLED || !workoutRecap) return;
    fetchCheckInClips(checkInId)
      .then(setClips)
      .catch(() => {
        // Clips are a bonus recap row, not core data — a failed fetch just hides it.
      });
  }, [checkInId, workoutRecap]);

  // The "+XP" fades in and counts up — the one animation this screen keeps, and now the only one
  // it needs: mock 92 states the rank as a chip rather than a filling bar, so the number IS the
  // motion. It counts the EARNED xp rather than the running tier total, so what moves on screen is
  // what the session actually produced.
  useEffect(() => {
    const end = Math.round(xpEarned);
    const delay = setTimeout(() => {
      setPlusVisible(true);
      fireXpTick();
      const durationMs = 1100;
      const t0 = Date.now();
      let raf: ReturnType<typeof requestAnimationFrame>;
      const step = () => {
        const p = Math.min((Date.now() - t0) / durationMs, 1);
        setDisplayXp(Math.round(end * p));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, 250);
    return () => clearTimeout(delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount for the open animation
  }, []);

  const plusStyle = useAnimatedStyle(() => ({ opacity: withDelay(300, withTiming(plusVisible ? 1 : 0, { duration: 400 })) }));

  // "Diamond II · 75% to III" (mock 92's `.rankchip`). At max rank there is nothing above to chase,
  // so the chip states the rank alone rather than inventing a target.
  const up = rankAfter ? nextRank(rankAfter.tier, rankAfter.division) : null;
  const rankProgressSuffix =
    rankAfter && up
      ? ` · ${Math.round(xpProgressRatio(rankAfter.xp_into_tier, rankAfter.xp_for_next_tier) * 100)}% to ${formatRankTier(up.tier, up.division)}`
      : '';

  const streakIncreased = streakAfter > streakBefore;
  // "Deep work · solo" (mock 81) — the goal, plus whatever qualifies it: the typed detail if there
  // is one, else the campfire it ran in, else solo.
  const goalLine = `${GOAL_TYPE_META[goalType].label} · ${goalDetail ?? circleName ?? 'solo'}`;

  const workoutExercises = workoutRecap?.exercises ?? [];
  const prCount = workoutExercises.filter((e) => e.is_pr).length;
  const totalSets = workoutExercises.reduce((n, e) => n + e.sets, 0);
  // Bodyweight work carries no weight, so a bodyweight-only session simply drops this segment
  // rather than claiming "0 lb".
  const totalVolume = workoutExercises.reduce((n, e) => n + e.sets * e.reps * (e.weight ?? 0), 0);
  const gymSummary = [
    `${workoutExercises.length} exercise${workoutExercises.length === 1 ? '' : 's'}`,
    `${totalSets} set${totalSets === 1 ? '' : 's'}`,
    totalVolume > 0 ? `${Math.round(totalVolume).toLocaleString()} lb` : null,
    prCount > 0 ? `${prCount} PR${prCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function labelForCircle(id: string): string {
    const group = groups.find((g) => g.id === id);
    if (group) return `${group.emoji} ${group.name}`;
    // useMyGroups hasn't answered yet (or the session's campfire isn't in it) — the name the
    // session carried is still the right thing to show rather than a blank row.
    return id === circleId && circleName ? circleName : 'this campfire';
  }

  const willPost = selectedCircleIds.length > 0;
  // postSessionToAgora carries at most four; the hint says what will actually ride along.
  const agoraPhotoCount = Math.min(photos.length, 4);
  // With nothing selected the row used to read "Post to nowhere — pick one", which lands as a
  // placeholder someone forgot to wire rather than as a choice (punchlist 17 P3). The label below
  // switches instead of the value, so the empty state asks for the pick rather than narrating it.
  const postTarget =
    selectedCircleIds.length === 0
      ? 'a campfire'
      : selectedCircleIds.length === 1
        ? labelForCircle(selectedCircleIds[0])
        : `${selectedCircleIds.length} campfires`;

  // The note belongs to the lock-in, not to the act of posting — so it's saved on BOTH exits. A
  // private lock-in with a note is a journal entry to yourself and it's already visible in your
  // own history; silently dropping what someone typed because they chose "Just finish" would be
  // the surprising behaviour.
  async function saveNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    await setCheckInCaption(checkInId, trimmed);
  }

  // Flipping it here IS the sticky setting (spec: set once, stays on), not a one-session override
  // that Settings has to be visited to make permanent. Fail-soft: the switch still governs this
  // session even if the default didn't save.
  function handleToggleAgora(value: boolean) {
    setPostToAgoraState(value);
    setPostToAgora(value)
      .then(() => refreshProfile())
      .catch(() => {});
  }

  // Fired, never awaited: the photos re-upload to agora-photos before the post is written, and
  // nobody should wait on that to leave a screen whose session is already banked. A failure is
  // silent — the lock-in is safe, only the feed card is missing.
  function finishToAgora() {
    if (!postToAgora || agoraFired.current || !profile) return;
    agoraFired.current = true;
    postSessionToAgora({
      checkInId,
      userId: profile.id,
      caption: note.trim() || null,
      photoUris: photos.map((p) => p.uri),
    }).catch(() => {});
  }

  function toggleCircle(id: string) {
    setSelectedCircleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handlePost() {
    setPosting(true);
    setError(null);
    try {
      await saveNote();
      // Sequential, not Promise.all: post_check_in_to_circle writes a feed row and pushes that
      // circle's members, and one failure shouldn't leave the rest in an unknown state.
      for (const id of selectedCircleIds) {
        await postCheckInToCircle(checkInId, id);
      }
      if (selectedCircleIds.length > 0) fireConfirm();
      finishToAgora();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post to the campfire — try again.'));
    } finally {
      setPosting(false);
    }
  }

  async function handleJustFinish() {
    setPosting(true);
    try {
      await saveNote();
    } catch {
      // Deliberately not surfaced or blocking: the user asked to be done, and the lock-in itself
      // (time, XP, streak, photos) is already safely recorded. Losing only an unsaved note is a
      // far better outcome than trapping them on this screen behind a retry.
    } finally {
      setPosting(false);
      finishToAgora();
      onDone();
    }
  }

  return (
    <View style={styles.container}>
      {/* Scrolls rather than compressing: the hero block is fixed-height by design, and a gym
          session with photos would otherwise squeeze the flame on a short screen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* YOUR flame, in the ramp you have equipped — the same hero Home wears, at mock 92's
            done-screen size. Not the coal-bed gauge: this screen exists because you just showed
            up, so there is no "cold" state for it to be in. */}
        <PersonalFlame size={FLAME_SIZE} glowSize={GLOW_SIZE} />

        {/* Mock 92's `.kick` / `.big-name` / `.stat` / `.statlbl` stack. The XP is the headline
            now and the clock is its caption — the reverse of the old layout, which led with the
            duration in 44px type. What a session is WORTH is the number that carries forward;
            how long it took is context for it. */}
        <Text style={styles.kick}>SESSION COMPLETE</Text>
        <Text style={styles.bigName}>Nice work{firstName ? `, ${firstName}` : ''}</Text>
        <Animated.Text style={[styles.stat, plusStyle]}>
          +{displayXp.toLocaleString()}
          <Text style={styles.statUnit}> XP</Text>
        </Animated.Text>
        <Text style={styles.statLabel} numberOfLines={1}>
          {formatDurationClock(durationSeconds)} · {goalLine}
        </Text>

        {rankBefore && rankAfter && (
          <View style={[styles.rankChip, { borderColor: `${RANK_TIER_METAL[rankAfter.tier].text}66` }]}>
            <RankBadge tier={rankAfter.tier} division={rankAfter.division} size={18} />
            <Text style={[styles.rankChipText, { color: RANK_TIER_METAL[rankAfter.tier].text }]} numberOfLines={1}>
              {formatRankTier(rankAfter.tier, rankAfter.division)}
              {rankProgressSuffix}
            </Text>
          </View>
        )}

        {/* The Emberfall Pass, beside the rank XP above: what this session credited and the bar it
            moved. Every number here is the server's (get_lock_in_pass_credit). */}
        {passCredit && passAfter && (
          <View style={styles.pass}>
            <View style={styles.passHead}>
              <Text style={styles.passXp} numberOfLines={1}>
                +{passCredit.xp.toLocaleString()} {SEASON.name} Pass XP
              </Text>
              {passCredit.bonus_xp > 0 && <Text style={styles.passBonus}>+{passCredit.bonus_xp.toLocaleString()} bonus</Text>}
            </View>
            <View style={styles.passTrack}>
              <Animated.View style={[styles.passFill, passFillStyle]} />
            </View>
            <Text style={styles.passLevel} numberOfLines={1}>
              {passPrestiged
                ? `Prestige +${passAfter.prestige} reached · Level ${passAfter.level + passAfter.prestige}`
                : passAfter.prestige > 0
                  ? `Level ${passAfter.level + passAfter.prestige} (+${passAfter.prestige} prestige)`
                  : passLeveledUp
                    ? `Level ${passAfter.level} reached`
                    : `Level ${passAfter.level}`}
              {passAfter.level < SEASON.totalLevels
                ? ` · ${passAfter.intoLevel.toLocaleString()} / ${passAfter.nextLevelCost.toLocaleString()} to ${passAfter.level + 1}`
                : ` · ${passAfter.intoLevel.toLocaleString()} / ${passAfter.nextLevelCost.toLocaleString()} to +${passAfter.prestige + 1}`}
            </Text>
          </View>
        )}

        {/* Mock 204 — season placement and its move since you last saw it. Renders nothing for
            someone not on the board yet. */}
        <PlacementMove />

        {streakAfter > 0 && (
          <View style={styles.streak}>
            <NavGlyph name="flame" size={15} color={Colors.gold} />
            <Text style={styles.streakText}>
              {streakAfter}-day streak · {streakIncreased ? '+1 today' : 'kept alive'}
            </Text>
          </View>
        )}

        {/* One line, not the old recap sprawl — the full per-exercise breakdown, PRs, brag line
            and clips all live behind "View". */}
        {workoutExercises.length > 0 && (
          <Pressable style={styles.gymLine} onPress={() => setRecapOpen(true)} accessibilityRole="button">
            <View style={styles.gymTile}>
              <NavGlyph name="dumbbell" size={18} color={Colors.navEmber2} />
            </View>
            <Text style={styles.gymSummary} numberOfLines={1}>
              {gymSummary}
            </Text>
            <Text style={styles.gymView}>View</Text>
            <UiGlyph name="forward" size={12} color={Colors.spaceFaint} />
          </Pressable>
        )}
      </ScrollView>

      <View style={styles.bottom}>
        {/* A thumbnail row, never a gallery — the photos are already saved to the lock-in. */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photoScroll}
            contentContainerStyle={styles.photoRow}>
            {photos.map((p) => (
              <Image key={p.id} source={{ uri: p.uri }} style={styles.photoThumb} />
            ))}
          </ScrollView>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.post}>
          {groups.length > 0 && (
            <View style={styles.postTo}>
              <Text style={styles.postToLabel}>{willPost ? 'Post to' : 'Pick'}</Text>
              <Text style={styles.postToName} numberOfLines={1}>
                {postTarget}
              </Text>
              <Pressable onPress={() => setPickerOpen((v) => !v)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.change}>{pickerOpen ? 'done' : 'change'}</Text>
              </Pressable>
            </View>
          )}

          {/* Still multi-post (migration 0059) — just not a decision every time. */}
          {pickerOpen && groups.length > 0 && (
            <View style={styles.circleGrid}>
              {groups.map((group) => {
                const on = selectedCircleIds.includes(group.id);
                return (
                  <Pressable
                    key={group.id}
                    onPress={() => toggleCircle(group.id)}
                    disabled={posting}
                    style={[styles.circleChip, on && styles.circleChipOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Post to ${group.name}`}>
                    {on && <UiGlyph name="check" size={12} color={Colors.navEmber2} />}
                    <Text style={[styles.circleChipText, on && styles.circleChipTextOn]} numberOfLines={1}>
                      {group.emoji} {group.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* One field, two jobs: the lock-in's own caption and, with the switch below on, the
              Agora post's caption. Mock 297 orders it photos → caption → switch. */}
          <TextInput
            style={styles.note}
            placeholder="Add a caption…"
            value={note}
            onChangeText={setNote}
            maxLength={140}
            editable={!posting}
          />

          <View style={styles.agoraRow}>
            <View style={styles.agoraText}>
              <Text style={styles.agoraTitle}>Post to the Agora</Text>
              <Text style={styles.agoraSub}>Your feed · shared with friends</Text>
            </View>
            <Toggle
              value={postToAgora}
              onValueChange={handleToggleAgora}
              disabled={posting}
              accessibilityLabel="Post this session to the Agora"
            />
          </View>
          {postToAgora && photos.length > 0 && (
            <Text style={styles.agoraHint}>
              {agoraPhotoCount} photo{agoraPhotoCount === 1 ? '' : 's'} from this session attach automatically.
            </Text>
          )}
        </View>

        {/* The one ember action on this screen — the kit's primary, with its spinner while posting. */}
        <SpaceButton
          label={willPost || postToAgora ? 'Post & finish' : 'Finish'}
          onPress={handlePost}
          loading={posting}
          style={styles.cta}
        />
        {/* Only when there's actually something to skip — otherwise it's the same button twice. */}
        {willPost && (
          <Pressable onPress={handleJustFinish} disabled={posting} style={styles.skip}>
            <Text style={styles.skipLabel}>Just finish</Text>
          </Pressable>
        )}
        {/* Posting to a campfire and posting to a story are different audiences, so Share sits
            beside the CTA rather than replacing it (mock 96's trigger table: lock-in card fires
            from the done screen). */}
        {onShare && (
          <Pressable onPress={onShare} disabled={sharing || posting} style={styles.skip} accessibilityLabel="Share this lock-in">
            <View style={styles.shareInner}>
              <UiGlyph name="share" size={14} color={Colors.navEmber2} />
              <Text style={styles.shareLabel}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
            </View>
          </Pressable>
        )}
      </View>

      <GymRecapSheet
        visible={recapOpen}
        onClose={() => setRecapOpen(false)}
        recap={workoutRecap}
        clips={clips}
        prCount={prCount}
      />
    </View>
  );
}

// The full gym recap, one tap away from the summary line. Everything the done screen used to
// render inline: per-exercise rollups, PR tags, the honest-brag line and any clips.
function GymRecapSheet({
  visible,
  onClose,
  recap,
  clips,
  prCount,
}: {
  visible: boolean;
  onClose: () => void;
  recap: WorkoutRecap | null;
  clips: WorkoutSet[];
  prCount: number;
}) {
  if (!recap) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {recap.routine_name ?? 'Your workout'}
              {prCount > 0 ? ` · ${prCount} PR${prCount === 1 ? '' : 's'}` : ''}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.sheetClose} accessibilityLabel="Close">
              <UiGlyph name="close" size={16} color={Colors.spaceDim} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetBody}>
            {recap.exercises.map((s, i) => (
              <View key={i} style={styles.setRow}>
                <NavGlyph name="dumbbell" size={14} color={Colors.spaceFaint} />
                <Text style={styles.setText} numberOfLines={1}>
                  {s.exercise} · {s.sets}×{s.reps}
                  {s.weight ? ` @ ${s.weight}` : ''}
                </Text>
                {s.is_pr && (
                  <View style={styles.prTag}>
                    <NavGlyph name="trophy" size={10} color={Colors.gold} />
                    <Text style={styles.prTagText}>PR</Text>
                  </View>
                )}
              </View>
            ))}

            {/* HONEST BRAG (§23 rule 2): decided server-side at Finish — `dialed` alone never
                earns this line, a personal best actually logged in the session does. */}
            {recap.brag_earned && (
              <View style={styles.bragRow}>
                <NavGlyph name="flame" size={13} color={Colors.gold} />
                <Text style={styles.bragText}>You were feeling dialed — and the numbers backed it up.</Text>
              </View>
            )}

            {clips.length > 0 && (
              <>
                <Text style={styles.clipsLabel}>Clips from this session</Text>
                <View style={styles.clipsRow}>
                  {clips.map((c) => (
                    <GymClipThumbnail key={c.id} workoutSetId={c.id} size={72} />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // width:'100%' matters here: the caller centers this component inside a flex column
  // (alignItems:'center'), which shrink-wraps children that don't claim full width.
  container: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
  },
  // ── mock 92's hero stack ──
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: Colors.navEmber2,
    marginTop: 16,
  },
  bigName: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 23,
    lineHeight: 28,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 14,
  },
  // Gold: the XP is what was EARNED, and gold is the space kit's earned colour.
  stat: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 40,
    color: Colors.gold,
    marginTop: 6,
    // Tabular figures so a counting number doesn't jitter its own width as it ticks.
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 18,
    color: Colors.gold,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    letterSpacing: 0.3,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  rankChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'center',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
    maxWidth: '100%',
    marginTop: 16,
  },
  rankChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
  // The Pass block — the kit's gold-toned card (SpaceCard tone="gold"): it reports what was earned,
  // stretched so the bar has room to move.
  pass: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,209,102,0.07)',
    borderWidth: 1,
    borderColor: '#5A4A1E',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    gap: 7,
  },
  passHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  passXp: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.gold,
    fontVariant: ['tabular-nums'],
  },
  passBonus: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  passTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    overflow: 'hidden',
  },
  passFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.gold,
  },
  passLevel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.spaceDim,
    fontVariant: ['tabular-nums'],
  },
  // A gold pill — the streak is a result, not a caption.
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#5A4A1E',
    backgroundColor: 'rgba(255,209,102,0.07)',
  },
  streakText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.gold,
  },
  // SpaceRow's look: panel on a 1px line, an ember leading tile, a chevron.
  gymLine: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
  },
  gymTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,122,47,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gymSummary: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  gymView: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.navEmber2,
  },
  bottom: {
    width: '100%',
  },
  // Explicit height: a horizontal ScrollView in a non-flex column otherwise collapses to nothing.
  photoScroll: {
    flexGrow: 0,
    height: 54,
  },
  photoRow: {
    flexDirection: 'row',
    gap: 6,
  },
  photoThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: Colors.spacePanel2,
  },
  // The mock's post card is one step up from its stage: a kit panel (spacePanel on spaceLine), with
  // the note field inset back down to the spaceBg canvas.
  post: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  postTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  postToLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  postToName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  change: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.navEmber2,
  },
  circleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: 10,
  },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 180,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel2,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  // SpaceChip's selected state.
  circleChipOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.12)',
  },
  circleChipText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  circleChipTextOn: {
    color: Colors.navEmber2,
  },
  // Flatter than the standalone field it replaced — inside the post card it reads as part of the
  // card, not as a second input competing with it.
  note: {
    backgroundColor: Colors.spaceBg,
    borderWidth: 0,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  agoraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 10,
  },
  agoraText: {
    flex: 1,
  },
  agoraTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  agoraSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  agoraHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.spaceDim,
    marginTop: 6,
  },
  cta: {
    marginTop: 12,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    marginTop: 3,
  },
  shareInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  shareLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.navEmber2,
    textAlign: 'center',
  },
  skipLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.danger,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  // ───────────────────────── full gym recap sheet ─────────────────────────
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(14,10,28,0.6)',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 15,
    paddingBottom: Spacing.four,
  },
  grab: {
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spaceLine,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: 10,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: Fonts.black,
    fontSize: 17,
    color: Colors.ink,
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: {
    gap: 6,
    paddingBottom: Spacing.two,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  setText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  prTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderRadius: Radius.pill,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  prTagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    color: Colors.gold,
  },
  bragRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  bragText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.gold,
  },
  clipsLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,

    marginTop: 12,
  },
  clipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
