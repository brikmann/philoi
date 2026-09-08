import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE TUTORIAL'S MINI-UI KIT — design-mocks/187-tutorial.html.
//
// Every card's right-hand preview is built from these. They are DELIBERATELY NOT the real screens.
//
// 🔴 WHY NOT JUST RENDER THE REAL SCREENS, which is the obvious idea and the wrong one. The real
// Home, campfire and shop screens each pull live data, mount watchers, hit the network and — in the
// case of the flame — own a lock-in session. Embedding them in a tutorial that runs BEFORE the user
// has a campfire, a friend, a single lock-in or an ember would render a set of empty states, which
// is the exact opposite of what the tutorial is for: showing what the app looks like when it is
// full. A brand-new account has nothing to show, so the preview has to be furnished.
//
// So these are honest miniatures: the same tokens, the same shapes, the same rounding as the real
// screens, filled with a plausible campus. They are also SAFE — a tutorial cannot start a lock-in,
// spend an ember, send a duel or post to the Agora by accident, because none of these can do
// anything. That matters on a first run, where a mis-tap in a tour would be someone's first
// experience of the app doing something they did not ask for.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The phone-shaped preview surface every card draws inside. */
export function MiniScreen({
  children,
  center,
  style,
}: {
  children?: React.ReactNode;
  center?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.ms, center && styles.msCenter, style]}>{children}</View>
  );
}

/** A miniature screen header — glyph, title, optional right-hand pill. */
export function MiniHeader({ glyph, title, right }: { glyph: string; title: string; right?: string }) {
  return (
    <View style={styles.msHd}>
      <View style={styles.sq}>
        <Text style={styles.sqText}>{glyph}</Text>
      </View>
      <Text style={styles.hdTitle} numberOfLines={1}>
        {title}
      </Text>
      {right ? <Text style={styles.bal}>{right}</Text> : null}
    </View>
  );
}

/** A list row — avatar/glyph, a title, an optional second line, an optional right value. */
export function MiniRow({
  glyph,
  title,
  sub,
  right,
  accent,
  highlight,
}: {
  glyph?: string;
  title: string;
  sub?: string;
  right?: string;
  accent?: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.msRow, highlight && { borderColor: Colors.amber }]}>
      {glyph ? (
        <View style={[styles.av, accent ? { borderColor: accent } : null]}>
          <Text style={styles.avText}>{glyph}</Text>
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.t1} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.t2} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ? <Text style={styles.rowRight}>{right}</Text> : null}
    </View>
  );
}

/** The amber CTA inside a preview. Inert — see the header. */
export function MiniButton({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.msBtn, style]}>
      <Text style={styles.msBtnText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A rarity-bordered square — a cosmetic, a crate, an inventory slot. */
export function MiniTile({
  glyph,
  color,
  size = 34,
  faceDown,
}: {
  glyph: string;
  color: string;
  size?: number;
  faceDown?: boolean;
}) {
  return (
    <View
      style={[
        styles.msTile,
        {
          width: size,
          height: size,
          borderColor: faceDown ? '#3a2c58' : color,
          borderRadius: Math.round(size * 0.28),
        },
      ]}>
      <Text style={{ fontSize: Math.round(size * 0.46), opacity: faceDown ? 0.35 : 1 }}>{glyph}</Text>
    </View>
  );
}

/** A muted caption line. */
export function MiniMuted({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.msMut, color ? { color, fontFamily: Fonts.bodyBold } : null]}>{children}</Text>;
}

/** A chat bubble. `me` flips it to the sender's side. */
export function MiniBubble({ text, me }: { text: string; me?: boolean }) {
  return (
    <View style={[styles.bub, me && styles.bubMe]}>
      <Text style={styles.bubText}>{text}</Text>
    </View>
  );
}

/** A gradient-ish banner/media block with a label. */
export function MiniBanner({
  label,
  colors,
  height = 58,
}: {
  label: string;
  colors: [string, string];
  height?: number;
}) {
  return (
    <View style={[styles.banner, { height, backgroundColor: colors[0], borderColor: colors[1] }]}>
      <View style={[styles.bannerWash, { backgroundColor: colors[1] }]} />
      <Text style={styles.bannerLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A progress bar. */
export function MiniBar({ pct, color = Colors.amber }: { pct: number; color?: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }]} />
    </View>
  );
}

/** A settings toggle, on or off. */
export function MiniToggle({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={styles.tog}>
      <Text style={styles.togLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.sw, on && styles.swOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </View>
  );
}

/** Tabs across the top of a mini board. */
export function MiniTabs({ names, active }: { names: string[]; active: number }) {
  return (
    <View style={styles.tabs}>
      {names.map((n, i) => (
        <View key={n} style={[styles.tab, i === active && styles.tabOn]}>
          <Text style={[styles.tabText, i === active && styles.tabTextOn]} numberOfLines={1}>
            {n}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A small outlined pill. */
export function MiniChip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The pulsing "👆 tap" hint that tells the user this preview is playable.
 *
 * Only rendered on cards that HAVE a next step. A hint pointing at nothing teaches the user that
 * the hint means nothing, and after that they stop tapping the ones that matter.
 */
export function TapHint({ label = 'tap' }: { label?: string }) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 620, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.65 + pulse.value * 0.35,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));

  return (
    <Animated.View style={[styles.tapHint, style]} pointerEvents="none">
      <Text style={styles.tapHintText}>👆 {label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ms: {
    flex: 1,
    backgroundColor: '#171023',
    borderWidth: 1,
    borderColor: '#2c2340',
    borderRadius: 14,
    padding: 11,
    gap: 6,
    overflow: 'hidden',
  },
  msCenter: { alignItems: 'center', justifyContent: 'center' },
  msHd: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sq: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: '#241a38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sqText: { fontSize: 11 },
  hdTitle: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  bal: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.ember },
  msRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1e1630',
    borderWidth: 1,
    borderColor: '#2c2340',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  av: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#241a38',
    borderWidth: 1,
    borderColor: '#3a2c58',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avText: { fontSize: 11 },
  rowText: { flex: 1, minWidth: 0 },
  t1: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.ink },
  t2: { fontFamily: Fonts.body, fontSize: 9.5, color: Colors.muted },
  rowRight: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.muted },
  msBtn: {
    backgroundColor: Colors.amber,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  msBtnText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: '#241505' },
  msTile: {
    borderWidth: 2,
    backgroundColor: '#1e1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msMut: { fontFamily: Fonts.body, fontSize: 10, color: Colors.muted, textAlign: 'center' },
  bub: {
    alignSelf: 'flex-start',
    maxWidth: '86%',
    backgroundColor: '#241a38',
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  bubMe: { alignSelf: 'flex-end', backgroundColor: '#3a2c58' },
  bubText: { fontFamily: Fonts.body, fontSize: 10.5, color: Colors.ink },
  banner: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bannerWash: { position: 'absolute', right: -20, top: -20, width: 90, height: 90, borderRadius: 45, opacity: 0.55 },
  bannerLabel: { fontFamily: Fonts.bodyBold, fontSize: 9.5, color: '#fff', letterSpacing: 0.4 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#2c2340', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  tog: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1630',
    borderWidth: 1,
    borderColor: '#2c2340',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  togLabel: { flex: 1, fontFamily: Fonts.body, fontSize: 10.5, color: Colors.ink },
  sw: { width: 30, height: 17, borderRadius: 9, backgroundColor: '#3a2c58', padding: 2, justifyContent: 'center' },
  swOn: { backgroundColor: Colors.green },
  knob: { width: 13, height: 13, borderRadius: 7, backgroundColor: '#8f86a4' },
  knobOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
  tabs: { flexDirection: 'row', gap: 3, backgroundColor: '#140f22', borderRadius: 9, padding: 2 },
  tab: { flex: 1, borderRadius: 7, paddingVertical: 5, alignItems: 'center' },
  tabOn: { backgroundColor: '#2b2036' },
  tabText: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textTertiary },
  tabTextOn: { fontFamily: Fonts.bodyBold, color: Colors.amber },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: Fonts.body, fontSize: 9, letterSpacing: 0.4 },
  tapHint: {
    position: 'absolute',
    bottom: Spacing.two,
    alignSelf: 'center',
    backgroundColor: '#000000aa',
    borderRadius: Radius.card,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tapHintText: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.ember },
});
