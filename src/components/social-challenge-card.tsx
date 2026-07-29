import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/ui/avatar';
import { respondToH2HChallenge } from '@/lib/api/social-challenges';
import { getErrorMessage } from '@/lib/errors';
import type { SocialChallenge } from '@/types/database';

function formatTimeLeft(endsAt: string | null): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ending soon';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h left`;
  return `${Math.ceil(hours / 24)}d left`;
}

type SocialChallengeCardProps = {
  challenge: SocialChallenge;
  myUserId: string;
  onChanged: () => void;
};

export function SocialChallengeCard({ challenge: c, myUserId, onChanged }: SocialChallengeCardProps) {
  const isInvite = c.mode === 'h2h' && c.status === 'pending' && c.opponent_id === myUserId;
  const isMine = c.created_by === myUserId;
  const otherName = isMine ? (c.opponent_name ?? 'them') : c.created_by_name;

  async function handleRespond(accept: boolean) {
    try {
      await respondToH2HChallenge(c.id, accept);
      onChanged();
    } catch (e) {
      Alert.alert('Something went wrong', getErrorMessage(e, 'Could not respond to this challenge.'));
    }
  }

  if (isInvite) {
    return (
      <View style={[styles.card, styles.cardInvite]}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.clock}>{c.created_by_name} challenged you</Text>
        </View>
        <Text style={styles.title}>
          {c.race_metric === 'lockin_time' ? 'Lock-in time race' : 'XP race'} · who earns more in {c.window_hours}h
        </Text>
        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>winner +{c.payout_xp} XP</Text>
        </View>
        <View style={styles.actsRow}>
          <Pressable style={styles.acceptBtn} onPress={() => handleRespond(true)}>
            <Text style={styles.acceptLabel}>Accept</Text>
          </Pressable>
          <Pressable style={styles.declineBtn} onPress={() => handleRespond(false)}>
            <Text style={styles.declineLabel}>Decline</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (c.mode === 'h2h') {
    const myScore = c.my_score ?? 0;
    const oppScore = c.opponent_score ?? 0;
    const total = myScore + oppScore;
    const myShare = total > 0 ? myScore / total : 0.5;
    const ahead = c.status === 'completed' ? c.winner_id === myUserId : myScore > oppScore;
    const tied = myScore === oppScore;

    return (
      <View style={styles.card}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            <Ionicons name="flash" size={12} color={Colors.achieverText} />
            <Text style={styles.labelText}>Head-to-head</Text>
          </View>
          <Text style={styles.clock}>
            {c.status === 'completed' ? 'finished' : formatTimeLeft(c.ends_at)}
          </Text>
        </View>
        <View style={styles.vsRow}>
          <View style={styles.who}>
            <Avatar label="You" size={30} lit />
            <View>
              <Text style={styles.whoName}>You</Text>
              <Text style={styles.whoScore}>{Math.round(myScore)} {c.race_metric === 'lockin_time' ? 's' : 'XP'}</Text>
            </View>
          </View>
          <Text style={styles.vsText}>vs</Text>
          <View style={[styles.who, styles.whoRight]}>
            <View>
              <Text style={[styles.whoName, styles.whoNameRight]}>{otherName}</Text>
              <Text style={[styles.whoScore, styles.whoScoreRight]}>{Math.round(oppScore)} {c.race_metric === 'lockin_time' ? 's' : 'XP'}</Text>
            </View>
            <Avatar label={otherName ?? '?'} size={30} textColor={Colors.soloChipText} />
          </View>
        </View>
        <View style={styles.splitTrack}>
          <View style={[styles.splitA, { width: `${myShare * 100}%` }]} />
          <View style={[styles.splitB, { width: `${(1 - myShare) * 100}%` }]} />
        </View>
        <View style={styles.footRow}>
          <Ionicons name="trophy" size={12} color={Colors.achieverText} />
          <Text style={styles.footText}>
            winner +{c.payout_xp} XP{total > 0 ? ` · ${tied ? "it's tied" : ahead ? "you're ahead" : `${otherName} is ahead`}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  // group — the only remaining mode besides h2h
  const memberCount = c.member_count ?? 0;
  const completedCount = c.completed_count ?? 0;
  const dots = Array.from({ length: memberCount }, (_, i) => i < completedCount);
  return (
    <View style={styles.card}>
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          <Ionicons name="people" size={12} color={Colors.achieverText} />
          <Text style={styles.labelText}>Group · all or nothing</Text>
        </View>
        <Text style={styles.clock}>{c.status === 'completed' ? 'finished' : formatTimeLeft(c.ends_at)}</Text>
      </View>
      <Text style={styles.title}>
        Everyone locks in {c.target_count}× this {c.window_hours >= 168 ? 'week' : 'window'}
      </Text>
      <View style={styles.dotsRow}>
        {dots.map((on, i) => (
          <View key={i} style={[styles.dot, on && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.footRow}>
        <Ionicons name="trophy" size={12} color={Colors.achieverText} />
        <Text style={styles.footText}>
          {completedCount} of {memberCount} done · up to +{c.payout_xp} XP each (more for top finishers) if everyone finishes
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  cardInvite: {
    borderWidth: 1,
    borderColor: Colors.coral,
    backgroundColor: Colors.selectedBg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  labelText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.achieverText,
  },
  clock: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  who: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  whoRight: {
    flexDirection: 'row-reverse',
  },
  whoName: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  whoNameRight: {
    textAlign: 'right',
  },
  whoScore: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  whoScoreRight: {
    textAlign: 'right',
  },
  vsText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
  },
  splitTrack: {
    flexDirection: 'row',
    height: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
    marginTop: Spacing.two,
  },
  splitA: {
    backgroundColor: Colors.coral,
  },
  splitB: {
    backgroundColor: Colors.trackAlt,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 5,
    marginVertical: Spacing.two,
  },
  dot: {
    flex: 1,
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
  },
  dotOn: {
    backgroundColor: Colors.green,
  },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.two,
  },
  footText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.achieverText,
  },
  actsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: Colors.coral,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  acceptLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  declineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  declineLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
  },
});
