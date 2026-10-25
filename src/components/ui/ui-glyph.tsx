import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// THE BESPOKE UI GLYPHS (ui_pass2 §1) — the controls every screen needs (back, close, check, more…),
// drawn in mock 304's hand: 48 grid, 2.6 round stroke, single `currentColor`. These replace the
// Ionicons chevrons/close/checkmarks still scattered across the screens. Destinations and
// disciplines live in nav-glyph.tsx; this file is only controls, so the two never overlap.

export type UiGlyphName =
  | 'back'
  | 'forward'
  | 'down'
  | 'up'
  | 'close'
  | 'check'
  | 'add'
  | 'more'
  | 'gear'
  | 'share'
  | 'edit'
  | 'lock'
  | 'trash'
  | 'info'
  | 'refresh'
  | 'send'
  | 'filter'
  | 'external';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<UiGlyphName, ReactNode> = {
  back: <Path d="M29 11 L16 24 L29 37" {...S} />,
  forward: <Path d="M19 11 L32 24 L19 37" {...S} />,
  down: <Path d="M12 19 L24 31 L36 19" {...S} />,
  up: <Path d="M12 29 L24 17 L36 29" {...S} />,
  close: (
    <G>
      <Path d="M14 14 L34 34" {...S} />
      <Path d="M34 14 L14 34" {...S} />
    </G>
  ),
  check: <Path d="M11 25 L20 34 L37 15" {...S} />,
  add: (
    <G>
      <Path d="M24 11 V37" {...S} />
      <Path d="M11 24 H37" {...S} />
    </G>
  ),
  more: (
    <G>
      <Circle cx="12" cy="24" r="2.6" fill="currentColor" />
      <Circle cx="24" cy="24" r="2.6" fill="currentColor" />
      <Circle cx="36" cy="24" r="2.6" fill="currentColor" />
    </G>
  ),
  gear: (
    <G>
      <Circle cx="24" cy="24" r="6" {...S} />
      <Path
        d="M24 8 V13 M24 35 V40 M8 24 H13 M35 24 H40 M12.7 12.7 L16.2 16.2 M31.8 31.8 L35.3 35.3 M12.7 35.3 L16.2 31.8 M31.8 16.2 L35.3 12.7"
        {...S}
      />
    </G>
  ),
  share: (
    <G>
      <Path d="M24 29 V9" {...S} />
      <Path d="M16 16 L24 8 L32 16" {...S} />
      <Path d="M14 24 H12 V39 H36 V24 H34" {...S} />
    </G>
  ),
  edit: (
    <G>
      <Path d="M30 11 L37 18 L19 36 L11 38 L13 30 Z" {...S} />
      <Path d="M26 15 L33 22" {...S} />
    </G>
  ),
  lock: (
    <G>
      <Rect x="12" y="22" width="24" height="17" rx="4" {...S} />
      <Path d="M17 22 V17 C17 13 20 10 24 10 C28 10 31 13 31 17 V22" {...S} />
    </G>
  ),
  trash: (
    <G>
      <Path d="M10 14 H38" {...S} />
      <Path d="M19 14 V10 H29 V14" {...S} />
      <Path d="M14 14 L16 38 H32 L34 14" {...S} />
    </G>
  ),
  info: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Path d="M24 22 V32" {...S} />
      <Circle cx="24" cy="16.5" r="1.8" fill="currentColor" />
    </G>
  ),
  refresh: (
    <G>
      <Path d="M36 22 C35 15 30 11 24 11 C17 11 12 16 12 23" {...S} />
      <Path d="M36 13 V22 H27" {...S} />
      <Path d="M12 26 C13 33 18 37 24 37 C31 37 36 32 36 25" {...S} />
    </G>
  ),
  send: <Path d="M9 24 L39 10 L31 39 L23 27 Z M23 27 L39 10" {...S} />,
  filter: (
    <G>
      <Path d="M10 15 H38" {...S} />
      <Path d="M15 24 H33" {...S} />
      <Path d="M20 33 H28" {...S} />
    </G>
  ),
  external: (
    <G>
      <Path d="M27 10 H38 V21" {...S} />
      <Path d="M38 10 L22 26" {...S} />
      <Path d="M33 28 V38 H10 V15 H20" {...S} />
    </G>
  ),
};

export function UiGlyph({ name, size = 20, color }: { name: UiGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}
