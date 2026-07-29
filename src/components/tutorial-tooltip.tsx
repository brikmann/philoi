import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type TutorialTooltipProps = {
  visible: boolean;
  text: string;
  /** Omit to make the tooltip non-dismissible by tap — it clears only when the caller's
   * real action happens (see lock-in.tsx's second step, which only clears on Stop). */
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
};

// From-scratch, Reanimated-only — no coach-mark/tooltip library exists in this repo. Renders
// inline in normal layout flow next to whatever it's meant to point at (the caller places it
// directly above/below the real element in JSX) rather than an absolute-position overlay with
// onLayout arrow-math — simpler, and robust across screen sizes.
export function TutorialTooltip({ visible, text, onDismiss, style }: TutorialTooltipProps) {
  if (!visible) return null;

  const content = (
    <Animated.View entering={FadeInDown.springify().damping(14)} exiting={FadeOutUp.duration(200)} style={[styles.bubble, style]}>
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );

  if (!onDismiss) return content;

  return <Pressable onPress={onDismiss}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'center',
    backgroundColor: Colors.plum,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    maxWidth: 260,
  },
  text: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.cream,
    fontSize: 13,
    textAlign: 'center',
  },
});
