import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type ChipProps = {
  label: string;
  tone?: 'achiever' | 'cold' | 'solo' | 'pro' | 'neutral';
};

// Roaring / Going cold / Solo — the exact 3-state chip from PHILOI_UI_SPEC.md §7.
// `pro`/`neutral` are extra tones for call sites outside that spec'd trio.
const TONE_STYLES = {
  achiever: { backgroundColor: Colors.achieverBg, color: Colors.achieverText },
  cold: { backgroundColor: Colors.coldChipBg, color: Colors.coldChipText },
  solo: { backgroundColor: Colors.disabled, color: Colors.soloChipText },
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
