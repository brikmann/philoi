import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { FeedChallengeEvent } from '@/lib/api/challenges';
import type { ChallengeType } from '@/types/database';

const TYPE_ICON: Record<ChallengeType, string> = {
  steps: '👟',
  run_distance: '🏃',
  ride_distance: '🚴',
  gym_visits: '🏋️',
  study_hours: '📚',
  custom: '🎯',
  workout_minutes: '⏱️',
  strain: '💪',
  sleep_hours: '😴',
};

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ChallengeCompletionCard({ event }: { event: FeedChallengeEvent }) {
  const goal = event.challenge_label ?? `${event.target.toLocaleString()} ${event.unit}`;
  return (
    <Card style={styles.card}>
      <Text style={styles.icon}>{TYPE_ICON[event.challenge_type]}</Text>
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
