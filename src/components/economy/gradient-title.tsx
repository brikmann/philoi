import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';

import type { Rarity } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A TITLE IN ITS OWN GRADIENT (mock 249).
//
// Every title used to render in one flat rarity colour, so "Villain Arc" and "Cracked" — both rare —
// were the same blue line. Each title already carries its identity as `art.from → art.to`; this
// draws the words in that ramp, left to right (the mock's `linear-gradient(100deg, from, to)` +
// background-clip:text). Rarity stays legible as weight and glow — Legendary and Mythic burn with a
// soft halo in their `to` stop — instead of as a colour that flattens a whole tier into one.
//
// ── HOW, WITHOUT background-clip ──
//
// The same technique as BurningName, turned on its side. React Native has no text clip and the app
// deliberately carries no masked-view (a native module is a prebuild and a new way to fail at
// launch). So the SAME <Text> is drawn several times, each copy clipped to one vertical slice of the
// line box and coloured with the ramp's value at that slice. Every copy shares style, width and
// numberOfLines, so they lay out pixel-identically — ellipsis included — and the slices read as one
// horizontal gradient. Eight slices across a ~120pt title is ~15pt a step between two stops that
// are already close in hue; below that it costs views without reading smoother.
//
// Static: nothing animates and nothing re-renders after the one layout pass, so a feed full of
// titles costs eight Text nodes each and no frames.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const SLICES = 8;

/** Rarities that glow. Below this the gradient alone carries the title. */
const GLOWS: ReadonlySet<Rarity> = new Set<Rarity>(['legendary', 'mythic']);

export function GradientTitleText({
  text,
  from,
  to,
  rarity,
  style,
  numberOfLines = 1,
}: {
  text: string;
  from: string;
  to: string;
  rarity: Rarity;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 0.5 || Math.abs(box.h - height) > 0.5) setBox({ w: width, h: height });
  }

  const glow: TextStyle | null = GLOWS.has(rarity)
    ? { textShadowColor: to, textShadowRadius: rarity === 'mythic' ? 8 : 6, textShadowOffset: { width: 0, height: 0 } }
    : null;

  return (
    <View style={styles.wrap}>
      {/* The in-flow copy owns the layout (and the ellipsis) and carries the glow. It paints in the
          ramp's midpoint until the slices have a box to draw into, so the first frame is already the
          right colour family rather than a flash of rarity blue. */}
      <Text style={[style, glow, { color: mix(from, to, 0.5) }]} numberOfLines={numberOfLines} onLayout={onLayout}>
        {text}
      </Text>

      {box
        ? Array.from({ length: SLICES }, (_, i) => {
            const left = (box.w * i) / SLICES;
            // Rounded outward by a hair so adjacent slices overlap rather than leave a hairline gap.
            const width = box.w / SLICES + 0.5;
            return (
              <View key={i} style={[styles.slice, { left, width, height: box.h }]} pointerEvents="none">
                <Text
                  style={[style, styles.sliceText, { color: mix(from, to, (i + 0.5) / SLICES), left: -left, width: box.w }]}
                  numberOfLines={numberOfLines}>
                  {text}
                </Text>
              </View>
            );
          })
        : null}
    </View>
  );
}

/** Linear mix of two `#RRGGBB` colours. Anything else falls back to `a` rather than throwing. */
function mix(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 1,
  },
  slice: {
    position: 'absolute',
    top: 0,
    overflow: 'hidden',
  },
  sliceText: {
    position: 'absolute',
    top: 0,
    // The glow lives on the in-flow copy only; eight stacked shadows would read as a smear.
    textShadowRadius: 0,
  },
});
