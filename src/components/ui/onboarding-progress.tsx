import { StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

type OnboardingProgressProps = {
  /** 1-indexed current step; segments up to and including this one fill. */
  step: number;
  total?: number;
};

export function OnboardingProgress({ step, total = 3 }: OnboardingProgressProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.dot, i < step && styles.dotOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
  },
  dotOn: {
    backgroundColor: Colors.coral,
  },
});
