import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

export function Card({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: Spacing.three,
  },
});
