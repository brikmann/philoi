import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
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

function H2HWatch({ challengeId }: { challengeId: string }) {
  const { session } = useAuth();
  const { watch, loading, error } = useChallengeWatch(challengeId);
  const [cheering, setCheering] = useState<string | null>(null);
  const [localCheers, setLocalCheers] = useState<{ created_by?: number; opponent?: number }>({});

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
    setLocalCheers((c) => ({ ...c, [side]: (c[side] ?? 0) + 1 }));
    try {
      await cheerChallenge(challengeId, forUserId);
    } catch {
      setLocalCheers((c) => ({ ...c, [side]: (c[side] ?? 1) - 1 }));
    } finally {
      setCheering(null);
    }
  }

  const myScore = watch.created_by_score;
  const oppScore = watch.opponent_score ?? 0;
  const total = myScore + oppScore;
  const creatorShare = total > 0 ? myScore / total : 0.5;
  const creatorCheers = watch.created_by_cheers + (localCheers.created_by ?? 0);
  const opponentCheers = (watch.opponent_cheers ?? 0) + (localCheers.opponent ?? 0);
  const isCreator = session?.user.id === watch.created_by;

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
        <Pressable style={styles.cheerBtn} onPress={() => handleCheer(watch.created_by, 'created_by')} disabled={Boolean(cheering)}>
          <Ionicons name="megaphone" size={14} color={Colors.ember} />
          <Text style={styles.cheerText}>Cheer · {creatorCheers}</Text>
        </Pressable>
        {watch.opponent_id && (
          <Pressable style={styles.cheerBtn} onPress={() => handleCheer(watch.opponent_id!, 'opponent')} disabled={Boolean(cheering)}>
            <Ionicons name="megaphone" size={14} color={Colors.ember} />
            <Text style={styles.cheerText}>Cheer · {opponentCheers}</Text>
          </Pressable>
        )}
      </View>
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
  const sorted = [...rows].sort((a, b) => b.member_progress - a.member_progress);

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
        renderItem={({ item, index }) => (
          <View style={[styles.groupRow, item.member_id === session?.user.id && styles.groupRowMe]}>
            <Text style={styles.groupRank}>{index + 1}</Text>
            <Avatar label={item.member_name} size={30} />
            <View style={styles.groupWho}>
              <Text style={styles.groupName} numberOfLines={1}>
                {item.member_name}
              </Text>
              <Text style={styles.groupStatus} numberOfLines={1}>
                {item.member_live_status}
              </Text>
            </View>
            <Text style={styles.groupProgress}>{item.member_progress}×</Text>
          </View>
        )}
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
  cheerText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ember,
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
  groupName: {
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
});
