import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Crown } from '@/components/ui/crown';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useChallengeWatch, useGroupChallengeWatch } from '@/hooks/use-challenge-watch';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/auth/auth-context';
import { cheerChallenge } from '@/lib/api/leaderboard-social';
import { formatTimeLeft } from '@/lib/format';

const RACE_METRIC_LABEL: Record<string, string> = { xp: 'Most XP', lockin_time: 'Most lock-in time' };

function ScoreValue({ score, raceMetric }: { score: number; raceMetric: string }) {
  return <Text style={styles.score}>{Math.round(score)}{raceMetric === 'lockin_time' ? 's' : ' XP'}</Text>;
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

function H2HWatch({ challengeId }: { challengeId: string }) {
  const { session } = useAuth();
  const { watch, loading, error } = useChallengeWatch(challengeId);
  const [cheering, setCheering] = useState<string | null>(null);
  // The server's count for whichever side this viewer cheered, held only until the next poll
  // catches up. NOT a delta added on top of the polled value — that was the old shape, and it
  // double-counted the moment the poll included the cheer, then dropped when the delta reset
  // (the "7 → 0"). An absolute value can only ever be right or briefly stale.
  const [cheeredCount, setCheeredCount] = useState<{ side: 'created_by' | 'opponent'; count: number } | null>(null);

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

  async function handleCheer(forUserId: string, side: 'created_by' | 'opponent') {
    if (cheering) return;
    setCheering(forUserId);
    try {
      const count = await cheerChallenge(challengeId, forUserId);
      setCheeredCount({ side, count });
    } catch {
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
    <View style={styles.container}>
      <View style={styles.goalRow}>
        <Ionicons name="flash" size={13} color={Colors.achieverText} />
        <Text style={styles.goalText}>{RACE_METRIC_LABEL[watch.race_metric] ?? 'Race'}</Text>
        <Text style={styles.timeLeft}>{watch.ends_at ? formatTimeLeft(watch.ends_at) : ''}</Text>
      </View>

      <View style={styles.matchup}>
        <View style={styles.competitor}>
          <Avatar label={watch.created_by_name} size={44} lit={isCreator} />
          <Text style={styles.competitorName} numberOfLines={1}>
            {watch.created_by_name}
          </Text>
          <ScoreValue score={myScore} raceMetric={watch.race_metric} />
          <Text style={styles.liveStatus} numberOfLines={1}>
            {watch.created_by_live_status}
          </Text>
        </View>
        <Text style={styles.vs}>vs</Text>
        <View style={styles.competitor}>
          <Avatar label={watch.opponent_name ?? '?'} size={44} lit={!isCreator} />
          <Text style={styles.competitorName} numberOfLines={1}>
            {watch.opponent_name ?? 'Waiting…'}
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
          onPress={() => handleCheer(watch.created_by, 'created_by')}
        />
        {watch.opponent_id && (
          <CheerButton
            count={opponentCheers}
            mine={cheeredFor === watch.opponent_id}
            disabled={cheerDisabled}
            isFinal={isFinal}
            onPress={() => handleCheer(watch.opponent_id!, 'opponent')}
          />
        )}
      </View>

      {isFinal && <Text style={styles.finalNote}>Final · this challenge has ended</Text>}
    </View>
  );
}

function GroupWatch({ challengeId }: { challengeId: string }) {
  const { session } = useAuth();
  const { rows, loading, error } = useGroupChallengeWatch(challengeId);

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
  // Guard the divisor, not the display: target_count is int not null upstream, but a 0 would turn
  // every meter into NaN% and silently blank the list rather than fail loudly.
  const target = Math.max(1, head.target_count);

  // Deterministic order. get_group_challenge_watch (0056) sorts `by member_progress desc` only, so
  // members on the same count come back in whatever order the planner happened to produce, which
  // can differ between polls and make the list reshuffle while nothing has actually changed. Name
  // is the tiebreak because it is the one key that does not move mid-race.
  const sorted = [...rows].sort(
    (a, b) => b.member_progress - a.member_progress || a.member_name.localeCompare(b.member_name),
  );

  // Nobody leads a race nobody has started. Crowning row 0 while everyone sits at 0 invents a
  // leader the same way the phantom 0-0 duel did (0097) — the sort still has to put someone first,
  // but first-in-a-tie is not winning. When several genuinely share the top count they all wear
  // it; picking one of them would be the client deciding the result.
  const top = sorted[0].member_progress;
  const isLeading = (progress: number) => top > 0 && progress === top;

  // Competition ranking (1, 1, 3) rather than row position. Numbering tied members 1, 2 down the
  // column asserts a gap the scores do not contain.
  const rankOf = (index: number) =>
    sorted.findIndex((r) => r.member_progress === sorted[index].member_progress) + 1;

  return (
    <View style={styles.container}>
      <View style={styles.goalRow}>
        <Ionicons name="people" size={13} color={Colors.achieverText} />
        <Text style={styles.goalText}>
          Everyone locks in {head.target_count}× · {head.circle_name}
        </Text>
        <Text style={styles.timeLeft}>{head.ends_at ? formatTimeLeft(head.ends_at) : ''}</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.member_id}
        contentContainerStyle={styles.groupList}
        renderItem={({ item, index }) => {
          const done = item.member_progress >= target;
          return (
            <View style={[styles.groupRow, item.member_id === session?.user.id && styles.groupRowMe]}>
              <Text style={styles.groupRank}>{rankOf(index)}</Text>
              <Avatar label={item.member_name} size={30} />
              <View style={styles.groupWho}>
                <View style={styles.groupNameRow}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {item.member_name}
                  </Text>
                  {/* The vector Crown, not an emoji — same reason the podium stopped using one
                      (punchlist A2): an emoji redraws differently per OS and cannot take the gold. */}
                  {isLeading(item.member_progress) ? <Crown size={15} /> : null}
                </View>
                {/* The meter is the point of the redesign: a bare count says how far someone has
                    got, not how far they have left. ProgressBar clamps, so an overshoot past the
                    target reads as full instead of spilling out of the track. */}
                <ProgressBar
                  ratio={item.member_progress / target}
                  height={5}
                  fillColor={done ? Colors.ember : Colors.coral}
                />
                <Text style={styles.groupStatus} numberOfLines={1}>
                  {item.member_live_status}
                </Text>
              </View>
              <Text style={[styles.groupProgress, done && styles.groupProgressDone]}>
                {item.member_progress}/{target}
              </Text>
            </View>
          );
        }}
      />
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
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
  },
  groupProgress: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  groupProgressDone: {
    color: Colors.ember,
  },
});
