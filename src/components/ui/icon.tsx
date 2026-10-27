import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { EmberIcon } from '@/components/economy/ember-icon';
import { Colors } from '@/constants/theme';

import { CompeteGlyph, type CompeteGlyphName } from './glyphs-compete';
import { RewardGlyph, type RewardGlyphName } from './glyphs-rewards';
import { SessionGlyph, type SessionGlyphName } from './glyphs-session';
import { SettingsGlyph, type SettingsGlyphName } from './glyphs-settings';
import { SocialGlyph, type SocialGlyphName } from './glyphs-social';
import { NavGlyph, type NavGlyphName } from './nav-glyph';
import { UiGlyph, type UiGlyphName } from './ui-glyph';

// THE ONE ICON FRONT DOOR (emoji → bespoke art sweep, closes pre-submission A4/B).
//
// What this replaces: OS emoji standing in as UI chrome — 🔥 beside a streak, 📚 on a study row,
// 💬 on a reply button, 🔒 on a locked tier. An emoji draws differently per OS and font version,
// ignores the tint of the row it sits in, and on iOS a bare ⚔ / ▶ / ⚡ flips to colour-emoji
// presentation without warning. Every one of those slots now asks for a SEMANTIC name here.
//
// This file owns no art of its own except the handful of glyphs no family had yet (tree, sprout,
// medal, sparkle, compass, chart, fog, clip, tap, crown, target). Everything else delegates to the
// family that already draws it — nav-glyph, ui-glyph and the glyphs-* sets — all on mock 304's 48
// grid, 2.6 round stroke, single currentColor. One name = one drawing, app-wide.
//
// Two deliberate exceptions to "single currentColor":
//   - 'flame' is the FILLED hero flame from the nav set — the only filled glyph in the family.
//   - 'ember' is the currency token (EmberIcon, mock 86). It is a full-colour coin on purpose: the
//     ember amount must read as money in every row, so it ignores `color`.
//
// NOT for user-authored content. Emoji people type into captions, campfire names, reactions and
// the cheer / "leave a nice one" presets are content and stay emoji.

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

type OwnGlyphName =
  | 'tree'
  | 'sprout'
  | 'medal'
  | 'sparkle'
  | 'compass'
  | 'chart'
  | 'fog'
  | 'clip'
  | 'tap'
  | 'crown'
  | 'target';

const OWN: Record<OwnGlyphName, ReactNode> = {
  // 🌲 A forest — the pine, two tiers and a trunk.
  tree: (
    <G>
      <Path d="M24 7 L35 21 H29.5 L38 33 H10 L18.5 21 H13 Z" {...S} />
      <Path d="M24 33 V41" {...S} />
    </G>
  ),
  // 🌱 Nothing planted yet.
  sprout: (
    <G>
      <Path d="M24 40 V23" {...S} />
      <Path d="M24 27 C24 19 18 15 10 15 C10 23 16 27 24 27 Z" {...S} />
      <Path d="M24 23 C24 16 29 12 38 12 C38 20 32 23 24 23 Z" {...S} />
      <Path d="M15 40 H33" {...S} />
    </G>
  ),
  // 🏅 / 🎖 A medal on a V ribbon.
  medal: (
    <G>
      <Path d="M16 7 L21.5 21 M32 7 L26.5 21" {...S} />
      <Circle cx="24" cy="30" r="9.5" {...S} />
      <Circle cx="24" cy="30" r="3.4" fill="currentColor" />
    </G>
  ),
  // ✨ A four-point glint with a small companion.
  sparkle: (
    <G>
      <Path d="M22 10 C23 19 27 23 36 24 C27 25 23 29 22 38 C21 29 17 25 8 24 C17 23 21 19 22 10 Z" {...S} />
      <Path d="M37 7 V14 M33.5 10.5 H40.5" {...S} />
    </G>
  ),
  // 🧭 Grind-alikes — finding your direction.
  compass: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Path d="M30.5 17.5 L26.5 26.5 L17.5 30.5 L21.5 21.5 Z" {...S} />
    </G>
  ),
  // 📊 A tracker's numbers.
  chart: (
    <G>
      <Path d="M10 9 V38 H39" {...S} />
      <Path d="M18 32 V24 M25.5 32 V16 M33 32 V21" {...S} />
    </G>
  ),
  // 🌫️ Something went wrong — a cloud over a broken horizon.
  fog: (
    <G>
      <Path d="M15 32 H33 C37 32 40 29 40 25 C40 21 37 18 33 18 C32 13.5 28.5 11 24 11 C19 11 15.5 14.5 15 19 C11 19.5 8 22.5 8 26 C8 29.5 11 32 15 32 Z" {...S} />
      <Path d="M12 38.5 H27 M31.5 38.5 H36" {...S} />
    </G>
  ),
  // 📎 Shared something.
  clip: <Path d="M33 21 L21.5 32.5 C19.5 34.5 16.5 34.5 14.5 32.5 C12.5 30.5 12.5 27.5 14.5 25.5 L28 12 C31 9 35.5 9 38 12 C40.5 14.5 40.5 19 38 21.5 L24 35.5 C20 39.5 13.5 39.5 10 35.5" {...S} />,
  // 👆 A tap hint.
  tap: (
    <G>
      <Path d="M20 27 V11.5 C20 9.5 21.3 8.5 23 8.5 C24.7 8.5 26 9.5 26 11.5 V22" {...S} />
      <Path d="M26 21 C26 19 27.3 18 29 18 C30.7 18 32 19 32 21 V23.5" {...S} />
      <Path d="M32 22.5 C32 20.5 33.3 19.5 35 19.5 C36.7 19.5 38 20.5 38 22.5 V30 C38 35.5 34.5 40 28.5 40 H25.5 C21.5 40 19 38 16.5 34.5 L11 27.5 C10 26 10.5 24 12.5 23.5 C14 23 15.2 24 16.2 25.3 L20 30" {...S} />
    </G>
  ),
  // 👑 Owner / winner — the stroke crown. (The podium's gold Crown stays the podium's.)
  crown: (
    <G>
      <Path d="M9 33 L11 15 L18.5 22.5 L24 11 L29.5 22.5 L37 15 L39 33 Z" {...S} />
      <Path d="M9 39 H39" {...S} />
    </G>
  ),
  // 🎯 A custom goal / a target.
  target: (
    <G>
      <Circle cx="24" cy="24" r="15" {...S} />
      <Circle cx="24" cy="24" r="8.5" {...S} />
      <Circle cx="24" cy="24" r="2.8" fill="currentColor" />
    </G>
  ),
};

type Source =
  | { f: 'nav'; g: NavGlyphName }
  | { f: 'ui'; g: UiGlyphName }
  | { f: 'compete'; g: CompeteGlyphName }
  | { f: 'reward'; g: RewardGlyphName }
  | { f: 'session'; g: SessionGlyphName }
  | { f: 'settings'; g: SettingsGlyphName }
  | { f: 'social'; g: SocialGlyphName }
  | { f: 'own'; g: OwnGlyphName }
  | { f: 'ember' };

// Semantic name → the drawing that already means it. Keep names about MEANING ('run' is lungs,
// 'study' is the book, 'cheer' is the flame), so a call site never has to know which family a
// glyph happens to live in.
const REGISTRY = {
  // ── brand + currency ──
  flame: { f: 'nav', g: 'flame' },
  cheer: { f: 'nav', g: 'flame' },
  streak: { f: 'nav', g: 'flame' },
  campfire: { f: 'nav', g: 'flame' },
  ember: { f: 'ember' },

  // ── nav + system ──
  home: { f: 'nav', g: 'home' },
  search: { f: 'nav', g: 'search' },
  chat: { f: 'nav', g: 'social' },
  comment: { f: 'settings', g: 'chat' },
  trophy: { f: 'nav', g: 'trophy' },
  person: { f: 'nav', g: 'person' },
  plane: { f: 'nav', g: 'plane' },
  bell: { f: 'nav', g: 'bell' },
  menu: { f: 'nav', g: 'menu' },
  plus: { f: 'nav', g: 'plus' },
  check: { f: 'ui', g: 'check' },
  'check-circle': { f: 'compete', g: 'checkCircle' },
  close: { f: 'ui', g: 'close' },
  lock: { f: 'ui', g: 'lock' },
  trash: { f: 'ui', g: 'trash' },
  share: { f: 'ui', g: 'share' },
  send: { f: 'ui', g: 'send' },
  edit: { f: 'ui', g: 'edit' },
  up: { f: 'ui', g: 'up' },
  link: { f: 'settings', g: 'link' },
  eye: { f: 'compete', g: 'eye' },
  flag: { f: 'settings', g: 'flag' },
  shield: { f: 'settings', g: 'shield' },
  heart: { f: 'settings', g: 'heart' },
  star: { f: 'settings', g: 'star' },
  megaphone: { f: 'compete', g: 'megaphone' },
  clock: { f: 'compete', g: 'clock' },
  hourglass: { f: 'compete', g: 'hourglass' },
  timer: { f: 'session', g: 'timer' },
  pause: { f: 'session', g: 'pause' },
  bolt: { f: 'compete', g: 'bolt' },
  hand: { f: 'compete', g: 'hand' },
  fog: { f: 'own', g: 'fog' },
  tap: { f: 'own', g: 'tap' },
  compass: { f: 'own', g: 'compass' },
  chart: { f: 'own', g: 'chart' },

  // ── disciplines ──
  study: { f: 'nav', g: 'book' },
  read: { f: 'nav', g: 'book' },
  'deep-work': { f: 'nav', g: 'brain' },
  gym: { f: 'nav', g: 'dumbbell' },
  run: { f: 'nav', g: 'lungs' },
  jobs: { f: 'ui', g: 'edit' },
  target: { f: 'own', g: 'target' },
  phone: { f: 'settings', g: 'phone' },
  campus: { f: 'settings', g: 'cap' },

  // ── social + media ──
  challenge: { f: 'social', g: 'swords' },
  friends: { f: 'compete', g: 'people' },
  forest: { f: 'own', g: 'tree' },
  sprout: { f: 'own', g: 'sprout' },
  everyone: { f: 'settings', g: 'globe' },
  photo: { f: 'nav', g: 'photo' },
  camera: { f: 'nav', g: 'camera' },
  video: { f: 'nav', g: 'video' },
  notes: { f: 'settings', g: 'doc' },
  clip: { f: 'own', g: 'clip' },
  session: { f: 'nav', g: 'session' },
  music: { f: 'nav', g: 'anthem' },
  play: { f: 'reward', g: 'play' },

  // ── rewards + cosmetics ──
  reward: { f: 'nav', g: 'reward' },
  box: { f: 'compete', g: 'box' },
  medal: { f: 'own', g: 'medal' },
  crown: { f: 'own', g: 'crown' },
  sparkle: { f: 'own', g: 'sparkle' },
  card: { f: 'reward', g: 'card' },
  banner: { f: 'reward', g: 'banner' },
  title: { f: 'reward', g: 'title' },
  particle: { f: 'reward', g: 'particle' },
  halo: { f: 'reward', g: 'halo' },
  flare: { f: 'reward', g: 'flare' },
  versus: { f: 'compete', g: 'versus' },
} as const satisfies Record<string, Source>;

export type IconName = keyof typeof REGISTRY;

type IconProps = {
  name: IconName;
  size?: number;
  /** Every glyph but 'ember' takes this as its one colour. Defaults to the primary ink. */
  color?: string;
};

export function Icon({ name, size = 20, color = Colors.ink }: IconProps) {
  const src: Source = REGISTRY[name];
  switch (src.f) {
    case 'nav':
      return <NavGlyph name={src.g} size={size} color={color} />;
    case 'ui':
      return <UiGlyph name={src.g} size={size} color={color} />;
    case 'compete':
      return <CompeteGlyph name={src.g} size={size} color={color} />;
    case 'reward':
      return <RewardGlyph name={src.g} size={size} color={color} />;
    case 'session':
      return <SessionGlyph name={src.g} size={size} color={color} />;
    case 'settings':
      return <SettingsGlyph name={src.g} size={size} color={color} />;
    case 'social':
      return <SocialGlyph name={src.g} size={size} color={color} />;
    case 'ember':
      return <EmberIcon size={size} />;
    case 'own':
      return (
        <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
          {OWN[src.g]}
        </Svg>
      );
  }
}

type IconTextProps = {
  icon: IconName;
  children: ReactNode;
  /** The label's text style. The icon takes its colour and sizes itself off its fontSize. */
  style?: StyleProp<TextStyle>;
  /** Override the icon's colour when it should differ from the label (an ember flame on grey text). */
  iconColor?: string;
  iconSize?: number;
  /** Icon after the label instead of before it. */
  trailing?: boolean;
  gap?: number;
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
};

/**
 * The "🔥 12" pattern with a real glyph: an icon beside a label, as one row. An Svg cannot sit
 * inside a <Text> on Android, so the pair is a View row, and the icon reads the label's own
 * colour + fontSize so the two never drift apart.
 */
export function IconText({ icon, children, style, iconColor, iconSize, trailing, gap = 4, containerStyle, numberOfLines }: IconTextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const size = iconSize ?? Math.round((flat.fontSize ?? 14) * 1.1);
  const color = iconColor ?? (typeof flat.color === 'string' ? flat.color : Colors.ink);
  const glyph = <Icon name={icon} size={size} color={color} />;
  return (
    <View style={[styles.row, { gap }, containerStyle]}>
      {trailing ? null : glyph}
      <Text style={style} numberOfLines={numberOfLines}>
        {children}
      </Text>
      {trailing ? glyph : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
