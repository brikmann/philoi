import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

type EmptyStateProps = {
  /** The bespoke glyph over the title. Defaults to the brand flame. */
  glyph?: IconName;
  /** The glyph's tint. Defaults to ember. */
  glyphColor?: string;
  /** Overrides the glyph with a custom graphic (e.g. a dim FlameSvg) — used when a single icon
   * doesn't carry enough of the brand's own visual identity for the moment. */
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
};

export function EmptyState({ glyph = 'flame', glyphColor = Colors.ember, icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ?? <Icon name={glyph} size={44} color={glyphColor} />}
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
