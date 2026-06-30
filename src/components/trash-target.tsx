import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type TrashTargetProps = {
  visible: boolean;
  hot: boolean;
  label: string;
};

export function TrashTarget({ visible, hot, label }: TrashTargetProps) {
  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(visible ? 1 : 0, { duration: 150 }),
      transform: [{ scale: withSpring(hot ? 1.15 : 1) }],
    }),
    [visible, hot]
  );

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, animatedStyle, hot && styles.containerHot]}>
      <Text style={styles.icon}>🗑️</Text>
      <Text style={[styles.label, hot && styles.labelHot]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: Colors.plum,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    gap: Spacing.half,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  containerHot: {
    backgroundColor: Colors.coral,
  },
  icon: {
    fontSize: 28,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.cream,
  },
  labelHot: {
    color: '#FFFFFF',
  },
});
