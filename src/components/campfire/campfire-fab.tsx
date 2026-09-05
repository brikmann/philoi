import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { EmberFill } from '@/components/ui/ember-fill';
import { PhiloiIcon, type PhiloiIconName } from '@/components/ui/philoi-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// THE + MENU (mock 101 frame 2) — "one button for everything richer than a message".
//
// The campfire-as-chat pass removes the Challenges tab and the header's lock-in pill, which is
// what makes this button necessary rather than merely convenient: every action that used to have
// its own piece of chrome now lives behind one thumb-reach control at the bottom-right, exactly
// where a Discord composer puts it.
//
// FOUR ACTIONS, and the fourth is the one that needs explaining. "Ping a member" is a SILENT
// DIRECT NUDGE — it sends a push to one person and posts nothing into the chat. That makes it a
// genuinely different act from an @mention, which is a visible message aimed at someone. The
// mock's own label carries the distinction ("· silent nudge") and so does this menu, because the
// two are one tap apart and confusing them means accidentally telling the whole fire something you
// meant to say to one person.

export type CampfireFabAction = 'photo' | 'challenge' | 'lockin' | 'ping';

const ITEMS: { key: CampfireFabAction; icon: PhiloiIconName; label: string; hint?: string; hot?: boolean }[] = [
  { key: 'photo', icon: 'camera', label: 'Post a photo' },
  // Same crossed swords as the Challenges nav row — see philoi-icon.tsx. `hot` is the mock's
  // `.dot.hot`: the one action of the four that creates something the whole campfire races in.
  { key: 'challenge', icon: 'challenges', label: 'Start a challenge', hot: true },
  { key: 'lockin', icon: 'share', label: 'Share a lock-in' },
  { key: 'ping', icon: 'bell', label: 'Ping a member', hint: '· silent nudge' },
];

/** Mock 101 stacks the items upward from just above the composer. */
const ROW_HEIGHT = 58;

/** The + itself, so the menu can be told to start above it rather than on top of it. */
const FAB_SIZE = 52;

/** Where the action stack's bottom edge sits: clear of the composer, then clear of the +. */
const MENU_LIFT = Spacing.two + FAB_SIZE + Spacing.twelve;

export function CampfireFab({
  open,
  onToggle,
  onAction,
  bottom,
}: {
  open: boolean;
  onToggle: () => void;
  onAction: (action: CampfireFabAction) => void;
  /** Where the composer's top edge is, so the stack starts above it rather than over it. */
  bottom: number;
}) {
  const reduceMotion = useReduceMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = reduceMotion
      ? open
        ? 1
        : 0
      : withTiming(open ? 1 : 0, { duration: 180, easing: Easing.out(Easing.quad) });
  }, [open, reduceMotion, t]);

  // The + becomes an × by rotating 45°, which is the mock's own transform. Cheaper than swapping
  // glyphs and it reads as the same object opening rather than as two different buttons.
  const plusStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${t.value * 45}deg` }] }));

  return (
    <>
      {open && (
        // Tap anywhere to dismiss. Sits UNDER the menu and over the feed, so a stray tap closes
        // rather than posting into the chat behind it.
        <Pressable
          style={styles.backdrop}
          onPress={onToggle}
          accessibilityLabel="Close the menu"
          accessibilityRole="button"
        />
      )}

      {open && (
        <View style={[styles.menu, { bottom: bottom + MENU_LIFT }]} pointerEvents="box-none">
          {ITEMS.map((item, i) => (
            <FabRow
              key={item.key}
              item={item}
              index={ITEMS.length - 1 - i}
              t={t}
              reduceMotion={reduceMotion}
              onPress={() => onAction(item.key)}
            />
          ))}
        </View>
      )}

      <Pressable
        style={[styles.fabPos, { bottom: bottom + Spacing.two }]}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Close the campfire menu' : 'Open the campfire menu'}
        accessibilityState={{ expanded: open }}>
        <EmberFill style={styles.fab} radius={26} direction="diagonal">
          <Animated.View style={plusStyle}>
            <Text style={styles.plus}>+</Text>
          </Animated.View>
        </EmberFill>
      </Pressable>
    </>
  );
}

function FabRow({
  item,
  index,
  t,
  reduceMotion,
  onPress,
}: {
  item: (typeof ITEMS)[number];
  index: number;
  t: SharedValue<number>;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  // Staggered by row so the stack unfurls instead of appearing as a block. The stagger is in the
  // INTERPOLATION, not in a per-row delay: one shared driver, four derived styles, so the rows can
  // never desynchronise from the + they came out of.
  const style = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: t.value, transform: [{ translateY: 0 }] };
    const start = index * 0.12;
    const k = Math.max(0, Math.min(1, (t.value - start) / (1 - start || 1)));
    return { opacity: k, transform: [{ translateY: (1 - k) * 14 }] };
  });

  return (
    <Animated.View style={[styles.row, style]}>
      <Pressable style={styles.rowPress} onPress={onPress} accessibilityRole="button" accessibilityLabel={item.label}>
        <View style={styles.label}>
          <Text style={styles.labelText}>
            {item.label}
            {item.hint ? <Text style={styles.labelHint}> {item.hint}</Text> : null}
          </Text>
        </View>
        <View style={[styles.dot, item.hot && styles.dotHot]}>
          <PhiloiIcon name={item.icon} size={20} color={Colors.ember} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,6,12,0.55)',
  },
  menu: {
    position: 'absolute',
    right: 16,
    alignItems: 'flex-end',
    gap: 12,
  },
  row: {
    height: ROW_HEIGHT - 12,
    justifyContent: 'center',
  },
  rowPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    backgroundColor: 'rgba(20,14,24,0.92)',
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 12,
  },
  labelText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  labelHint: {
    fontFamily: Fonts.body,
    color: Colors.textTertiary,
  },
  dot: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
  },
  dotHot: {
    backgroundColor: Colors.selectedBg,
    borderColor: Colors.amber,
  },
  // 🔴 D2 · THE + BELONGS BOTTOM-RIGHT, AND USED TO RENDER BOTTOM-LEFT.
  //
  // This file's own header has always said "one thumb-reach control at the bottom-right, exactly
  // where a Discord composer puts it" — and it was the only element here with NO position at all.
  // An unpositioned Pressable is an ordinary flex child of the timeline's column container, so it
  // laid out in the flow between the FlatList and the composer, stretched to full width by the
  // default `alignItems: 'stretch'`, and drew its 52px ember circle at the leading (left) edge.
  // The `bottom` prop was already being passed and was read only by the menu, which is why the
  // action stack was on the right while the button that opens it was on the left.
  //
  // Positioned absolutely against the same container the menu uses, so the two cannot drift apart
  // again: both are anchored right: 16, and MENU_LIFT is defined in terms of FAB_SIZE.
  fabPos: {
    position: 'absolute',
    right: 16,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    fontFamily: Fonts.bodyBold,
    fontSize: 28,
    lineHeight: 32,
    color: Colors.onEmber,
  },
});
