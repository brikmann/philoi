import * as Haptics from 'expo-haptics';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { CampfireFlame } from '@/components/campfire-flame';
import { Card } from '@/components/ui/card';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import type { MyGroup } from '@/lib/api/groups';

const TRASH_ZONE_Y = Dimensions.get('window').height - 170;

type GroupCardProps = {
  group: MyGroup;
  onOpen: () => void;
  /** 0-1, defaults to 0 (unlit) while heat is still loading — see useCampfireHeat(). */
  heat?: number;
  /** Fires when a long-press-then-drag begins/ends — lets the screen show/hide the trash target. */
  onDragStateChange?: (dragging: boolean) => void;
  /** Fires continuously while dragging, true once past the trash drop zone — drives the trash icon's "hot" state. */
  onHoverTrashChange?: (overTrash: boolean) => void;
  /** Fires once, on release, if the card was dropped on the trash. */
  onDropOnTrash?: () => void;
};

// Circles are pure social containers now (feed/chat/leaderboard) — no streak, no
// check-in action here; checking in happens goal-first from the home tab. The living-flame
// heat gauge (UI_REDESIGN_SPEC.md) is the one activity signal shown here.
export function GroupCard({
  group,
  onOpen,
  heat = 0,
  onDragStateChange,
  onHoverTrashChange,
  onDropOnTrash,
}: GroupCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const pan = Gesture.Pan()
    .activateAfterLongPress(400)
    .onStart(() => {
      scale.value = withSpring(1.04);
      if (onDragStateChange) runOnJS(onDragStateChange)(true);
      runOnJS(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      })();
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
      if (onHoverTrashChange) runOnJS(onHoverTrashChange)(e.absoluteY > TRASH_ZONE_Y);
    })
    .onEnd((e) => {
      if (e.absoluteY > TRASH_ZONE_Y && onDropOnTrash) {
        runOnJS(onDropOnTrash)();
      }
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      scale.value = withSpring(1);
      if (onDragStateChange) runOnJS(onDragStateChange)(false);
      if (onHoverTrashChange) runOnJS(onHoverTrashChange)(false);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>
        <Pressable onPress={onOpen}>
          <Card style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.emoji}>{group.emoji}</Text>
              <View style={styles.headerText}>
                <Text style={styles.name}>{group.name}</Text>
                <Text style={styles.cadence}>{group.cadence}</Text>
              </View>
              <CampfireFlame heat={heat} size={22} />
            </View>
          </Card>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 28,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.ink,
  },
  cadence: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
});
