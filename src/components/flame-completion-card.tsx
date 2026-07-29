import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { FlameCompletionFeedItem } from '@/lib/api/daily-fire';

function formatRelativeTime(isoDate: string) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The opt-in "I completed my fire today" chain event (PHILOI_UI_SPEC.md §5, design-mocks/26)
// — like a lock-in event card, but for the daily flame meter rather than a single session.
export function FlameCompletionCard({ item }: { item: FlameCompletionFeedItem }) {
  return (
    <Card style={styles.card}>
      <View style={styles.icon}>
        <Ionicons name="flame" size={16} color={Colors.amber} />
      </View>
      <View style={styles.body}>
        <Text style={styles.text}>
          <Text style={styles.name}>{item.display_name}</Text> completed their fire today 🔥
        </Text>
        <Text style={styles.time}>{formatRelativeTime(item.posted_at)}</Text>
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
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
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
