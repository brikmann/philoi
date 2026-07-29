import { StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type ProgressBarProps = {
  ratio: number;
  height?: number;
  trackColor?: string;
  fillColor?: string;
};

export function ProgressBar({ ratio, height = 6, trackColor = Colors.disabled, fillColor = Colors.coral }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height / 2 }]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fillColor, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: Radius.pill,
  },
  fill: {
    height: '100%',
  },
});
