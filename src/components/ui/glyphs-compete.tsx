import type { ReactNode } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

// THE COMPETE GLYPHS (ui_pass2 §1) — the section/status icons the challenge, versus and fitness
// screens need that are neither a control (ui-glyph.tsx) nor a destination (nav-glyph.tsx). Same
// hand as both: 48 grid, 2.6 round stroke, single `currentColor`. They replace the Ionicons
// people / megaphone / hand-left / time / hourglass / flash / school / cube still on those screens.

export type CompeteGlyphName =
  | 'people'
  | 'megaphone'
  | 'hand'
  | 'clock'
  | 'hourglass'
  | 'bolt'
  | 'school'
  | 'box'
  | 'minus'
  | 'checkCircle'
  | 'addCircle'
  | 'versus'
  | 'eye';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<CompeteGlyphName, ReactNode> = {
  people: (
    <G>
      <Circle cx="18" cy="17" r="6" {...S} />
      <Path d="M7 37 C7 30 12 26 18 26 C24 26 29 30 29 37" {...S} />
      <Path d="M30 11.5 C33.5 12 36 14.5 36 18 C36 21.5 33.5 24 30 24.5" {...S} />
      <Path d="M33 27 C38 28 41 32 41 37" {...S} />
    </G>
  ),
  megaphone: (
    <G>
      <Path d="M9 21 V29 H16 L34 38 V12 L16 21 Z" {...S} />
      <Path d="M16 29 L19 38 H24 L22 31" {...S} />
      <Path d="M39 20 V30" {...S} />
    </G>
  ),
  hand: (
    <G>
      <Path d="M17 26 V13 C17 11 18.5 10 20 10 C21.5 10 23 11 23 13 V23" {...S} />
      <Path d="M23 22 V10.5 C23 8.8 24.3 8 25.5 8 C26.8 8 28 8.8 28 10.5 V23" {...S} />
      <Path d="M28 23 V13 C28 11.3 29.3 10.5 30.5 10.5 C31.8 10.5 33 11.3 33 13 V25" {...S} />
      <Path d="M33 20 C33 18.3 34.3 17.5 35.5 17.5 C36.8 17.5 38 18.3 38 20 V28 C38 35 33 40 26 40 C20 40 17 37 14 32 L10 25 C9 23.5 9.5 21.8 11 21 C12.5 20.2 14 20.8 15 22 L17 25" {...S} />
    </G>
  ),
  clock: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M24 15 V24 L30 28" {...S} />
    </G>
  ),
  hourglass: (
    <G>
      <Path d="M13 9 H35 M13 39 H35" {...S} />
      <Path d="M16 9 C16 17 21 20 24 24 C27 20 32 17 32 9" {...S} />
      <Path d="M16 39 C16 31 21 28 24 24 C27 28 32 31 32 39" {...S} />
    </G>
  ),
  bolt: <Path d="M27 7 L12 27 H23 L21 41 L36 21 H25 Z" {...S} />,
  school: (
    <G>
      <Path d="M5 19 L24 10 L43 19 L24 28 Z" {...S} />
      <Path d="M13 23.5 V32 C13 35 18 38 24 38 C30 38 35 35 35 32 V23.5" {...S} />
      <Path d="M43 19 V29" {...S} />
    </G>
  ),
  box: (
    <G>
      <Path d="M24 7 L39 15 V33 L24 41 L9 33 V15 Z" {...S} />
      <Path d="M9 15 L24 23 L39 15" {...S} />
      <Path d="M24 23 V41" {...S} />
    </G>
  ),
  minus: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M17 24 H31" {...S} />
    </G>
  ),
  checkCircle: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M17 24.5 L22 29.5 L31 19" {...S} />
    </G>
  ),
  addCircle: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M24 17 V31 M17 24 H31" {...S} />
    </G>
  ),
  // Two blades crossed — the head-to-head mark.
  versus: (
    <G>
      <Path d="M10 10 L30 30 M10 10 H16 M10 10 V16" {...S} />
      <Path d="M38 10 L18 30 M38 10 H32 M38 10 V16" {...S} />
      <Path d="M26 34 L34 26 M14 26 L22 34" {...S} />
      <Path d="M30 30 L37 37 M18 30 L11 37" {...S} />
    </G>
  ),
  eye: (
    <G>
      <Path d="M5 24 C10 15 16.5 11 24 11 C31.5 11 38 15 43 24 C38 33 31.5 37 24 37 C16.5 37 10 33 5 24 Z" {...S} />
      <Circle cx="24" cy="24" r="5.5" {...S} />
    </G>
  ),
};

export function CompeteGlyph({ name, size = 20, color }: { name: CompeteGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}

/** A radio dot in the same hand — a ring, filled centre when on. */
export function RadioGlyph({ on, size = 20, color }: { on: boolean; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      <Circle cx="24" cy="24" r="15" {...S} />
      {on ? <Circle cx="24" cy="24" r="7.5" fill="currentColor" /> : null}
    </Svg>
  );
}
