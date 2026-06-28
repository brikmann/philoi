import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

type EmptyStateProps = {
  emoji?: string;
  title: string;
  body: string;
  action?: React.ReactNode;
};

export function EmptyState({ emoji = '🔥', title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  emoji: {
    fontSize: 40,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.muted,
    textAlign: 'center',
  },
});
