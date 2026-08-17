import { useMemo } from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { Fonts } from '@/constants/theme';

// The purple gradient wordmark treatment from #87 / mock 91 — used for PHILOI on the Live Activity
// surfaces and for the session name in the in-app pill.
//
// Done in SVG rather than with a masked LinearGradient because neither expo-linear-gradient nor
// @react-native-masked-view is installed, and react-native-svg already is. Adding a native module
// for a text gradient would mean another prebuild — and, as the RevenueCat white screen proved,
// every native dependency is a way for the app to fail to start.
//
// SVG text can't lay itself out inside a flex row, so the box is measured from the string: a width
// estimate from the character count and a height from the font size. Approximate on purpose — it
// only has to reserve enough room, and `textAnchor="start"` keeps the glyphs pinned left however
// generous the estimate is.

const GRADIENT_FROM = '#C99BFF';
const GRADIENT_TO = '#8A4FFF';

/** Rough advance width per character at 1px font-size for a bold, letter-spaced sans face. */
const WIDTH_RATIO = 0.62;

type Props = {
  children: string;
  size?: number;
  letterSpacing?: number;
  /** Unique per instance — SVG gradient ids are global, so two different ramps would collide. */
  gradientId?: string;
};

export function GradientWordmark({ children, size = 11, letterSpacing = 1.2, gradientId }: Props) {
  const text = children.toUpperCase();
  const id = gradientId ?? `wm-${text.replace(/[^A-Z0-9]/g, '')}-${size}`;

  const { width, height } = useMemo(
    () => ({
      width: Math.ceil(text.length * size * WIDTH_RATIO + text.length * letterSpacing + size * 0.5),
      height: Math.ceil(size * 1.35),
    }),
    [text, size, letterSpacing]
  );

  return (
    <Svg width={width} height={height}>
      <Defs>
        {/* Vertical ramp (x1==x2), matching linear-gradient(180deg, …) in the mock. */}
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={GRADIENT_FROM} />
          <Stop offset="1" stopColor={GRADIENT_TO} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={0}
        // Baseline rather than centre: SVG has no vertical-centre anchor that behaves across
        // platforms, and this keeps the cap-height visually aligned with sibling Text.
        y={size}
        fontSize={size}
        fontFamily={Fonts.bodyBold}
        fontWeight="800"
        letterSpacing={letterSpacing}
        textAnchor="start"
        fill={`url(#${id})`}>
        {text}
      </SvgText>
    </Svg>
  );
}
