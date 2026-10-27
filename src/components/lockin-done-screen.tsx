import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { showRewardReveal } from '@/components/economy/reward-reveal';
import { GymClipThumbnail } from '@/components/gym-clip-player';
import { PlacementMove } from '@/components/placement-move';
import { SpearPlantBeat, SpearPlantShake, useSpearPlant } from '@/components/spear-plant-reveal';
import { Icon, IconText, type IconName } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceButton } from '@/components/ui/space-kit';
import { TextInput } from '@/components/ui/text-input';
import { Toggle } from '@/components/ui/toggle';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { GYM_VIDEO_CLIPS_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';
import { postSessionToAgora, setPostToAgora, type AgoraSessionTarget } from '@/lib/api/agora';
import { fetchForests } from '@/lib/api/forests';
import { fetchLockInPassCredit, type LockInPassCredit } from '@/lib/api/forge-pass';
import { fetchCheckInClips } from '@/lib/api/gym-clips';
import { setCheckInCaption } from '@/lib/api/lock-ins';
import { useAuth } from '@/lib/auth/auth-context';
import { levelFromXp, SEASON } from '@/lib/economy/forge-pass';
import { getErrorMessage } from '@/lib/errors';
import { formatDurationClock } from '@/lib/format';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { formatRankTier, isRankUp, nextRank, xpProgressRatio } from '@/lib/rank-tiers';
import { fireConfirm } from '@/lib/reward-feedback';
import type { ForestSummary } from '@/types/social';
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

const XP_COUNT_MS = 1100;

// The "done" screen (design-mocks/81-done-screen.html) — built around the SAME big living flame
// as the work session, stripped to the four things that matter: you locked in, for how long, the
// XP it moved, and one tap to post.
//
// Everything else was pushed off this screen deliberately (punchlist 6 §3): the routine-naming
// block now lives on the gym screen, the caption is folded into the post card as an optional
// note, the campfire multi-select hides behind "change", and a gym recap collapses to one line
// with a "View" that opens the full thing.
//
// The screen opens on the spear-plant (mock 311, spear-plant-reveal.tsx) — the hoplite plants alone,
// the screen shakes, and he makes way as the results slam in on their beats.
//
// THE REDRAFT (mock 316): one clean hierarchy instead of four announcement blocks. Flame · one
// greeting ("Locked in, Noah.") · the session TIME as the hero with its discipline under it · ONE
// reward band (+XP · rank · streak, hairline-divided) · ONE adaptive rank line (climbed, green — or
// holding your spot, gold — with the bar to the next division) · the post row collapsed to a line ·
// Done. "Session complete" and "Nice work" are gone on purpose; don't re-add a second greeting.
//
// A rank-up is still its OWN moment first: the caller shows RankUpCelebration's forge, and its
// Continue lands here (lock-in/index.tsx), so this screen's rank line reads the climb calmly rather
// than stacking the celebration's text on it. Same for a Pass prestige (showRewardReveal below).
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
  const [target, setTarget] = useState<AgoraSessionTarget>({ kind: 'everyone' });
  const [myForests, setMyForests] = useState<ForestSummary[]>([]);
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

  // What this session ACTUALLY paid the Emberfall Pass — the ledger row the server's lock-in
  // trigger wrote (0227), never `hours × 250` worked out here. Null until it answers, and stays null
  // when nothing was credited (under 5 min, season not live): no Pass line at all, not a "+0".
  const [passCredit, setPassCredit] = useState<LockInPassCredit | null>(null);
  // Mock 316: the caption field stays folded into the post row until asked for.
  const [captionOpen, setCaptionOpen] = useState(false);

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
  // Past L100 the bar is the climb to the next PRESTIGE (0232).
  const passPrestiged = !!passAfter && !!passBefore && passAfter.prestige > passBefore.prestige;

  // The Pass bar itself left this screen in the redraft (mock 316 has one reward band, no fourth
  // block); its progress lives on the Flame Pass. A PRESTIGE is still its own moment — ~36 hours past
  // a full pass is the biggest thing a stop can report. Nothing is listed as won: the rewards are a
  // claim on the Flame Pass, and the reveal never congratulates you for something not yet paid.
  useEffect(() => {
    if (!passAfter || !passBefore) return;
    if (passPrestiged) {
      showRewardReveal({
        kind: 'pass_prestige',
        title: `Prestige +${passAfter.prestige}`,
        subtitle: `Level ${passAfter.level + passAfter.prestige} on the ${SEASON.name} Pass — your rewards are waiting on the Flame Pass.`,
        rewards: [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the credit lands
  }, [passCredit]);

  // Your forests, for the Agora destination chips. A failed read just offers everyone + campfires.
  useEffect(() => {
    let live = true;
    fetchForests()
      .then((rows) => {
        if (live) setMyForests(rows.filter((f) => f.my_status === 'active'));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!GYM_VIDEO_CLIPS_ENABLED || !workoutRecap) return;
    fetchCheckInClips(checkInId)
      .then(setClips)
      .catch(() => {
        // Clips are a bonus recap row, not core data — a failed fetch just hides it.
      });
  }, [checkInId, workoutRecap]);

  // The "+XP" counts up as its stat group slams in (XpCountUp below). Only the flag lives here: the
  // per-frame number is the child's own state, so the count re-renders one Text, not this screen.
  const [xpCounting, setXpCounting] = useState(false);
  const reveal = useSpearPlant(() => setXpCounting(true));

  // Climbed = this stop moved the universal rank up a division or tier (the caller's own test).
  const climbed = Boolean(rankBefore && rankAfter && isRankUp(rankBefore, rankAfter));

  // "DEEP WORK" under the time (mock 316) — the discipline, plus the typed detail when there is one.
  const goalLabel = `${GOAL_TYPE_META[goalType].label}${goalDetail ? ` · ${goalDetail}` : ''}`;

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

  // postSessionToAgora carries at most four; the post row says what will actually ride along.
  const agoraPhotoCount = Math.min(photos.length, 4);
  const postSub = agoraPhotoCount > 0
    ? `${agoraPhotoCount} photo${agoraPhotoCount === 1 ? '' : 's'} · ${note.trim() ? 'caption added' : 'add a caption'}`
    : note.trim()
      ? 'Caption added'
      : 'Add a caption';
  const targetKey = target.kind === 'everyone' ? 'everyone' : `${target.kind}:${target.id}`;

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

  // To EVERYONE: fired, never awaited — the photos re-upload to agora-photos before the post is
  // written, and nobody should wait on that to leave a screen whose session is already banked; a
  // failure only loses the feed card. To a FOREST or CAMPFIRE: awaited, and a failure keeps you here
  // with the error. That post was meant for one room, so it must never quietly go nowhere — and it
  // never falls back to the whole square, which would widen its audience past what you picked.
  async function postToTheAgora(): Promise<void> {
    if (!postToAgora || agoraFired.current || !profile) return;
    const post = postSessionToAgora({
      checkInId,
      userId: profile.id,
      caption: note.trim() || null,
      photoUris: photos.map((p) => p.uri),
      target,
    });
    if (target.kind === 'everyone') {
      agoraFired.current = true;
      post.catch(() => {});
      return;
    }
    await post;
    agoraFired.current = true;
  }

  async function handlePost() {
    setPosting(true);
    setError(null);
    try {
      await saveNote();
      await postToTheAgora();
      if (postToAgora) fireConfirm();
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not post there — try again, or post to everyone.'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <SpearPlantShake reveal={reveal} style={styles.container}>
      {/* Scrolls rather than compressing: a gym session with the spots and the recap line can run
          past a short screen. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* 1–2 · the flame the spear-plant resolves into, and ONE greeting. */}
        <SpearPlantBeat reveal={reveal} beat="statsHead" style={styles.beat}>
          <NavGlyph name="flame" size={44} color={Colors.navEmber} />
          <Text style={styles.greet}>Locked in{firstName ? `, ${firstName}` : ''}.</Text>
        </SpearPlantBeat>

        {/* 3–4 · the time is the hero; the three rewards share one band. */}
        <SpearPlantBeat reveal={reveal} beat="statsMain" style={styles.beat}>
          <Text style={styles.hero}>{formatDurationClock(durationSeconds)}</Text>
          <Text style={styles.goal} numberOfLines={1}>
            {goalLabel.toUpperCase()}
          </Text>
          <View style={styles.band}>
            <View style={styles.bandCell}>
              <XpCountUp end={Math.round(xpEarned)} running={xpCounting} instant={reveal.skipped || reveal.still} />
              <Text style={styles.bandLabel}>XP</Text>
            </View>
            {rankAfter ? (
              <View style={[styles.bandCell, styles.bandCellRule]}>
                <Text style={[styles.bandValue, climbed ? styles.bandUp : styles.bandHeld]}>{climbed ? '▲' : '—'}</Text>
                <Text style={styles.bandLabel} numberOfLines={1}>
                  {formatRankTier(rankAfter.tier, rankAfter.division)}
                </Text>
              </View>
            ) : null}
            <View style={[styles.bandCell, styles.bandCellRule]}>
              <IconText icon="streak" style={[styles.bandValue, styles.bandStreak]}>
                {streakAfter}
              </IconText>
              <Text style={styles.bandLabel}>Streak</Text>
            </View>
          </View>
        </SpearPlantBeat>

        {/* 5 · one rank line, two states — then the board spots and, for gym, the recap door. */}
        <SpearPlantBeat reveal={reveal} beat="statsRest" style={styles.beat}>
          {rankAfter ? <RankLine rank={rankAfter} climbed={climbed} /> : null}

          {/* Mock 204 — where you stand on Friends, your uni and Global. Renders nothing for someone
              not on a board yet. */}
          <PlacementMove prominent style={styles.placement} />

          {/* One line — the full per-exercise breakdown, PRs, brag line and clips live behind it. */}
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
        </SpearPlantBeat>
      </ScrollView>

      {/* 6–7 · the post row, then Done. */}
      <SpearPlantBeat reveal={reveal} beat="cta" style={styles.bottom}>
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.post}>
          <View style={styles.agoraRow}>
            {/* The subtitle is the door to the caption — one row, not a field nobody asked for. */}
            <Pressable
              style={styles.agoraText}
              onPress={() => setCaptionOpen(true)}
              disabled={posting}
              accessibilityRole="button"
              accessibilityLabel={`Post to the Agora. ${postSub}`}>
              <Text style={styles.agoraTitle}>Post to the Agora</Text>
              <Text style={styles.agoraSub} numberOfLines={1}>
                {postSub}
              </Text>
            </Pressable>
            <Toggle
              value={postToAgora}
              onValueChange={handleToggleAgora}
              disabled={posting}
              accessibilityLabel="Post this session to the Agora"
            />
          </View>

          {/* One field, two jobs: the lock-in's own caption and, with the switch on, the post's. */}
          {captionOpen || note ? (
            <TextInput
              style={styles.note}
              placeholder="Add a caption…"
              value={note}
              onChangeText={setNote}
              maxLength={140}
              editable={!posting}
              autoFocus={captionOpen && !note}
            />
          ) : null}

          {/* Where it lands — everyone, one of your forests, or one of your campfires' channels. */}
          {postToAgora && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.whereScroll}
              contentContainerStyle={styles.whereRow}
              keyboardShouldPersistTaps="handled">
              <WhereChip label="Everyone" icon="everyone" on={targetKey === 'everyone'} disabled={posting} onPress={() => setTarget({ kind: 'everyone' })} />
              {myForests.map((f) => (
                <WhereChip
                  key={`forest:${f.id}`}
                  label={`${f.emoji} ${f.name}`}
                  on={targetKey === `forest:${f.id}`}
                  disabled={posting}
                  onPress={() => setTarget({ kind: 'forest', id: f.id })}
                />
              ))}
              {groups.map((g) => (
                <WhereChip
                  key={`campfire:${g.id}`}
                  label={`${g.emoji} ${g.name}`}
                  on={targetKey === `campfire:${g.id}`}
                  disabled={posting}
                  onPress={() => setTarget({ kind: 'campfire', id: g.id })}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* The one exit: posts when the switch is on, just finishes when it's off. The note is
            saved either way (saveNote). */}
        <SpaceButton label="Done" onPress={handlePost} loading={posting} style={styles.cta} />
        {/* Posting to the Agora and posting to a story are different audiences (mock 96's trigger
            table), so the story share stays — as a quiet link, not a second button. */}
        {onShare && (
          <Pressable onPress={onShare} disabled={sharing || posting} style={styles.skip} accessibilityLabel="Share this lock-in">
            <View style={styles.shareInner}>
              <UiGlyph name="share" size={14} color={Colors.navEmber2} />
              <Text style={styles.shareLabel}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
            </View>
          </Pressable>
        )}
      </SpearPlantBeat>

      <GymRecapSheet
        visible={recapOpen}
        onClose={() => setRecapOpen(false)}
        recap={workoutRecap}
        clips={clips}
        prCount={prCount}
      />
    </SpearPlantShake>
  );
}

/**
 * Mock 316's rank line — one component, two states, never a screen of its own.
 *   climbed: "▲ Climbed to Gold III"     · 720 / 2100 to Gold IV · green bar
 *   held:    "Holding your spot · Gold II" · 460 / 2100 to Gold III · gold bar
 * The numbers are the server's universal rank (xp_into_tier / xp_for_next_tier) — the same source
 * Home and the Live Activity read. At the top of the climb there is no next step to name.
 */
function RankLine({ rank, climbed }: { rank: MyRank; climbed: boolean }) {
  const name = formatRankTier(rank.tier, rank.division);
  const up = nextRank(rank.tier, rank.division);
  const ratio = up ? xpProgressRatio(rank.xp_into_tier, rank.xp_for_next_tier) : 1;
  return (
    <View
      style={[styles.rankLine, climbed ? styles.rankLineUp : styles.rankLineHeld]}
      accessible
      accessibilityLabel={`${climbed ? `Climbed to ${name}` : `Holding your spot at ${name}`}${
        up ? `, ${rank.xp_into_tier} of ${rank.xp_for_next_tier} to ${formatRankTier(up.tier, up.division)}` : ''
      }`}>
      <View style={styles.rankTop}>
        <Text style={[styles.rankTitle, climbed ? styles.rankTitleUp : styles.rankTitleHeld]} numberOfLines={1}>
          {climbed ? `▲ Climbed to ${name}` : `Holding your spot · ${name}`}
        </Text>
        <Text style={styles.rankNext} numberOfLines={1}>
          {up
            ? `${Math.round(rank.xp_into_tier).toLocaleString()} / ${Math.round(rank.xp_for_next_tier).toLocaleString()} to ${formatRankTier(up.tier, up.division)}`
            : 'Top of the climb'}
        </Text>
      </View>
      <View style={styles.rankTrack}>
        <View style={[styles.rankFill, climbed ? styles.rankFillUp : styles.rankFillHeld, { width: `${ratio * 100}%` }]} />
      </View>
    </View>
  );
}

// The earned XP, counting up once its stat group lands. Its OWN component on purpose: the count
// sets state every frame for 1.1s, and when that state lived on LockInDoneScreen it re-rendered the
// whole screen 60 times a second — the hoplite's LottieView re-stringified its source each time —
// which is what stuttered the spear-plant. A skip or reduce motion shows the final number at once.
function XpCountUp({ end, running, instant }: { end: number; running: boolean; instant: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!running || instant) return;
    const t0 = Date.now();
    let raf = requestAnimationFrame(function step() {
      const p = Math.min((Date.now() - t0) / XP_COUNT_MS, 1);
      setShown(Math.round(end * p));
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [running, instant, end]);
  return <Text style={[styles.bandValue, styles.bandXp]}>+{(instant ? end : shown).toLocaleString()}</Text>;
}

/** One destination in the "Post to the Agora" sub-choice. Single-select: a post lands in one place. */
function WhereChip({
  label,
  icon,
  on,
  disabled,
  onPress,
}: {
  label: string;
  icon?: IconName;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.circleChip, on && styles.circleChipOn]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`Post to ${label}`}>
      {on && <UiGlyph name="check" size={12} color={Colors.navEmber2} />}
      {icon ? <Icon name={icon} size={14} color={on ? Colors.navEmber2 : Colors.spaceDim} /> : null}
      <Text style={[styles.circleChipText, on && styles.circleChipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  // Anchored, not centred: the pass credit, the placement and the campfire list all arrive after
  // mount, and with a centred column each arrival re-centred everything and jerked the stats
  // mid-animation.
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: Spacing.two,
  },
  // Each stat group stretches like the scroll column it replaces, so the full-width cards inside
  // (pass, gym line) keep their width and everything else stays centred.
  beat: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  // ── mock 316 ──
  greet: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  // The hero is the time. Tabular so a 1:24:06 and a 46:12 sit on the same baseline grid.
  hero: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 46,
    lineHeight: 50,
    letterSpacing: -1.5,
    color: Colors.ink,
    marginTop: 18,
    fontVariant: ['tabular-nums'],
  },
  goal: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.navEmber2,
    marginTop: 4,
  },
  // One card, three cells divided by hairlines.
  band: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    marginTop: 22,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  bandCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  // The hairline: a left border on every cell but the first, inset by the cell's own padding.
  bandCellRule: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.spaceLine,
  },
  bandValue: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 19,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  // Gold is the kit's earned colour; green is movement up; the streak keeps the ember.
  bandXp: {
    color: Colors.gold,
  },
  bandUp: {
    color: Colors.green,
  },
  bandHeld: {
    color: Colors.spaceDim,
  },
  bandStreak: {
    color: Colors.navEmber2,
  },
  bandLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: Colors.muted,
    marginTop: 2,
  },
  rankLine: {
    alignSelf: 'stretch',
    marginTop: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 13,
    borderWidth: 1,
  },
  rankLineUp: {
    borderColor: '#2a4d3a',
    backgroundColor: 'rgba(57,217,138,0.10)',
  },
  rankLineHeld: {
    borderColor: '#3a2d18',
    backgroundColor: 'rgba(255,209,102,0.07)',
  },
  rankTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rankTitle: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
  },
  rankTitleUp: {
    color: Colors.green,
  },
  rankTitleHeld: {
    color: Colors.gold,
  },
  rankNext: {
    marginLeft: 'auto',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.spaceDim,
    fontVariant: ['tabular-nums'],
  },
  rankTrack: {
    height: 7,
    marginTop: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel2,
    overflow: 'hidden',
  },
  rankFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  rankFillUp: {
    backgroundColor: Colors.green,
  },
  rankFillHeld: {
    backgroundColor: Colors.gold,
  },
  placement: {
    marginTop: 12,
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
    marginTop: 10,
    backgroundColor: Colors.spaceBg,
    borderWidth: 0,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  // The destination chips under the switch — one scrolling row, single-select.
  whereScroll: {
    flexGrow: 0,
    marginTop: 10,
  },
  whereRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  agoraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
