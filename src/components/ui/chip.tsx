import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type ChipProps = {
  label: string;
  tone?: 'achiever' | 'pro' | 'neutral';
};

const TONE_STYLES = {
  achiever: { backgroundColor: Colors.achieverBg, color: Colors.achieverText },
  pro: { backgroundColor: Colors.plum, color: Colors.ember },
  neutral: { backgroundColor: Colors.line, color: Colors.ink },
} as const;

export function Chip({ label, tone = 'neutral' }: ChipProps) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[styles.label, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
  },
});
