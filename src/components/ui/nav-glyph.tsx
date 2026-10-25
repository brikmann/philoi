import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// THE BESPOKE NAV SET (design-mocks/304-bespoke-icons.html).
//
// One rounded 2.6-stroke family on a 48 grid: the bottom bar, the top-right globals and the Lock In
// discipline picker. Paths are verbatim from mock 304's <defs>. Everything draws in `currentColor`
// (set via the Svg `color` prop), so active = ember / inactive = faint is just the colour passed in.
// The flame is the only filled glyph — it is the hero, and nothing else on the bar may compete.
//
// Run/Cardio is LUNGS, not a runner: cardio covers rides, rows and walks, and a runner's silhouette
// tells every non-runner the ladder isn't theirs (same reason goal-types.ts says "Cardio").

export type NavGlyphName =
  | 'home'
  | 'search'
  | 'flame'
  | 'trophy'
  | 'person'
  | 'plane'
  | 'bell'
  | 'menu'
  | 'brain'
  | 'book'
  | 'dumbbell'
  | 'lungs'
  | 'plus';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<NavGlyphName, ReactNode> = {
  home: (
    <G>
      <Path d="M8 23 L24 9 L40 23" {...S} />
      <Path d="M12 20 V39 H36 V20" {...S} />
      <Path d="M20 39 V29 H28 V39" {...S} />
    </G>
  ),
  search: (
    <G>
      <Circle cx="21" cy="21" r="11" {...S} />
      <Path d="M29 29 L39 39" {...S} />
    </G>
  ),
  flame: (
    <Path
      d="M24 6 C25 14 33 16 31 26 C30 34 25 40 19 39 C12 38 10 30 14 24 C15 27 18 28 18.5 25.5 C19.5 21 17 17 24 6 Z"
      fill="currentColor"
    />
  ),
  trophy: (
    <G>
      <Path d="M15 9 H33 V17 C33 24 29 28 24 28 C19 28 15 24 15 17 Z" {...S} />
      <Path d="M15 12 H10 C10 18 12 21 17 21" {...S} />
      <Path d="M33 12 H38 C38 18 36 21 31 21" {...S} />
      <Path d="M24 28 V33" {...S} />
      <Path d="M18 39 C18 35 21 33 24 33 C27 33 30 35 30 39 Z" {...S} />
    </G>
  ),
  person: (
    <G>
      <Circle cx="24" cy="17" r="7" {...S} />
      <Path d="M11 39 C11 30 17 26 24 26 C31 26 37 30 37 39" {...S} />
    </G>
  ),
  plane: (
    <G>
      <Path d="M40 8 L8 21 L20 26 L25 39 L40 8 Z" {...S} />
      <Path d="M20 26 L40 8" {...S} />
    </G>
  ),
  bell: (
    <G>
      <Path d="M24 8 C17 8 15 13 15 20 C15 29 11 30 11 33 H37 C37 30 33 29 33 20 C33 13 31 8 24 8 Z" {...S} />
      <Path d="M20 37 C20.5 39 22 40 24 40 C26 40 27.5 39 28 37" {...S} />
    </G>
  ),
  menu: (
    <G>
      <Path d="M11 16 H37" {...S} />
      <Path d="M11 24 H37" {...S} />
      <Path d="M11 32 H31" {...S} />
    </G>
  ),
  brain: (
    <G>
      <Path d="M24 11 C19 8 13 12 15 17 C10 19 11 26 16 26 C15 32 20 35 24 32 Z" {...S} />
      <Path d="M24 11 C29 8 35 12 33 17 C38 19 37 26 32 26 C33 32 28 35 24 32 Z" {...S} />
    </G>
  ),
  book: (
    <G>
      <Path d="M24 13 C21 10 14 10 10 12 V34 C14 32 21 32 24 35 Z" {...S} />
      <Path d="M24 13 C27 10 34 10 38 12 V34 C34 32 27 32 24 35 Z" {...S} />
    </G>
  ),
  dumbbell: (
    <G>
      <Path d="M13 24 H35" {...S} />
      <Rect x="9" y="17" width="5.5" height="14" rx="2" {...S} />
      <Rect x="33.5" y="17" width="5.5" height="14" rx="2" {...S} />
      <Path d="M6 20 V28" {...S} />
      <Path d="M42 20 V28" {...S} />
    </G>
  ),
  // Mock 304's `g-run` — a trachea and two lobes.
  lungs: (
    <G>
      <Path d="M24 8 V24" {...S} />
      <Path d="M19 12 H29" {...S} />
      <Path d="M24 17 C22 20 19 20 17 23 C12.5 28 12.5 35 16 38 C19.5 41 21.5 38.5 21.5 34 C21.5 29 22.5 25 24 24" {...S} />
      <Path d="M24 17 C26 20 29 20 31 23 C35.5 28 35.5 35 32 38 C28.5 41 26.5 38.5 26.5 34 C26.5 29 25.5 25 24 24" {...S} />
    </G>
  ),
  plus: (
    <G>
      <Circle cx="24" cy="24" r="13" {...S} />
      <Path d="M24 18 V30 M18 24 H30" {...S} />
    </G>
  ),
};

export function NavGlyph({ name, size = 24, color }: { name: NavGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}
