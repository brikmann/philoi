import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

type EmptyStateProps = {
  emoji?: string;
  /** Overrides the emoji with a custom graphic (e.g. a dim FlameSvg) — used when a plain emoji
   * doesn't carry enough of the brand's own visual identity for the moment. */
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
};

export function EmptyState({ emoji = '🔥', icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ?? <Text style={styles.emoji}>{emoji}</Text>}
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
