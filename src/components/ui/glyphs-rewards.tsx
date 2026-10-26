import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// THE REWARDS GLYPHS (ui_pass2 §1) — the shop / inventory / loadout controls that neither ui-glyph
// (controls) nor nav-glyph (destinations) carries: the inventory bag, the verified-odds shield, the
// preview play/stop, and one glyph per cosmetic slot for the loadout tabs. Same hand as the other two
// sets — 48 grid, 2.6 round stroke, single `currentColor` — so a loadout tab and the header back
// chevron read as one family. These are CHROME; an item's own art still comes from ItemArt/BoxArt.

export type RewardGlyphName =
  | 'bag'
  | 'shield'
  | 'play'
  | 'stop'
  | 'card'
  | 'halo'
  | 'particle'
  | 'flare'
  | 'title'
  | 'banner'
  | 'audio';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<RewardGlyphName, ReactNode> = {
  // A satchel: what you own lives here.
  bag: (
    <G>
      <Path d="M11 18 H37 L35 38 H13 Z" {...S} />
      <Path d="M18 18 V15 C18 11.7 20.7 9 24 9 C27.3 9 30 11.7 30 15 V18" {...S} />
    </G>
  ),
  // Shield with a check — "published, verified odds".
  shield: (
    <G>
      <Path d="M24 8 L37 13 V23 C37 31 31.5 37 24 40 C16.5 37 11 31 11 23 V13 Z" {...S} />
      <Path d="M18 24 L22.5 28.5 L30 20" {...S} />
    </G>
  ),
  // Filled — at 7-10px a stroked triangle closes up into a blob anyway.
  play: <Path d="M16 10 L38 24 L16 38 Z" fill="currentColor" stroke="currentColor" strokeWidth={2.6} strokeLinejoin="round" />,
  stop: <Rect x="13" y="13" width="22" height="22" rx="3" fill="currentColor" />,
  card: (
    <G>
      <Rect x="10" y="14" width="24" height="26" rx="4" {...S} />
      <Path d="M16 9 H34 C36.2 9 38 10.8 38 13 V33" {...S} />
    </G>
  ),
  halo: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Circle cx="24" cy="24" r="7" {...S} />
    </G>
  ),
  particle: (
    <G>
      <Path d="M20 10 C21 17 23 19 30 20 C23 21 21 23 20 30 C19 23 17 21 10 20 C17 19 19 17 20 10 Z" {...S} />
      <Path d="M34 28 C34.5 32 35.5 33 39 33.5 C35.5 34 34.5 35 34 39 C33.5 35 32.5 34 29 33.5 C32.5 33 33.5 32 34 28 Z" {...S} />
    </G>
  ),
  // Corner brackets — the screen-edge flare frames the view.
  flare: (
    <G>
      <Path d="M10 18 V10 H18" {...S} />
      <Path d="M30 10 H38 V18" {...S} />
      <Path d="M38 30 V38 H30" {...S} />
      <Path d="M18 38 H10 V30" {...S} />
    </G>
  ),
  title: (
    <G>
      <Path d="M12 12 H36" {...S} />
      <Path d="M24 12 V38" {...S} />
    </G>
  ),
  banner: (
    <G>
      <Path d="M13 40 V8" {...S} />
      <Path d="M13 10 H35 L30 18 L35 26 H13" {...S} />
    </G>
  ),
  audio: (
    <G>
      <Path d="M19 34 V12 L37 9 V31" {...S} />
      <Circle cx="15" cy="34" r="4" {...S} />
      <Circle cx="33" cy="31" r="4" {...S} />
    </G>
  ),
};

export function RewardGlyph({ name, size = 20, color }: { name: RewardGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}
