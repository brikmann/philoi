import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// THE SETTINGS-ROW GLYPHS (ui_pass2 §1) — the row/section icons the settings-type screens need that
// neither ui-glyph.tsx (controls) nor nav-glyph.tsx (destinations + disciplines) carries: audio,
// privacy, account, help. Same hand as both: 48 grid, 2.6 round stroke, single `currentColor`, so a
// settings tile reads as the same family as the bar and the header chevron. They replace the
// Ionicons that were the last mixed icon set on these screens.

export type SettingsGlyphName =
  | 'shield'
  | 'moon'
  | 'music'
  | 'speaker'
  | 'headphones'
  | 'phone'
  | 'sun'
  | 'sliders'
  | 'minus'
  | 'megaphone'
  | 'image'
  | 'eye'
  | 'ban'
  | 'clock'
  | 'play'
  | 'ruler'
  | 'link'
  | 'cap'
  | 'chat'
  | 'power'
  | 'mail'
  | 'heart'
  | 'doc'
  | 'logout'
  | 'person-x'
  | 'calendar'
  | 'star'
  | 'camera'
  | 'globe'
  | 'flag';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<SettingsGlyphName, ReactNode> = {
  shield: (
    <G>
      <Path d="M24 8 L38 13 V23 C38 31 32 37 24 40 C16 37 10 31 10 23 V13 Z" {...S} />
      <Path d="M18 24 L22 28 L30 19" {...S} />
    </G>
  ),
  moon: <Path d="M33 31 C25 32 17 26 17 17 C17 14 18 12 19 10 C13 12 9 18 9 24 C9 32 16 39 24 39 C30 39 35 36 38 30 C36 31 35 31 33 31 Z" {...S} />,
  music: (
    <G>
      <Path d="M19 34 V12 L36 9 V31" {...S} />
      <Circle cx="15" cy="34" r="4" {...S} />
      <Circle cx="32" cy="31" r="4" {...S} />
    </G>
  ),
  speaker: (
    <G>
      <Path d="M9 19 H16 L25 11 V37 L16 29 H9 Z" {...S} />
      <Path d="M31 18 C33 20 33 28 31 30" {...S} />
      <Path d="M35 13 C40 18 40 30 35 35" {...S} />
    </G>
  ),
  headphones: (
    <G>
      <Path d="M10 30 V24 C10 16 16 10 24 10 C32 10 38 16 38 24 V30" {...S} />
      <Rect x="9" y="27" width="8" height="11" rx="3" {...S} />
      <Rect x="31" y="27" width="8" height="11" rx="3" {...S} />
    </G>
  ),
  phone: (
    <G>
      <Rect x="14" y="8" width="20" height="32" rx="4" {...S} />
      <Path d="M21 34 H27" {...S} />
    </G>
  ),
  sun: (
    <G>
      <Circle cx="24" cy="24" r="7" {...S} />
      <Path
        d="M24 8 V11 M24 37 V40 M8 24 H11 M37 24 H40 M12.7 12.7 L14.8 14.8 M33.2 33.2 L35.3 35.3 M12.7 35.3 L14.8 33.2 M33.2 14.8 L35.3 12.7"
        {...S}
      />
    </G>
  ),
  sliders: (
    <G>
      <Path d="M10 15 H38 M10 24 H38 M10 33 H38" {...S} />
      <Circle cx="18" cy="15" r="3" fill="currentColor" />
      <Circle cx="31" cy="24" r="3" fill="currentColor" />
      <Circle cx="22" cy="33" r="3" fill="currentColor" />
    </G>
  ),
  minus: <Path d="M11 24 H37" {...S} />,
  megaphone: (
    <G>
      <Path d="M10 20 V28 H16 L34 37 V11 L16 20 Z" {...S} />
      <Path d="M16 28 L19 38 H24 L22 30" {...S} />
      <Path d="M38 20 V28" {...S} />
    </G>
  ),
  image: (
    <G>
      <Rect x="9" y="11" width="30" height="26" rx="4" {...S} />
      <Circle cx="18" cy="20" r="3" {...S} />
      <Path d="M10 34 L20 25 L27 31 L31 27 L38 33" {...S} />
    </G>
  ),
  eye: (
    <G>
      <Path d="M6 24 C10 16 17 12 24 12 C31 12 38 16 42 24 C38 32 31 36 24 36 C17 36 10 32 6 24 Z" {...S} />
      <Circle cx="24" cy="24" r="5" {...S} />
    </G>
  ),
  ban: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Path d="M14 14 L34 34" {...S} />
    </G>
  ),
  clock: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Path d="M24 16 V24 L30 28" {...S} />
    </G>
  ),
  play: (
    <G>
      <Circle cx="24" cy="24" r="14" {...S} />
      <Path d="M21 18 L30 24 L21 30 Z" {...S} />
    </G>
  ),
  ruler: (
    <G>
      <Rect x="8" y="17" width="32" height="14" rx="3" {...S} />
      <Path d="M15 17 V23 M21 17 V21 M27 17 V23 M33 17 V21" {...S} />
    </G>
  ),
  link: (
    <G>
      <Path d="M21 27 L27 21" {...S} />
      <Path d="M23 15 L26 12 C29 9 34 9 36 12 C39 14 39 19 36 22 L33 25" {...S} />
      <Path d="M25 33 L22 36 C19 39 14 39 12 36 C9 34 9 29 12 26 L15 23" {...S} />
    </G>
  ),
  cap: (
    <G>
      <Path d="M5 19 L24 11 L43 19 L24 27 Z" {...S} />
      <Path d="M13 23 V32 C17 36 31 36 35 32 V23" {...S} />
      <Path d="M43 19 V28" {...S} />
    </G>
  ),
  chat: <Path d="M11 12 H37 C38 12 39 13 39 14 V30 C39 31 38 32 37 32 H22 L14 38 V32 H11 C10 32 9 31 9 30 V14 C9 13 10 12 11 12 Z" {...S} />,
  power: (
    <G>
      <Path d="M24 9 V23" {...S} />
      <Path d="M16 14 C12 17 10 21 10 25 C10 33 16 39 24 39 C32 39 38 33 38 25 C38 21 36 17 32 14" {...S} />
    </G>
  ),
  mail: (
    <G>
      <Rect x="8" y="12" width="32" height="24" rx="4" {...S} />
      <Path d="M10 15 L24 26 L38 15" {...S} />
    </G>
  ),
  heart: (
    <Path d="M24 38 C14 31 8 25 8 18 C8 13 12 10 16 10 C20 10 22 12 24 15 C26 12 28 10 32 10 C36 10 40 13 40 18 C40 25 34 31 24 38 Z" {...S} />
  ),
  doc: (
    <G>
      <Path d="M13 8 H28 L36 16 V40 H13 Z" {...S} />
      <Path d="M28 8 V16 H36" {...S} />
      <Path d="M19 25 H30 M19 32 H27" {...S} />
    </G>
  ),
  logout: (
    <G>
      <Path d="M20 10 H12 V38 H20" {...S} />
      <Path d="M21 24 H39" {...S} />
      <Path d="M32 17 L39 24 L32 31" {...S} />
    </G>
  ),
  'person-x': (
    <G>
      <Circle cx="20" cy="17" r="7" {...S} />
      <Path d="M7 38 C8 31 13 27 20 27 C23 27 26 28 28 30" {...S} />
      <Path d="M33 29 L41 37 M41 29 L33 37" {...S} />
    </G>
  ),
  calendar: (
    <G>
      <Rect x="9" y="12" width="30" height="27" rx="4" {...S} />
      <Path d="M9 20 H39 M17 8 V14 M31 8 V14" {...S} />
    </G>
  ),
  star: <Path d="M24 8 L29 18 L40 19.5 L32 27 L34 38 L24 33 L14 38 L16 27 L8 19.5 L19 18 Z" {...S} />,
  camera: (
    <G>
      <Path d="M8 17 C8 15 9 14 11 14 H17 L20 10 H28 L31 14 H37 C39 14 40 15 40 17 V35 C40 37 39 38 37 38 H11 C9 38 8 37 8 35 Z" {...S} />
      <Circle cx="24" cy="26" r="6" {...S} />
    </G>
  ),
  globe: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M9 24 H39" {...S} />
      <Path d="M24 9 C19 14 17 19 17 24 C17 29 19 34 24 39 C29 34 31 29 31 24 C31 19 29 14 24 9 Z" {...S} />
    </G>
  ),
  flag: (
    <G>
      <Path d="M12 40 V9" {...S} />
      <Path d="M12 10 C18 7 22 13 28 11 C31 10 34 9 36 9 V27 C34 27 31 28 28 29 C22 31 18 25 12 28" {...S} />
    </G>
  ),
};

export function SettingsGlyph({ name, size = 18, color }: { name: SettingsGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}
