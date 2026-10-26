import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// THE SOCIAL GLYPHS — the handful of controls the campfire / friends / forest screens need that
// neither ui-glyph.tsx (generic controls) nor nav-glyph.tsx (destinations + disciplines) carries.
// Same hand as both: 48 grid, 2.6 round stroke, single `currentColor`. These replace the Ionicons
// chat bubbles, pins, keys and person-add icons that were the last off-family marks on those screens.

export type SocialGlyphName =
  | 'chat'
  | 'pin'
  | 'personAdd'
  | 'people'
  | 'key'
  | 'copy'
  | 'bolt'
  | 'minus'
  | 'report'
  | 'block'
  | 'swords';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<SocialGlyphName, ReactNode> = {
  chat: (
    <G>
      <Path d="M10 14 C10 11.8 11.8 10 14 10 H34 C36.2 10 38 11.8 38 14 V29 C38 31.2 36.2 33 34 33 H22 L14 39 V33 H14 C11.8 33 10 31.2 10 29 Z" {...S} />
      <Circle cx="18" cy="21.5" r="1.9" fill="currentColor" />
      <Circle cx="24" cy="21.5" r="1.9" fill="currentColor" />
      <Circle cx="30" cy="21.5" r="1.9" fill="currentColor" />
    </G>
  ),
  pin: (
    <G>
      <Path d="M24 40 C24 40 12 28.5 12 20 C12 13.4 17.4 8 24 8 C30.6 8 36 13.4 36 20 C36 28.5 24 40 24 40 Z" {...S} />
      <Circle cx="24" cy="20" r="4.5" {...S} />
    </G>
  ),
  personAdd: (
    <G>
      <Circle cx="20" cy="17" r="7" {...S} />
      <Path d="M7 39 C7 31.5 12.8 27 20 27 C23.5 27 26.6 28 28.9 30" {...S} />
      <Path d="M36 26 V38" {...S} />
      <Path d="M30 32 H42" {...S} />
    </G>
  ),
  people: (
    <G>
      <Circle cx="18" cy="17" r="6.5" {...S} />
      <Path d="M6 38 C6 31 11.4 27 18 27 C24.6 27 30 31 30 38" {...S} />
      <Path d="M29 11.5 C32.6 11.5 35.5 14.4 35.5 18 C35.5 21.6 32.6 24.5 29 24.5" {...S} />
      <Path d="M33 28 C38 29.2 42 32.8 42 38" {...S} />
    </G>
  ),
  key: (
    <G>
      <Circle cx="16" cy="30" r="7" {...S} />
      <Path d="M21 25 L37 9" {...S} />
      <Path d="M31 15 L36 20" {...S} />
      <Path d="M27 19 L31 23" {...S} />
    </G>
  ),
  copy: (
    <G>
      <Rect x="17" y="17" width="21" height="21" rx="4" {...S} />
      <Path d="M31 12 V11 C31 9.9 30.1 9 29 9 H13 C10.8 9 9 10.8 9 13 V29 C9 30.1 9.9 31 11 31 H12" {...S} />
    </G>
  ),
  bolt: <Path d="M27 7 L12 27 H23 L21 41 L36 21 H25 Z" {...S} />,
  minus: <Path d="M11 24 H37" {...S} />,
  report: (
    <G>
      <Path d="M13 41 V9" {...S} />
      <Path d="M13 11 H35 L30 18.5 L35 26 H13" {...S} />
    </G>
  ),
  block: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Path d="M14.1 33.9 L33.9 14.1" {...S} />
    </G>
  ),
  // Head to head — two crossed blades, the H2H mark the sword-cross MaterialCommunityIcon used to be.
  swords: (
    <G>
      <Path d="M11 11 L30 30 M25 35 L35 25 M32 32 L38 38" {...S} />
      <Path d="M37 11 L18 30 M23 35 L13 25 M16 32 L10 38" {...S} />
    </G>
  ),
};

export function SocialGlyph({ name, size = 20, color }: { name: SocialGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}
