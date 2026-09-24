import { useId, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextLayoutEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { EMBER_GRADIENT, Fonts } from '@/constants/theme';

// The ember gradient as TEXT — the molten headline treatment for display and CTA copy that was
// shipping flat orange: the Flame Pass wordmark, the rank-up claim CTA, the Forge section header.
//
// 🚫 NOT masked-view + expo-linear-gradient. The brief called for those two; neither is installed,
// and adding them means a native module pair, a prebuild and a fresh build for every tester —
// while OTA is off (runtimeVersion is still sdkVersion), so a text treatment would be gated behind
// a store cycle. react-native-svg is already a dependency and already paints this exact gradient
// for PrimaryButton and EmberFill, so it paints it here too. Same pixels, no new native surface.
//
// The hard part of gradient text in RN is that SVG cannot lay out a paragraph and RN cannot fill
// one with a gradient. So each side does the half it is good at:
//
//   1. A real <Text> lays the copy out — wrapping, font metrics, alignment, ellipsis, all native.
//   2. `onTextLayout` hands back one box per rendered LINE (x, y, width, ascender, text).
//   3. An absolutely-positioned <Svg> redraws those exact lines with the gradient as the fill.
//
// The real <Text> stays mounted underneath, turned transparent — that is what keeps the box the
// right size and keeps the string readable to a screen reader. Until the first layout lands it is
// painted flat `EMBER_GRADIENT[2]`, so the first frame reads as lit rather than as a hole, and if
// `onTextLayout` ever comes back without per-line `text` (the one field this leans on that is not
// guaranteed everywhere) the flat paint is simply what ships. Degrading to the colour we were
// already shipping is the whole fallback.

type Line = {
  x: number;
  y: number;
  width: number;
  height: number;
  ascender?: number;
  text?: string;
};

type EmberTextProps = {
  /** A plain string — this redraws glyphs, so nested <Text> spans have no colour to inherit. */
  children: string;
  /** The TextStyle the flat version had. `color` is ignored; the gradient is the colour. */
  style?: StyleProp<TextStyle>;
  /** Layout for the wrapping View — `flex: 1`, margins, alignment the parent used to give <Text>. */
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  /** Vertical (default) puts the pale amber on the cap-height and the deep ember on the baseline,
   *  which is the flame ramp from DESIGN_LANGUAGE_EMBER §3. Horizontal matches the fills. */
  direction?: 'vertical' | 'horizontal';
  accessibilityLabel?: string;
};

export function EmberText({
  children,
  style,
  containerStyle,
  numberOfLines,
  direction = 'vertical',
  accessibilityLabel,
}: EmberTextProps) {
  // Gradient ids are global in react-native-svg — a shared literal blanks every instance after the
  // first on Android. React 19's useId returns «r1»-style delimiters, which have no business in a
  // url(#…) reference, hence the strip.
  const gradId = `ember-text-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [lines, setLines] = useState<Line[] | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const flat = StyleSheet.flatten(style) ?? {};
  // Drawable only once we know both the box and the lines, and only if the platform told us what
  // each line actually says. No text, nothing to redraw — stay flat.
  const drawn = lines?.length && box.w > 0 && lines.every((l) => typeof l.text === 'string') ? lines : null;

  const onLayout = (e: LayoutChangeEvent) =>
    setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const onTextLayout = (e: NativeSyntheticEvent<TextLayoutEventData>) => setLines(e.nativeEvent.lines as Line[]);

  return (
    <View style={containerStyle} onLayout={onLayout}>
      <Text
        style={[style, { color: drawn ? 'transparent' : EMBER_GRADIENT[2] }]}
        numberOfLines={numberOfLines}
        accessibilityLabel={accessibilityLabel}
        onTextLayout={onTextLayout}>
        {children}
      </Text>
      {drawn ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={box.w} height={box.h}>
            <Defs>
              <LinearGradient
                id={gradId}
                x1="0"
                y1="0"
                x2={direction === 'horizontal' ? '1' : '0'}
                y2={direction === 'horizontal' ? '0' : '1'}>
                {/* Pale → mid → deep. Ordered so the deep end lands on the descender rather than
                    across the body of the glyph: #E0612C on near-black is the least legible of the
                    three, and a headline should not fade out through its own middle. */}
                <Stop offset="0" stopColor={EMBER_GRADIENT[2]} />
                <Stop offset="0.55" stopColor={EMBER_GRADIENT[1]} />
                <Stop offset="1" stopColor={EMBER_GRADIENT[0]} />
              </LinearGradient>
            </Defs>
            {drawn.map((line, i) => (
              <SvgText
                // Index is the identity here — these are positions in a laid-out paragraph, and
                // two lines of a headline can legitimately hold the same string.
                key={i}
                // `x` already carries the alignment offset the native layout applied, so left,
                // centre and right all land by starting from it.
                x={line.x}
                // SVG anchors text on the baseline. `ascender` is the distance from the line's top
                // edge to that baseline; the 0.8 is the standard fallback ratio for the platforms
                // that leave it out.
                y={line.y + (line.ascender ?? line.height * 0.8)}
                fontSize={flat.fontSize ?? 14}
                // Family only, never weight: the Inter faces encode their weight in the family
                // name, and passing fontWeight alongside makes Android resolve to a system face.
                fontFamily={typeof flat.fontFamily === 'string' ? flat.fontFamily : Fonts.bodyBold}
                letterSpacing={flat.letterSpacing}
                textAnchor="start"
                fill={`url(#${gradId})`}>
                {line.text}
              </SvgText>
            ))}
          </Svg>
        </View>
      ) : null}
    </View>
  );
}
