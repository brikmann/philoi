import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// Cindy's speech bubble on Home (mock 115 frame 1) — a tail-down card sitting above her flame.
//
// The tail is a rotated square rather than an SVG triangle: RN has no CSS borders trick, and a
// 45°-rotated View with two matching edges is the one approach that keeps the 1px border
// continuous around the corner. Overlapped by 1px so the bubble's own bottom edge hides the
// square's top two sides.
const TAIL = 14;

export function CindyBubble({
  message,
  onPress,
  onDismiss,
}: {
  message: string;
  onPress: () => void;
  onDismiss: () => void;
}) {
  return (
    <Animated.View entering={FadeIn.duration(320)} style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={styles.bubble}
        accessibilityRole="button"
        accessibilityLabel={`Cindy says: ${message}. Tap to reply.`}>
        <View style={styles.head}>
          <Ionicons name="flame" size={11} color={Colors.amber} />
          <Text style={styles.who}>CINDY</Text>
          <View style={styles.spacer} />
          {/* Dismiss is deliberately small and unlabelled-looking: the bubble is a friend
              talking, and a prominent close button would frame it as an ad to get rid of. */}
          <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Dismiss Cindy's message">
            <Ionicons name="close" size={13} color={Colors.textTertiary} />
          </Pressable>
        </View>
        <Text style={styles.message}>{message}</Text>
      </Pressable>
      <View style={styles.tail} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    maxWidth: 280,
    marginBottom: Spacing.three,
  },
  bubble: {
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.twelve,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  who: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.amber,
  },
  spacer: { flex: 1, minWidth: Spacing.three },
  message: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink,
  },
  tail: {
    width: TAIL,
    height: TAIL,
    marginTop: -1,
    // Offset left so the tail points down at the flame's shoulder rather than its centre —
    // a tail dead-centre reads as a label pinned to the flame, not as speech coming from it.
    marginRight: 120,
    backgroundColor: Colors.selectedBg,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    transform: [{ rotate: '45deg' }],
  },
});
