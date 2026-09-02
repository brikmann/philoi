import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// THE NAV ICON SET (mocks 158 / 159 / 161).
//
// What this replaces: the drawer and the tab bar were drawing from three unrelated sources at
// once — @expo/vector-icons Ionicons outlines, one MaterialCommunityIcons target, and the brand
// FlameLogo. Three families means three stroke weights, three optical sizes and three ideas of
// what a corner looks like, sitting in one vertical list. Mock 158's whole point is that a menu
// reads as a menu only when every row is drawn by the same hand.
//
// So: one 24×24 grid, 1.8 stroke, round caps and joins, single currentColor — every path below is
// copied verbatim out of design-mocks/158-nav-icons.html and 161-menu-with-agora.html rather than
// re-derived, the same rule heat-flame.tsx follows for mock 93.
//
// STATE (mock 159). The screen you're on is FILLED and Philoi orange; everything else is a grey
// outline. Style and colour both carry it, so it survives at 20px in a drawer row where colour
// alone would not. Mock 159 only draws the filled variant for Home because the rule generalises:
// the glyph's closed silhouettes take the fill, its connective strokes stay strokes. `solid`
// shapes below (the sword blades, the bullseye pip) are filled in BOTH states — they are mass in
// the drawing, not a state signal.

export type PhiloiIconName =
  | 'home'
  | 'leaderboards'
  | 'challenges'
  | 'profile'
  | 'agora'
  | 'campfires'
  | 'friends'
  | 'pass'
  | 'shop'
  | 'inventory'
  | 'forge'
  | 'settings'
  // The control that OPENS the drawer, not a destination in it. Three plain bars (mock 157's
  // `.burger`) — deliberately not the settings glyph, whose knobs make it a different word: one
  // says "menu", the other says "preferences", and the drawer contains a Settings row that would
  // otherwise wear the same icon as the button you pressed to get there.
  | 'menu'
  // ── design-mocks/101 (the campfire-as-chat pass) ──────────────────────────────────────────────
  // The + menu's four actions and the ⋯ sheet's six rows. Same rule as everything above: paths
  // copied verbatim out of the mock rather than re-derived, so the stroke weight and the corner
  // radii are the mock's and not an approximation of them.
  //
  // 'challenges' is deliberately NOT duplicated here — mock 101's "Start a challenge" dot draws the
  // identical crossed swords already sitting on the Challenges nav row, and one glyph meaning one
  // thing in two places is the whole point of this file.
  | 'camera'
  | 'share'
  | 'bell'
  | 'bell-off'
  | 'person-plus'
  | 'members'
  | 'sliders'
  | 'flag'
  | 'leave';

type PhiloiIconProps = {
  name: PhiloiIconName;
  size?: number;
  /** Mock 159's active state: filled + ember. Ignored when `color` is passed explicitly. */
  active?: boolean;
  /** Override both states — for surfaces that already know their own tint (a lit header row). */
  color?: string;
};

/** Mock 159's two nav tints: `#7a6f90` inactive, Philoi orange active. */
export const NAV_ICON_INACTIVE = Colors.textTertiary;
export const NAV_ICON_ACTIVE = Colors.amber;

export function PhiloiIcon({ name, size = 22, active = false, color }: PhiloiIconProps) {
  const tint = color ?? (active ? NAV_ICON_ACTIVE : NAV_ICON_INACTIVE);
  // The closed-silhouette fill. Not flat currentColor at full strength: an icon whose body is a
  // solid orange blob loses the interior detail (the trophy's stem, the crest's flame) that makes
  // it identifiable at nav size, so the fill sits under the stroke rather than replacing it.
  const wash = active ? tint : 'none';
  const washOpacity = 0.34;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={tint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {glyph(name, wash, washOpacity, tint)}
      </G>
    </Svg>
  );
}

function glyph(name: PhiloiIconName, wash: string, washOpacity: number, tint: string): ReactNode {
  switch (name) {
    // The brand flame — the one glyph in the set that is the mark itself, so mock 159 draws its
    // filled variant at full strength rather than as a wash.
    case 'home':
      return (
        <Path
          d="M12 2.6c1.4 4.2 5.6 5.6 5.6 10.2a5.6 5.6 0 0 1-11.2 0c0-2.3 1.1-3.8 2.4-4.9 0 2.2 1.1 3.3 2.2 3.3.8-2.4-1.4-4.7 1-8.6z"
          fill={wash === 'none' ? 'none' : tint}
        />
      );

    case 'leaderboards':
      return (
        <>
          <Path d="M7 4h10v3a5 5 0 0 1-10 0z" fill={wash} fillOpacity={washOpacity} />
          <Path d="M7 5H4.6a2.4 2.4 0 0 0 2.7 3.5" />
          <Path d="M17 5h2.4a2.4 2.4 0 0 1-2.7 3.5" />
          <Path d="M12 12v3.6" />
          <Path d="M9.5 19.4h5" />
          <Path d="M10.2 15.6h3.6v3.8h-3.6z" fill={wash} fillOpacity={washOpacity} />
        </>
      );

    // Crossed swords — the X-crossing pair from design-mocks/101 (Lucide "swords"), replacing the
    // earlier fanned solid swords. Stroke, inheriting the parent G's 1.8 round: two blades cross
    // near centre, hilts + pommels at the two bottom corners, tips at the two top corners.
    case 'challenges':
      return (
        <G fill="none">
          <Path d="M14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
          <Path d="M13 19 19 13" />
          <Path d="M16 16 20 20" />
          <Path d="M19 21 21 19" />
          <Path d="M14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
          <Path d="M5 14 9 18" />
          <Path d="M7 17 4 20" />
          <Path d="M3 19 5 21" />
        </G>
      );

    // ── mock 101 ────────────────────────────────────────────────────────────────────────────────

    case 'camera':
      return (
        <>
          <Path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.3-1.9A1 1 0 0 1 9.1 4.7h5.8a1 1 0 0 1 .83.44L17 7h2.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
          <Circle cx={12} cy={12.5} r={3.3} fill={wash} fillOpacity={washOpacity} />
        </>
      );

    // A box with an arrow leaving it — "put this somewhere else", which is what sharing a lock-in
    // into the feed is. Not the iOS share sheet's glyph by accident; it is the same idea.
    case 'share':
      return (
        <>
          <Path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
          <Path d="M16 6 12 2 8 6" />
          <Path d="M12 2v13" />
        </>
      );

    case 'bell':
      return (
        <>
          <Path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5 1.5 5h-15S6 14 6 10Z" fill={wash} fillOpacity={washOpacity} />
          <Path d="M10 19a2 2 0 0 0 4 0" />
        </>
      );

    // The muted bell: the same silhouette cut open on the left and struck through, so it reads as
    // the bell it is turning off rather than as an unrelated "no" symbol.
    case 'bell-off':
      return (
        <>
          <Path d="M6 10a6 6 0 0 1 9.2-5.1" />
          <Path d="M18 10c0 4 1.5 5 1.5 5H7" />
          <Path d="M10 19a2 2 0 0 0 4 0" />
          <Path d="M3.5 3.5 20.5 20.5" />
        </>
      );

    case 'person-plus':
      return (
        <>
          <Circle cx={9} cy={8} r={3.4} fill={wash} fillOpacity={washOpacity} />
          <Path d="M3.5 19a5.6 5.6 0 0 1 11 0" />
          <Path d="M18.5 8v6" />
          <Path d="M15.5 11h6" />
        </>
      );

    case 'members':
      return (
        <>
          <Circle cx={8.5} cy={8.5} r={3} fill={wash} fillOpacity={washOpacity} />
          <Circle cx={16.5} cy={9} r={2.3} />
          <Path d="M2.6 19a6 6 0 0 1 11.8 0" />
          <Path d="M15 19.2a5 5 0 0 1 6.4-4.3" />
        </>
      );

    // Two rails with a knob on each — settings as a mixing desk. The knobs carry a constant light
    // fill in BOTH states (mock 101 draws them at fill-opacity .15), because they are mass in the
    // drawing rather than a state signal; see the header note on `solid` shapes.
    case 'sliders':
      return (
        <>
          <Path d="M4 7.5h16" />
          <Circle cx={9} cy={7.5} r={2.3} fill={tint} fillOpacity={0.15} />
          <Path d="M4 16h16" />
          <Circle cx={15} cy={16} r={2.3} fill={tint} fillOpacity={0.15} />
        </>
      );

    case 'flag':
      return (
        <>
          <Path d="M6 3v18" />
          <Path d="M6 4.2h11l-2.2 3.2L17 10.6H6" fill={wash} fillOpacity={washOpacity} />
        </>
      );

    // Door on the right, arrow walking out to the left. Points AWAY from the room, which is the
    // half of this glyph that stops it reading as "log in".
    case 'leave':
      return (
        <>
          <Path d="M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
          <Path d="M10 8.5 6 12l4 3.5" />
          <Path d="M6 12h9" />
        </>
      );

    case 'profile':
      return (
        <>
          <Circle cx={12} cy={8} r={3.4} fill={wash} fillOpacity={washOpacity} />
          <Path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </>
      );

    // A Greek colonnade — the town square (mock 161). All connective strokes, no closed body, so
    // colour carries the active state on its own here.
    case 'agora':
      return (
        <>
          <Path d="M3.6 8.7 12 3.6 20.4 8.7" />
          <Path d="M4.6 9.1H19.4" />
          <Path d="M6.6 9.7V16.6" />
          <Path d="M9.8 9.7V16.6" />
          <Path d="M14.2 9.7V16.6" />
          <Path d="M17.4 9.7V16.6" />
          <Path d="M4.2 19.2H19.8" />
        </>
      );

    case 'campfires':
      return (
        <>
          <Path d="M12 5.2c.9 2.2 3 2.9 3 5.3a3 3 0 0 1-6 0c0-1.4 1.4-2.6 1.6-2.6" fill={wash} fillOpacity={washOpacity} />
          <Path d="M4.5 19.2l15-2.4" />
          <Path d="M4.5 16.8l15 2.4" />
        </>
      );

    case 'friends':
      return (
        <>
          <Circle cx={9} cy={8.6} r={3} fill={wash} fillOpacity={washOpacity} />
          <Path d="M3.4 19.2a5.6 5.6 0 0 1 11.2 0" />
          <Circle cx={16.6} cy={8} r={2.4} fill={wash} fillOpacity={washOpacity} />
          <Path d="M15.4 13.2a5 5 0 0 1 5.2 5.4" />
        </>
      );

    case 'pass':
      return (
        <>
          <Path d="M12 3l7 4v8l-7 4-7-4V7z" fill={wash} fillOpacity={washOpacity} />
          <Path d="M12 8c.7 1.9 2.4 2.4 2.4 4.3a2.4 2.4 0 0 1-4.8 0c0-1.1.8-1.9 1.3-2.2" />
        </>
      );

    case 'shop':
      return (
        <>
          <Path d="M6.6 8h10.8l-1 11.4a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9z" fill={wash} fillOpacity={washOpacity} />
          <Path d="M9 8a3 3 0 0 1 6 0" />
        </>
      );

    case 'inventory':
      return (
        <>
          <Rect x={4} y={4} width={6.6} height={6.6} rx={1.4} fill={wash} fillOpacity={washOpacity} />
          <Rect x={13.4} y={4} width={6.6} height={6.6} rx={1.4} fill={wash} fillOpacity={washOpacity} />
          <Rect x={4} y={13.4} width={6.6} height={6.6} rx={1.4} fill={wash} fillOpacity={washOpacity} />
          <Rect x={13.4} y={13.4} width={6.6} height={6.6} rx={1.4} fill={wash} fillOpacity={washOpacity} />
        </>
      );

    case 'forge':
      return <Path d="M3 9.5 6.5 7 H19 V10 H14 V14 L16.5 17 H7.5 L10 14 V10 H6.5 Z" fill={wash} fillOpacity={washOpacity} />;

    case 'menu':
      return (
        <>
          <Path d="M4 7h16" />
          <Path d="M4 12h16" />
          <Path d="M4 17h16" />
        </>
      );

    case 'settings':
      return (
        <>
          <Path d="M4 7.5h16" />
          <Path d="M4 12h16" />
          <Path d="M4 16.5h16" />
          <Circle cx={9} cy={7.5} r={2.1} fill={wash} fillOpacity={washOpacity} />
          <Circle cx={15.5} cy={12} r={2.1} fill={wash} fillOpacity={washOpacity} />
          <Circle cx={8} cy={16.5} r={2.1} fill={wash} fillOpacity={washOpacity} />
        </>
      );
  }
}
