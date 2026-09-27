import { useEffect, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { usePassMotion } from '@/components/pass/pass-motion';
import { SealBadge } from '@/components/seal-badge';
import { Fonts } from '@/constants/theme';
import { usePassHolder } from '@/lib/economy/pass-holders';
import { useSealOwner } from '@/lib/economy/seal-owners';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE BURNING NAME — a Flame Pass holder's display name, on fire (LORE_EMBERFALL, mocks 225/226).
//
// The always-on ownership flex: not an equippable cosmetic, just the fact of owning the pass, shown
// everywhere the campus sees the name. Fire-gradient glyphs (the mock's
// `linear-gradient(0deg,#E0612C,#FFB347 42%,#FFF3D6)` + background-clip:text), a flickering glow
// behind them, weight 900, and — at hero sizes only — small flame licks off the top.
//
// ── HOW THE GRADIENT IS DRAWN WITHOUT background-clip ──
//
// React Native has no text clip, and this app deliberately has no masked-view (a native module is a
// prebuild and a new way to fail at launch — see GradientWordmark). SVG text was the other option,
// but it cannot lay itself out in a flex row, cannot ellipsize, and its baseline never lands exactly
// where the sibling RN glyphs do — so a name would render as two slightly offset copies.
//
// Instead the SAME <Text> is drawn several times, each copy clipped to one horizontal band of the
// line box and coloured with the gradient's value at that band. Every copy has the same style,
// width and numberOfLines, so they lay out pixel-identically — ellipsis included — and the stacked
// bands read as a vertical ramp. Six bands over a 15pt line is ~2.5pt a step, below what reads as
// banding at list sizes.
//
// Cheap on purpose: a board can hold several of these. The glow is ONE shared value driving ONE
// view's opacity; nothing re-renders React per frame, and under Reduce Motion (or a blurred screen)
// the loop parks rather than runs.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The mock's ramp, bottom → top. */
const FIRE_BOTTOM = '#E0612C';
const FIRE_MID = '#FFB347';
const FIRE_TOP = '#FFF3D6';
/** Where FIRE_MID sits, measured from the bottom (the mock's `42%`). */
const MID_AT = 0.42;

const BANDS = 6;

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The ramp's colour `u` of the way UP the line box (0 = bottom). */
function fireAt(u: number): string {
  return u <= MID_AT ? mix(FIRE_BOTTOM, FIRE_MID, u / MID_AT) : mix(FIRE_MID, FIRE_TOP, (u - MID_AT) / (1 - MID_AT));
}

/** Top band first — each band sampled at its own centre. */
const BAND_COLORS = Array.from({ length: BANDS }, (_, i) => fireAt(1 - (i + 0.5) / BANDS));

/** Props that place the name in its parent rather than shape its glyphs. */
const OUTER_KEYS = [
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'position', 'top', 'left', 'right', 'bottom',
] as const;

/**
 * Splits the caller's style into what positions the name (on the wrapper) and what draws it (on
 * every copy). A margin left on the copies would offset the in-flow one from the absolutely placed
 * bands — the bands pin to the wrapper's corner, the margin moves only the copy that has one.
 */
function splitStyle(style: StyleProp<TextStyle>): { outer: ViewStyle; text: TextStyle } {
  const flat = { ...(StyleSheet.flatten(style) ?? {}) } as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  for (const k of OUTER_KEYS) {
    if (k in flat) {
      outer[k] = flat[k];
      delete flat[k];
    }
  }
  return { outer: outer as ViewStyle, text: flat as TextStyle };
}

type Props = {
  /** The name. A string, so every band can redraw it. */
  children: string;
  /**
   * Whose name this is. The component reads their pass ownership itself (batched — see
   * lib/economy/pass-holders). Omit it and pass `owns` for a name whose status is already known.
   */
  userId?: string | null;
  /** Forces the answer — the purchase reveal and the tutorial's example board. Wins over `userId`. */
  owns?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Rendered after the name in the PLAIN style (" · you", a handle) — never on fire. */
  suffix?: ReactNode;
  /** Flame licks off the top of the glyphs. Hero sizes only; at list sizes they are noise. */
  licks?: boolean;
  /**
   * Pin the Emberfall Seal after the name when `userId` owns it (<SealBadge>). On by default so
   * every surface that shows a name shows the Seal too; a name drawn from `owns` alone (the reveal,
   * the tutorial board) has no one to ask about, so it never gets one.
   */
  seal?: boolean;
};

export function BurningName({ children, userId, owns, style, numberOfLines = 1, suffix, licks = false, seal = true }: Props) {
  const fetched = usePassHolder(owns === undefined ? userId : null);
  const burning = owns ?? fetched;
  // Independent of `burning`: the Seal outlives the pass, so a lapsed finisher is a plain name + Seal.
  const sealed = useSealOwner(seal ? userId : null);

  if (!sealed) {
    return (
      <Name burning={burning} style={style} numberOfLines={numberOfLines} suffix={suffix} licks={licks}>
        {children}
      </Name>
    );
  }

  // Name · Seal · suffix — the Seal belongs to the name, so " (you)" stays at the end of the line.
  const { outer, text } = splitStyle(style);
  const size = Math.round((text.fontSize ?? 15) * 0.9);
  return (
    <View style={[outer, styles.withSuffix]}>
      <View style={styles.shrink}>
        <Name burning={burning} style={text} numberOfLines={numberOfLines} licks={licks}>
          {children}
        </Name>
      </View>
      <SealBadge owns size={size} style={styles.seal} />
      {suffix ? (
        <Text style={[text, styles.suffix]} numberOfLines={1}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

/** The name alone, burning or plain, with its suffix. */
function Name({
  children,
  burning,
  style,
  numberOfLines,
  suffix,
  licks,
}: {
  children: string;
  burning: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines: number;
  suffix?: ReactNode;
  licks: boolean;
}) {
  if (!burning) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {children}
        {suffix}
      </Text>
    );
  }

  const { outer, text } = splitStyle(style);

  if (!suffix) {
    return (
      <View style={outer}>
        <FireText text={children} style={text} numberOfLines={numberOfLines} licks={licks} />
      </View>
    );
  }

  // The suffix sits beside the fire, not inside it: " · you" in flames would read as part of the name.
  return (
    <View style={[outer, styles.withSuffix]}>
      <View style={styles.shrink}>
        <FireText text={children} style={text} numberOfLines={numberOfLines} licks={licks} />
      </View>
      <Text style={[text, styles.suffix]} numberOfLines={1}>
        {suffix}
      </Text>
    </View>
  );
}

function FireText({
  text,
  style,
  numberOfLines,
  licks,
}: {
  text: string;
  style: TextStyle;
  numberOfLines: number;
  licks: boolean;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const run = usePassMotion();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (run) {
      pulse.value = withRepeat(withTiming(1, { duration: 950, easing: Easing.inOut(Easing.sin) }), -1, true);
    } else {
      // Parked at the middle, so a held-still name is the same fire stopped, not a dimmer one.
      cancelAnimation(pulse);
      pulse.value = 0.5;
    }
  }, [run, pulse]);

  const glow = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.35, 1]) }));

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 0.5 || Math.abs(box.h - height) > 0.5) setBox({ w: width, h: height });
  }

  // The caller's size and spacing; the family is always the black cut (weight 900, per the mock).
  const fire: StyleProp<TextStyle> = [style, styles.heavy];

  return (
    <View>
      {/* The flicker: a hotter, wider glow behind the glyphs, breathing. Behind the base copy, so
          only its halo shows. */}
      {box ? (
        <Animated.View style={[styles.layer, { width: box.w, height: box.h }, glow]} pointerEvents="none">
          <Text style={[fire, styles.flicker, { width: box.w }]} numberOfLines={numberOfLines}>
            {text}
          </Text>
        </Animated.View>
      ) : null}

      {/* The in-flow copy: it owns the layout (and the ellipsis), carries the steady glow, and is
          the whole name in the mid-fire colour until the bands have a box to draw into. */}
      <Text style={[fire, styles.base]} numberOfLines={numberOfLines} onLayout={onLayout}>
        {text}
      </Text>

      {box
        ? BAND_COLORS.map((color, i) => {
            const top = (box.h * i) / BANDS;
            // Rounded outward by a hair so adjacent bands overlap rather than leave a hairline gap.
            const height = box.h / BANDS + 0.5;
            return (
              <View key={i} style={[styles.band, { top, height, width: box.w }]} pointerEvents="none">
                <Text style={[fire, styles.bandText, { color, top: -top, width: box.w }]} numberOfLines={numberOfLines}>
                  {text}
                </Text>
              </View>
            );
          })
        : null}

      {licks && box && run ? <Licks width={box.w} height={box.h} /> : null}
    </View>
  );
}

/** Four small tongues off the top of the name (mock 225's `.lick`). */
const LICKS = [
  { at: 0.14, h: 0.42, delay: 0 },
  { at: 0.42, h: 0.58, delay: 350 },
  { at: 0.66, h: 0.44, delay: 700 },
  { at: 0.86, h: 0.52, delay: 200 },
] as const;

function Licks({ width, height }: { width: number; height: number }) {
  return (
    <>
      {LICKS.map((l) => (
        <Lick key={l.at} left={width * l.at} h={height * l.h} delay={l.delay} top={height * 0.1} />
      ))}
    </>
  );
}

function Lick({ left, h, delay, top }: { left: number; h: number; delay: number; top: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.45, 1]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [3, -3]) }, { scaleY: interpolate(t.value, [0, 1], [0.8, 1.15]) }],
  }));
  const w = Math.max(5, h * 0.45);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.lick, { left: left - w / 2, top: top - h, width: w, height: h, borderRadius: w / 2 }, style]}>
      <View style={[styles.lickCore, { width: w * 0.5, height: h * 0.55, borderRadius: w / 4 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heavy: {
    fontFamily: Fonts.black,
    fontWeight: undefined,
  },
  base: {
    color: FIRE_MID,
    textShadowColor: 'rgba(255,120,40,0.75)',
    textShadowOffset: { width: 0, height: -1 },
    textShadowRadius: 8,
  },
  flicker: {
    color: FIRE_BOTTOM,
    textShadowColor: 'rgba(255,160,60,0.95)',
    textShadowOffset: { width: 0, height: -2 },
    textShadowRadius: 16,
  },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  band: {
    position: 'absolute',
    left: 0,
    overflow: 'hidden',
  },
  bandText: {
    position: 'absolute',
    left: 0,
    // No shadow on the bands: the base copy's glow shows through between the glyphs, and a shadow
    // per band would stack six glows into a smear.
    textShadowRadius: 0,
    textShadowColor: 'transparent',
  },
  lick: {
    position: 'absolute',
    backgroundColor: 'rgba(255,158,77,0.75)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  lickCore: {
    backgroundColor: 'rgba(255,243,214,0.85)',
    marginBottom: 1,
  },
  withSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  shrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  suffix: {
    flexShrink: 0,
  },
  seal: {
    marginLeft: 5,
  },
});
