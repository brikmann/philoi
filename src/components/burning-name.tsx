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
// `linear-gradient(0deg,#E0612C,#FFB347 42%,#FFF3D6)` + background-clip:text), weight 900, and an
// aura: the name itself radiates heat — a slow-breathing ember glow under the glyphs plus a quicker
// flicker close in. Nothing rides above the glyphs; the old flame licks off the top bobbed like
// stickers and read cheap, so the heat comes off the letters instead.
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
// Cheap on purpose: a board can hold several of these. The aura and the flicker are two shared
// values driving two views' opacity; nothing re-renders React per frame, and under Reduce Motion (or
// a blurred screen) both loops park at a steady glow rather than run.
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
  /** A wider, hotter aura for hero sizes (the profile header, the purchase reveal). At list sizes it
   *  would bleed into the neighbouring rows, so lists get the tight one. */
  hero?: boolean;
  /**
   * Pin the Emberfall Seal after the name when `userId` owns it (<SealBadge>). On by default so
   * every surface that shows a name shows the Seal too; a name drawn from `owns` alone (the reveal,
   * the tutorial board) has no one to ask about, so it never gets one.
   */
  seal?: boolean;
};

export function BurningName({ children, userId, owns, style, numberOfLines = 1, suffix, hero = false, seal = true }: Props) {
  const fetched = usePassHolder(owns === undefined ? userId : null);
  const burning = owns ?? fetched;
  // Independent of `burning`: the Seal outlives the pass, so a lapsed finisher is a plain name + Seal.
  const sealed = useSealOwner(seal ? userId : null);

  if (!sealed) {
    return (
      <Name burning={burning} style={style} numberOfLines={numberOfLines} suffix={suffix} hero={hero}>
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
        <Name burning={burning} style={text} numberOfLines={numberOfLines} hero={hero}>
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
  hero,
}: {
  children: string;
  burning: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines: number;
  suffix?: ReactNode;
  hero: boolean;
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
        <FireText text={children} style={text} numberOfLines={numberOfLines} hero={hero} />
      </View>
    );
  }

  // The suffix sits beside the fire, not inside it: " · you" in flames would read as part of the name.
  return (
    <View style={[outer, styles.withSuffix]}>
      <View style={styles.shrink}>
        <FireText text={children} style={text} numberOfLines={numberOfLines} hero={hero} />
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
  hero,
}: {
  text: string;
  style: TextStyle;
  numberOfLines: number;
  hero: boolean;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const run = usePassMotion();
  const pulse = useSharedValue(0.5);
  const breath = useSharedValue(0.5);

  useEffect(() => {
    if (run) {
      pulse.value = withRepeat(withTiming(1, { duration: 950, easing: Easing.inOut(Easing.sin) }), -1, true);
      // The aura breathes slower than the flicker — heat rolling off, not a strobe.
      breath.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
    } else {
      // Parked at the middle, so a held-still name is the same fire stopped, not a dimmer one.
      cancelAnimation(pulse);
      cancelAnimation(breath);
      pulse.value = 0.5;
      breath.value = 0.5;
    }
  }, [run, pulse, breath]);

  const glow = useAnimatedStyle(() => ({ opacity: interpolate(pulse.value, [0, 1], [0.35, 1]) }));
  const auraGlow = useAnimatedStyle(() => ({ opacity: interpolate(breath.value, [0, 1], [0.45, 1]) }));

  // The aura's reach, scaled to the glyphs. Android draws a text shadow only inside its own view, so
  // the aura copy is padded out by its radius — same inner width, so it lays out (and ellipsizes)
  // exactly like the base copy — and capped at 24, past which Android's blur stops widening.
  const size = style.fontSize ?? 15;
  const reach = Math.min(24, Math.round(size * (hero ? 0.95 : 0.6)));

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 0.5 || Math.abs(box.h - height) > 0.5) setBox({ w: width, h: height });
  }

  // The caller's size and spacing; the family is always the black cut (weight 900, per the mock).
  const fire: StyleProp<TextStyle> = [style, styles.heavy];

  return (
    <View>
      {/* The aura: an ember-red copy far behind the glyphs, its wide soft shadow the heat the name
          gives off. Only the halo shows — the base copy and the bands cover its letters. */}
      {box ? (
        <Animated.View
          style={[styles.layer, { top: -reach, left: -reach, width: box.w + reach * 2, height: box.h + reach * 2 }, auraGlow]}
          pointerEvents="none">
          <Text
            style={[fire, styles.aura, { padding: reach, width: box.w + reach * 2, textShadowRadius: reach }]}
            numberOfLines={numberOfLines}>
            {text}
          </Text>
        </Animated.View>
      ) : null}

      {/* The flicker: a hotter glow close in, quicker than the aura. Behind the base copy, so only
          its halo shows. */}
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
    </View>
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
  aura: {
    color: FIRE_BOTTOM,
    textShadowColor: 'rgba(224,97,44,0.9)',
    textShadowOffset: { width: 0, height: 0 },
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
