import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Crown } from '@/components/ui/crown';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useChallengeWatch, useGroupChallengeWatch } from '@/hooks/use-challenge-watch';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { cheerChallenge, fetchChallengeCheerNotes } from '@/lib/api/leaderboard-social';
import { formatMetricValue, metricLabel } from '@/lib/challenge-metric';
import { challengeClockText, viewerLabels } from '@/lib/challenge-outcome';
import type { CheerNote, SocialChallengeRaceMetric } from '@/types/database';

// Mirrors the challenge_cheers_note_len constraint in 0110. Changing one without the other means
// the composer either truncates early or offers characters the insert will refuse.
const MAX_NOTE = 140;

// Was a two-key RACE_METRIC_LABEL map defaulting to "Race", plus a `${Math.round(score)}${metric
// === 'lockin_time' ? 's' : ' XP'}` inline — so a four-hour lead printed "14400s" and twelve
// thousand pounds of volume printed "12000 XP". Both now come from challenge-metric.ts, which is
// the one place that knows the 0096 metric set.
function ScoreValue({ score, raceMetric }: { score: number; raceMetric: SocialChallengeRaceMetric | null }) {
  return <Text style={styles.score}>{formatMetricValue(raceMetric, score)}</Text>;
}

/**
 * One side's cheer control. `mine` marks the side this viewer backed — with one cheer per
 * challenge the count alone can't say who you're behind, and that is the fact the button exists
 * to record. Disabled renders as a plain count rather than a dead button, so a settled challenge
 * or a spent cheer reads as information instead of something broken.
 */
function CheerButton({
  count,
  mine,
  disabled,
  isFinal,
  onPress,
}: {
  count: number;
  mine: boolean;
  disabled: boolean;
  isFinal: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.cheerBtn, mine && styles.cheerBtnMine, disabled && styles.cheerBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: mine }}
      accessibilityLabel={mine ? `You cheered this side · ${count} cheers` : `Cheer · ${count}`}>
      <Ionicons
        name={mine ? 'megaphone' : 'megaphone-outline'}
        size={14}
        color={mine ? Colors.ember : disabled ? Colors.textTertiary : Colors.ember}
      />
      <Text style={[styles.cheerText, disabled && !mine && styles.cheerTextDisabled]}>
        {isFinal ? `${count}` : mine ? `Cheered · ${count}` : `Cheer · ${count}`}
      </Text>
    </Pressable>
  );
}

// One cheer per challenge is permanent and picks a side (0081), so this is a confirm step, not
// friction bolted onto a one-tap button. The note is optional — "Cheer" sends with an empty box.
function CheerComposer({
  forName,
  busy,
  onCancel,
  onSend,
}: {
  forName: string;
  busy: boolean;
  onCancel: () => void;
  onSend: (note: string) => void;
}) {
  // Inside a <Modal>, so the OS inset is this component's problem — the parent <Screen>'s
  // SafeAreaView does not extend over a modal.
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState('');
  const left = MAX_NOTE - note.trim().length;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Close" />

          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>Backing {forName}</Text>
            <Text style={styles.sheetSub}>
              One cheer per challenge, and it can’t be moved or edited afterwards.
            </Text>

            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Say something (optional)"
              placeholderTextColor={Colors.textTertiary}
              multiline
              // Hard cap at the column’s own limit so the field cannot compose something the
              // constraint in 0110 would reject.
              maxLength={MAX_NOTE}
              editable={!busy}
              accessibilityLabel="Note to send with your cheer"
            />
            {/* Only once it matters. A counter sitting at 140/140 from the first frame is noise. */}
            {left <= 40 ? <Text style={styles.noteCount}>{left}</Text> : null}

            <Pressable
              style={[styles.sendBtn, busy && styles.sendBtnBusy]}
              onPress={() => onSend(note)}
              disabled={busy}
              accessibilityRole="button">
              <Ionicons name="megaphone" size={15} color={Colors.ink} />
              <Text style={styles.sendText}>{busy ? 'Sending…' : 'Cheer'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// The notes wall. Deliberately not part of the polled watch payload (0110) — it is read once and
// re-read after this viewer cheers, not every few seconds.
function CheerWall({
  challengeId,
  version,
  nameFor,
}: {
  challengeId: string;
  version: number;
  nameFor: (userId: string) => string;
}) {
  const [notes, setNotes] = useState<CheerNote[]>([]);

  useEffect(() => {
    let active = true;
    fetchChallengeCheerNotes(challengeId)
      .then((rows) => {
        if (active) setNotes(rows);
      })
      // Silent: the wall is decoration on top of the race. A failed read must not put an error
      // over a working scoreboard.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [challengeId, version]);

  if (notes.length === 0) return null;

  return (
    <View style={styles.wall}>
      {notes.map((n) => (
        <View key={n.spectator_id} style={styles.wallRow}>
          <Avatar label={n.spectator_name} size={22} />
          <View style={styles.wallBody}>
            <Text style={styles.wallWho} numberOfLines={1}>
              {n.spectator_name} <Text style={styles.wallFor}>→ {nameFor(n.backed_user_id)}</Text>
            </Text>
            <Text style={styles.wallNote}>{n.note}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function H2HWatch({ challengeId }: { challengeId: string }) {
  const { session } = useAuth();
  const { watch, loading, error } = useChallengeWatch(challengeId);
  const [cheering, setCheering] = useState<string | null>(null);
  // The server's count for whichever side this viewer cheered, held only until the next poll
  // catches up. NOT a delta added on top of the polled value — that was the old shape, and it
  // double-counted the moment the poll included the cheer, then dropped when the delta reset
  // (the "7 → 0"). An absolute value can only ever be right or briefly stale.
  const [cheeredCount, setCheeredCount] = useState<{ side: 'created_by' | 'opponent'; count: number } | null>(null);
  // Which side the composer is open for. Held as the whole target rather than an id so the sheet
  // can title itself without reaching back into `watch`, which is possibly null above the guards.
  const [composeFor, setComposeFor] = useState<{
    userId: string;
    name: string;
    side: 'created_by' | 'opponent';
  } | null>(null);
  // Bumped after this viewer's cheer lands so the wall re-reads. A counter rather than refetching
  // inline: CheerWall owns its own fetch, and this is the only thing that can change it.
  const [notesVersion, setNotesVersion] = useState(0);

  if (loading && !watch) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.coral} />
      </View>
    );
  }
  if (error || !watch) {
    return <EmptyState emoji="👀" title="Can't watch this one" body={error ?? 'This challenge has ended or you no longer have access.'} />;
  }

  async function handleCheer(forUserId: string, side: 'created_by' | 'opponent', note: string) {
    if (cheering) return;
    setCheering(forUserId);
    try {
      const count = await cheerChallenge(challengeId, forUserId, note);
      setCheeredCount({ side, count });
      setComposeFor(null);
      setNotesVersion((v) => v + 1);
    } catch {
      // The sheet stays open on failure. Closing it would throw away what they typed for an error
      // they never saw.
      // Server refused (already cheered, challenge settled, or competing in it). The button is
      // disabled in all three cases, so this is a stale screen — the next poll corrects it, and
      // inventing a local number here is what caused the count to disagree with the server.
    } finally {
      setCheering(null);
    }
  }

  const myScore = watch.created_by_score;
  const oppScore = watch.opponent_score ?? 0;
  const total = myScore + oppScore;
  const creatorShare = total > 0 ? myScore / total : 0.5;
  // 🔴 "Noah Brikman vs Noah Brikman". This screen printed both competitors by their real
  // display_name, so a racer watching their own duel saw their own name where every other surface
  // says "You" — and with two accounts that share a display name (which the test pair do) the
  // matchup became literally unreadable. challenge-info has always got this right; viewerLabels is
  // that rule, extracted so the two screens cannot drift again.
  //
  // A SPECTATOR keeps both real names, because for them "You" would be false.
  const labels = viewerLabels(
    {
      createdById: watch.created_by,
      createdByName: watch.created_by_name,
      opponentId: watch.opponent_id,
      opponentName: watch.opponent_name,
    },
    session?.user.id
  );
  const creatorCheers = cheeredCount?.side === 'created_by' ? cheeredCount.count : watch.created_by_cheers;
  const opponentCheers = cheeredCount?.side === 'opponent' ? cheeredCount.count : watch.opponent_cheers ?? 0;
  const isCreator = session?.user.id === watch.created_by;

  // Read-only once settled (CHALLENGE_UI_SPEC §58) — the RPC also refuses a late cheer, this just
  // stops the screen offering an action that cannot succeed.
  const isFinal = watch.status !== 'active';
  // A competitor can't cheer their own duel, and everyone gets exactly one cheer per challenge.
  const isCompetitor = session?.user.id === watch.created_by || session?.user.id === watch.opponent_id;
  const spentCheer = watch.has_cheered || cheeredCount !== null;
  const cheerDisabled = Boolean(cheering) || isFinal || isCompetitor || spentCheer;
  const cheeredFor = cheeredCount
    ? cheeredCount.side === 'created_by'
      ? watch.created_by
      : watch.opponent_id
    : watch.cheered_for;

  return (
    // Scrolls now that the cheer wall hangs off the bottom: Screen gives no scroll of its own, and
    // the wall reads up to 50 notes (0110), which would otherwise run off the bottom of a fixed
    // View with no way to reach them. GroupWatch keeps its FlatList — nesting one in a ScrollView
    // is the thing that warning is about.
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
      <View style={styles.goalRow}>
        <Ionicons name="flash" size={13} color={Colors.achieverText} />
        <Text style={styles.goalText}>{metricLabel(watch.race_metric)}</Text>
        {/* 🔴 "Most lock-in time · ending soon", four lines above "Final · this challenge has
            ended". This was `formatTimeLeft(ends_at)` unconditionally, and a countdown cannot know
            the race has a result — the GROUP header two hundred lines down has always had the
            `isFinal ? 'Final'` guard, and this one never got it. Both now read the same helper.
            No verdict is passed because get_challenge_watch does not return winner_id: a spectator
            gets "Final", which is what the note under the board already says. */}
        <Text style={styles.timeLeft}>{challengeClockText(watch.status, watch.ends_at)}</Text>
      </View>

      <View style={styles.matchup}>
        <View style={styles.competitor}>
          <Avatar label={labels.createdByLabel} size={44} lit={isCreator} />
          <Text style={styles.competitorName} numberOfLines={1}>
            {labels.createdByLabel}
          </Text>
          <ScoreValue score={myScore} raceMetric={watch.race_metric} />
          <Text style={styles.liveStatus} numberOfLines={1}>
            {watch.created_by_live_status}
          </Text>
        </View>
        <Text style={styles.vs}>vs</Text>
        <View style={styles.competitor}>
          <Avatar label={labels.opponentLabel} size={44} lit={!isCreator} />
          <Text style={styles.competitorName} numberOfLines={1}>
            {labels.opponentLabel}
          </Text>
          <ScoreValue score={oppScore} raceMetric={watch.race_metric} />
          <Text style={styles.liveStatus} numberOfLines={1}>
            {watch.opponent_live_status ?? ''}
          </Text>
        </View>
      </View>

      <View style={styles.splitTrack}>
        <View style={[styles.splitA, { width: `${creatorShare * 100}%` }]} />
        <View style={[styles.splitB, { width: `${(1 - creatorShare) * 100}%` }]} />
      </View>

      <View style={styles.cheerRow}>
        <CheerButton
          count={creatorCheers}
          mine={cheeredFor === watch.created_by}
          disabled={cheerDisabled}
          isFinal={isFinal}
          onPress={() =>
            setComposeFor({ userId: watch.created_by, name: watch.created_by_name, side: 'created_by' })
          }
        />
        {watch.opponent_id && (
          <CheerButton
            count={opponentCheers}
            mine={cheeredFor === watch.opponent_id}
            disabled={cheerDisabled}
            isFinal={isFinal}
            onPress={() =>
              setComposeFor({
                userId: watch.opponent_id!,
                name: watch.opponent_name ?? 'them',
                side: 'opponent',
              })
            }
          />
        )}
      </View>

      {isFinal && <Text style={styles.finalNote}>Final · this challenge has ended</Text>}

      <CheerWall
        challengeId={challengeId}
        version={notesVersion}
        nameFor={(userId) =>
          userId === watch.created_by ? labels.createdByLabel : labels.opponentLabel
        }
      />

      {composeFor ? (
        <CheerComposer
          forName={composeFor.name}
          busy={Boolean(cheering)}
          onCancel={() => setComposeFor(null)}
          onSend={(note) => handleCheer(composeFor.userId, composeFor.side, note)}
        />
      ) : null}
    </ScrollView>
  );
}

function GroupWatch({ challengeId }: { challengeId: string }) {
  const { session } = useAuth();
  const { rows, loading, error, refetch } = useGroupChallengeWatch(challengeId);
  // Same shape as the duel's: the composer target held whole so the sheet can title itself, and
  // the server's absolute count held only until the next poll catches up.
  const [composeFor, setComposeFor] = useState<{ userId: string; name: string } | null>(null);
  const [cheering, setCheering] = useState(false);
  const [cheeredCount, setCheeredCount] = useState<{ userId: string; count: number } | null>(null);

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.coral} />
      </View>
    );
  }
  if (error || rows.length === 0) {
    return <EmptyState emoji="👀" title="Can't watch this one" body={error ?? 'This challenge has ended or you no longer have access.'} />;
  }

  const head = rows[0];
  // A PLACEMENT RACE HAS NO TARGET (mock 114, 0126). Its rows carry a metric score, not a count of
  // lock-ins, so there is no denominator to draw a meter against and no "done" state to reach —
  // only a position. Without this branch `target_count` (null by constraint) would coerce to 0,
  // Math.max would rescue the divisor to 1, and every racer would render as permanently finished.
  const placement = head.shape === 'placement';
  // Guard the divisor, not the display: a 0 would turn every meter into NaN% and silently blank
  // the list rather than fail loudly.
  const target = Math.max(1, head.target_count ?? 1);

  // Deterministic order. get_group_challenge_watch (0056) sorts `by member_progress desc` only, so
  // members on the same count come back in whatever order the planner happened to produce, which
  // can differ between polls and make the list reshuffle while nothing has actually changed. Name
  // is the tiebreak because it is the one key that does not move mid-race.
  // 0170 §3 · ANONYMOUS RACERS SINK TO THE BOTTOM, and they sort on nothing else — their figure
  // is null precisely because where they stand is the thing being withheld. The rest of the order
  // is unchanged: progress desc, then name as the tiebreak, because name is the one key that does
  // not move mid-race.
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.is_anonymous) - Number(b.is_anonymous) ||
      (b.member_progress ?? 0) - (a.member_progress ?? 0) ||
      a.member_name.localeCompare(b.member_name),
  );

  // Everyone whose figure this viewer is allowed to read. The leader, the ranks and the share
  // meters are all computed over THIS list rather than over `sorted`, so an anonymous racer never
  // becomes the denominator of a bar nobody can see the numerator of.
  const named = sorted.filter((r) => !r.is_anonymous);

  // Nobody leads a race nobody has started. Crowning row 0 while everyone sits at 0 invents a
  // leader the same way the phantom 0-0 duel did (0097) — the sort still has to put someone first,
  // but first-in-a-tie is not winning. When several genuinely share the top count they all wear
  // it; picking one of them would be the client deciding the result.
  //
  // 🔴 An anonymous racer may genuinely be ahead of everyone here. This crown means "leads the
  // racers you can see", which is the honest claim and is the whole intrigue of §3 — the hidden
  // runner could be anywhere, even about to win.
  const top = named[0]?.member_progress ?? 0;
  const isLeading = (progress: number | null) => progress !== null && top > 0 && progress === top;

  // Competition ranking (1, 1, 3) rather than row position. Numbering tied members 1, 2 down the
  // column asserts a gap the scores do not contain. Null for an anonymous racer: they HAVE a
  // position, and not showing it is the point.
  const rankOf = (index: number): number | null => {
    const row = sorted[index];
    if (row.is_anonymous) return null;
    return named.findIndex((r) => r.member_progress === row.member_progress) + 1;
  };

  // Read-only once settled (CHALLENGE_UI_SPEC §58), and a racer can't cheer their own race. Both
  // are re-checked by cheer_challenge; this only stops the screen offering an action that cannot
  // succeed. `iAmRacing` is derived from the roster the RPC returns — since 0112 that IS the field,
  // so being in the campfire no longer implies being in the race.
  const isFinal = head.status !== 'active';
  const iAmRacing = rows.some((r) => r.member_id === session?.user.id);
  const spentCheer = rows.some((r) => r.cheered_by_me) || cheeredCount !== null;
  const cheerDisabled = cheering || isFinal || iAmRacing || spentCheer;

  async function handleCheer(forUserId: string, note: string) {
    if (cheering) return;
    setCheering(true);
    try {
      const count = await cheerChallenge(challengeId, forUserId, note);
      setCheeredCount({ userId: forUserId, count });
      setComposeFor(null);
      // The roster's own counts move too, so pull the authoritative row set rather than patching
      // one number and letting the rest go stale.
      refetch();
    } catch {
      // Sheet stays open on failure — closing it would throw away what they typed for an error
      // they never saw. The next poll corrects a stale screen.
    } finally {
      setCheering(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.goalRow}>
        <Ionicons name={placement ? 'trophy' : 'people'} size={13} color={Colors.achieverText} />
        <Text style={styles.goalText} numberOfLines={1}>
          {head.public_name?.trim() ||
            (placement ? metricLabel(head.race_metric) : `Everyone locks in ${head.target_count ?? 1}×`)}{' '}
          · {head.circle_name}
        </Text>
        <Text style={styles.timeLeft}>{challengeClockText(head.status, head.ends_at)}</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.member_id}
        contentContainerStyle={styles.groupList}
        renderItem={({ item, index }) => {
          // 0170 §3 · the anonymous row: a ghost, the word "Anonymous", no rank, no meter, no
          // figure, no live status. Deliberately still IN the list — removing them would shrink
          // the field and misrepresent the race.
          const anon = item.is_anonymous;
          const done = !anon && (item.member_progress ?? 0) >= target;
          const isMe = item.member_id === session?.user.id;
          const cheers = cheeredCount?.userId === item.member_id ? cheeredCount.count : item.member_cheers;
          const mine = item.cheered_by_me || cheeredCount?.userId === item.member_id;
          return (
            <View style={[styles.groupRow, isMe && styles.groupRowMe]}>
              <Text style={styles.groupRank}>{rankOf(index) ?? '–'}</Text>
              {anon ? (
                <View style={styles.anonAvatar}>
                  <Ionicons name="person" size={15} color={Colors.textTertiary} />
                </View>
              ) : (
                <Avatar label={item.member_name} size={30} />
              )}
              <View style={styles.groupWho}>
                <View style={styles.groupNameRow}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {item.member_name}
                  </Text>
                  {/* The vector Crown, not an emoji — same reason the podium stopped using one
                      (punchlist A2): an emoji redraws differently per OS and cannot take the gold. */}
                  {isLeading(item.member_progress) ? <Crown size={15} /> : null}
                  {anon ? <Text style={styles.anonHint}>· hidden</Text> : null}
                </View>
                {/* The meter is the point of the redesign: a bare count says how far someone has
                    got, not how far they have left. ProgressBar clamps, so an overshoot past the
                    target reads as full instead of spilling out of the track.

                    A PLACEMENT RACE GETS A SHARE BAR INSTEAD. There is no target to be a fraction
                    of, so the meter measures each racer against the LEADER — which is the only
                    ratio a ranked board actually has, and the one that answers "how far behind am
                    I". `top` is already computed above and is 0 before anyone has moved, so the
                    guard also keeps an all-zero board flat rather than NaN. */}
                {anon ? (
                  // No meter at all rather than an empty track: an empty track is a claim that
                  // they have made no progress, which is a number, which is the thing being hidden.
                  <Text style={styles.anonLine}>Racing privately</Text>
                ) : (
                  <ProgressBar
                    ratio={
                      placement
                        ? top > 0
                          ? (item.member_progress ?? 0) / top
                          : 0
                        : (item.member_progress ?? 0) / target
                    }
                    height={5}
                    fillColor={placement ? (isLeading(item.member_progress) ? Colors.ember : Colors.coral) : done ? Colors.ember : Colors.coral}
                  />
                )}
                {/* CHEER, UNDER EACH PERSON — CAMPFIRE_REDESIGN_SPEC's "cheer count under each
                    person". Cheering was duel-only until 0112 (cheer_challenge refused anyone who
                    wasn't created_by/opponent_id), so this row had a live status and nothing else.
                    A racer sees the count without a button: their own race is not theirs to back. */}
                <View style={styles.groupUnder}>
                  <Text style={styles.groupStatus} numberOfLines={1}>
                    {/* Null for an anonymous racer - "locked in 20m ago" is activity, and activity
                        is exactly what Private mode withholds. */}
                    {item.member_live_status ?? ''}
                  </Text>
                  {isMe || cheerDisabled ? (
                    cheers > 0 || mine ? (
                      <View style={styles.groupCheerCount}>
                        <Ionicons
                          name={mine ? 'megaphone' : 'megaphone-outline'}
                          size={11}
                          color={mine ? Colors.ember : Colors.textTertiary}
                        />
                        <Text style={[styles.groupCheerText, mine && styles.groupCheerTextMine]}>{cheers}</Text>
                      </View>
                    ) : null
                  ) : (
                    <Pressable
                      style={styles.groupCheerBtn}
                      onPress={() => setComposeFor({ userId: item.member_id, name: item.member_name })}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={`Cheer ${item.member_name} · ${cheers} cheers`}>
                      <Ionicons name="megaphone-outline" size={11} color={Colors.ember} />
                      <Text style={styles.groupCheerText}>{cheers > 0 ? `Cheer · ${cheers}` : 'Cheer'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              {/* "12h 30m", not "45000/1" — a placement race's figure is a metric in its own
                  units, and there is no denominator to print beside it. */}
              <Text style={[styles.groupProgress, (placement ? isLeading(item.member_progress) : done) && styles.groupProgressDone]}>
                {anon
                  ? '–'
                  : placement
                    ? formatMetricValue(head.race_metric, item.member_progress ?? 0)
                    : `${item.member_progress ?? 0}/${target}`}
              </Text>
            </View>
          );
        }}
      />

      {composeFor ? (
        <CheerComposer
          forName={composeFor.name}
          busy={cheering}
          onCancel={() => setComposeFor(null)}
          onSend={(note) => handleCheer(composeFor.userId, note)}
        />
      ) : null}
    </View>
  );
}

// The live challenge spectator view (PHILOI_UI_SPEC.md §16) — opened from a campfire's
// active-challenge marker or a friend's profile Watch CTA (both already access-gated before
// linking here; get_challenge_watch/get_group_challenge_watch re-check independently). Never
// shows camera/private session content — only the challenge numbers already shared.
export default function WatchScreen() {
  const { challengeId, mode } = useLocalSearchParams<{ challengeId: string; mode?: string }>();

  useEffect(() => {
    if (challengeId) track('challenge_watch_opened', { challenge_id: challengeId, mode: mode === 'group' ? 'group' : 'h2h' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per mount, not on every param identity change
  }, [challengeId]);

  if (!challengeId) return null;

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Watch' }} />
      {mode === 'group' ? <GroupWatch challengeId={challengeId} /> : <H2HWatch challengeId={challengeId} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.six,
  },
  container: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  goalText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.achieverText,
  },
  timeLeft: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  matchup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  competitor: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  competitorName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    maxWidth: 110,
  },
  score: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 16,
    color: Colors.ink,
  },
  liveStatus: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    maxWidth: 120,
  },
  vs: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  splitTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  splitA: {
    backgroundColor: Colors.coral,
  },
  splitB: {
    backgroundColor: Colors.trackAlt,
  },
  cheerRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  cheerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.button,
    paddingVertical: Spacing.two,
  },
  // The side this viewer backed: an ember rim, so "who am I behind" is legible at a glance rather
  // than inferable only from which count moved.
  cheerBtnMine: {
    borderWidth: 1,
    borderColor: Colors.ember,
  },
  // Spent / settled / competing. Kept fully opaque — this is still a readable count, and dimming
  // it to 0.4 would make the number itself hard to read for the rest of the challenge.
  cheerBtnDisabled: {
    backgroundColor: Colors.disabled,
  },
  cheerText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ember,
  },
  cheerTextDisabled: {
    color: Colors.textTertiary,
  },
  finalNote: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
    letterSpacing: 0.3,
  },
  groupList: {
    gap: 2,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  groupRowMe: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: Colors.coral,
  },
  groupRank: {
    width: 18,
    textAlign: 'center',
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  // 0170 §3 · the anonymous racer's ghost, in place of their avatar. A generic glyph rather than
  // a blurred/greyed real avatar: a blur still leaks the shape and colour of the photo.
  anonAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
  },
  anonHint: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
  },
  anonLine: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  groupWho: {
    flex: 1,
    minWidth: 0,
  },
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: 3,
  },
  groupName: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  groupStatus: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  // The strip under each meter: live status on the left, this racer's cheers on the right.
  groupUnder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: 2,
  },
  groupCheerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  groupCheerCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  groupCheerText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.ember,
  },
  groupCheerTextMine: {
    color: Colors.ember,
  },
  groupProgress: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  groupProgressDone: {
    color: Colors.ember,
  },
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(9,7,14,0.55)',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.four,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.lineStrong,
    marginBottom: Spacing.three,
  },
  sheetTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ink,
  },
  sheetSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
    marginBottom: Spacing.three,
  },
  noteInput: {
    minHeight: 76,
    maxHeight: 140,
    borderRadius: Radius.input,
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.ink,
    textAlignVertical: 'top',
  },
  noteCount: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    marginTop: Spacing.three,
    paddingVertical: Spacing.twelve,
    borderRadius: Radius.button,
    backgroundColor: Colors.ember,
  },
  sendBtnBusy: {
    opacity: 0.6,
  },
  sendText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  wall: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  wallRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  wallBody: {
    flex: 1,
    minWidth: 0,
  },
  wallWho: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.muted,
  },
  wallFor: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
  },
  wallNote: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
    marginTop: 1,
  },
});
