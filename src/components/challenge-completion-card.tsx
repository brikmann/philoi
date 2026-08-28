import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { DisciplineIcon } from '@/components/ui/discipline-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { FeedChallengeEvent } from '@/lib/api/challenges';
import { formatRelativeTime } from '@/lib/format';
import { CHALLENGE_TYPE_GLYPH } from '@/lib/goal-types';

export function ChallengeCompletionCard({ event }: { event: FeedChallengeEvent }) {
  const goal = event.challenge_label ?? `${event.target.toLocaleString()} ${event.unit}`;
  return (
    <Card style={styles.card}>
      <DisciplineIcon name={CHALLENGE_TYPE_GLYPH[event.challenge_type]} size={17} color={Colors.ember} />
      <View style={styles.body}>
        {event.is_completion ? (
          <Text style={styles.text}>
            <Text style={styles.name}>{event.profiles.display_name}</Text> hit their {goal} challenge 🎉
          </Text>
        ) : (
          <Text style={styles.text}>
            <Text style={styles.name}>{event.profiles.display_name}</Text> logged +
            {(event.amount ?? 0).toLocaleString()} {event.unit} toward {goal}
            {event.progress != null && ` (${event.progress.toLocaleString()}/${event.target.toLocaleString()})`}
          </Text>
        )}
        <Text style={styles.time}>{formatRelativeTime(event.created_at)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.achieverBg,
    borderColor: Colors.achieverBg,
  },
  icon: {
    fontSize: 22,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  text: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  name: {
    fontFamily: Fonts.bodyBold,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
});
