import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// THE DISCIPLINE / ACTIVITY ICON SET (mock 163).
//
// The problem it fixes: a goal type rendered as three different things depending on where you
// stood. The lock-in picker drew a raw emoji (🏋️ 🏃 📚 📖), the challenge card drew whatever
// Ionicon was closest (`footsteps`, `walk`, `fitness`), and the share card drew a third thing
// again. An emoji draws differently per OS and font version and cannot take a tint, so it sits in
// a themed row as a foreign object with its own fixed colours — the same complaint the podium
// crown had.
//
// These are the brand vectors, on mock 158's grid so they sit correctly next to the nav set:
// 24×24, 1.8 stroke, round joins, single recolorable currentColor. Paths are verbatim from
// design-mocks/163-discipline-icons.html.
//
// Swap-in points are GOAL_TYPE_GLYPH and CHALLENGE_TYPE_GLYPH in lib/goal-types.ts.

export type DisciplineIconName =
  // Goal types — the lock-in picker
  | 'gym'
  | 'run'
  | 'study'
  | 'read'
  | 'jobs'
  | 'custom'
  // Challenge metrics — the tracked-goal enum
  | 'steps'
  | 'ride'
  | 'minutes'
  | 'strain'
  | 'sleep'
  // Not a discipline — the brand flame, on the same grid, for the "general / this campfire"
  // option in the campfire-theme pickers. It is mock 158's Home glyph: those pickers wanted a
  // flame and the only one available was an Ionicons `flame`, which is a different hand.
  | 'flame';

type DisciplineIconProps = {
  name: DisciplineIconName;
  size?: number;
  /** Defaults to the inactive grey; pass the ember tint for a lit row. */
  color?: string;
};

export function DisciplineIcon({ name, size = 22, color = Colors.textTertiary }: DisciplineIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {glyph(name, color)}
      </G>
    </Svg>
  );
}

function glyph(name: DisciplineIconName, color: string): ReactNode {
  switch (name) {
    // A barbell seen end-on: two plates a side, one bar. Replaces 🏋️.
    case 'gym':
      return <Path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />;

    // A running shoe in profile, laces stroked in. Replaces 🏃 (and Ionicons' `walk`, which is a
    // pedestrian-crossing figure, not a run).
    case 'run':
      return (
        <>
          <Path d="M3.4 15C3.4 14.2 3.9 13.9 4.8 13.8L9.6 13.1 12.4 10.3 13.6 11.9C15.7 12.3 18.7 12.6 20.2 13.9 21.1 14.7 21.2 15.8 20.7 16.8 20.5 17.2 20.1 17.5 19.4 17.5L4.4 17.5C3.8 17.5 3.4 17.1 3.4 16.5Z" />
          <Path d="M4.7 15.9H19.7" />
          <Path d="M11.4 11.5 12.9 12.4" />
          <Path d="M12.5 10.5 14 11.4" />
          <Path d="M13.6 9.8 15.1 10.7" />
        </>
      );

    // A page with a folded corner and two written lines. Replaces 📚.
    case 'study':
      return (
        <>
          <Path d="M6 3.5h9l3 3v14H6z" />
          <Path d="M14 3.5V7h3.5" />
          <Path d="M9 12h6M9 15.5h4" />
        </>
      );

    // An open book, spine down the middle. Replaces 📖.
    case 'read':
      return (
        <>
          <Path d="M12 6.5c-2-1.4-5-1.4-7.5-.4v12c2.5-1 5.5-1 7.5.4 2-1.4 5-1.4 7.5-.4v-12c-2.5-1-5.5-1-7.5.4z" />
          <Path d="M12 6.5v12" />
        </>
      );

    // A clipboard with a checked application. Replaces 📝.
    case 'jobs':
      return (
        <>
          <Rect x={6} y={4.5} width={12} height={16} rx={2} />
          <Path d="M9.5 4.5V3.5h5v1" />
          <Path d="M9 12l2 2 3.5-3.5" />
        </>
      );

    // A bullseye — the pip is mass, not a state signal, so it is filled in every tint.
    case 'custom':
      return (
        <>
          <Circle cx={12} cy={12} r={7} />
          <Circle cx={12} cy={12} r={3.1} />
          <Circle cx={12} cy={12} r={0.7} fill={color} stroke="none" />
        </>
      );

    // Four footprints, alternating. Replaces Ionicons `footsteps`.
    case 'steps':
      return (
        <>
          <Path d="M7.5 6c1.6 0 2.4 1.5 2.4 3.4S9.3 13 7.7 13 5.3 11.6 5.3 9.9 5.9 6 7.5 6z" />
          <Path d="M6 14.6c1.4 0 2 .8 2 2.1s-.7 1.9-1.8 1.9S4.3 18 4.3 16.7 4.6 14.6 6 14.6z" />
          <Path d="M16.5 8c-1.6 0-2.4 1.5-2.4 3.4s.6 3.6 2.2 3.6 2.4-1.4 2.4-3.1S18.1 8 16.5 8z" />
          <Path d="M18 16.6c-1.4 0-2 .8-2 2.1s.7 1.9 1.8 1.9 1.9-.7 1.9-2S19.4 16.6 18 16.6z" />
        </>
      );

    case 'ride':
      return (
        <>
          <Circle cx={6} cy={16} r={3.4} />
          <Circle cx={18} cy={16} r={3.4} />
          <Path d="M6 16l4.5-7.5H15M9 8.5h4.5l3 7.5" />
          <Circle cx={13.5} cy={6} r={1} fill={color} stroke="none" />
        </>
      );

    // A stopwatch — workout minutes.
    case 'minutes':
      return (
        <>
          <Circle cx={12} cy={13.5} r={6.5} />
          <Path d="M12 13.5V10M10 3.5h4M18 6.5l1.5 1.5" />
        </>
      );

    // A heart with a trace through it — strain.
    case 'strain':
      return (
        <>
          <Path d="M12 20S4.5 15 4.5 9.8A3.3 3.3 0 0 1 12 7.6a3.3 3.3 0 0 1 7.5 2.2C19.5 15 12 20 12 20z" />
          <Path d="M6.5 12.2h3l1.5-2.8 2 5 1.3-2.2h3" />
        </>
      );

    case 'sleep':
      return <Path d="M17 13.5A6.2 6.2 0 0 1 9.6 5.4a6.6 6.6 0 1 0 8 8z" />;

    case 'flame':
      return (
        <Path d="M12 2.6c1.4 4.2 5.6 5.6 5.6 10.2a5.6 5.6 0 0 1-11.2 0c0-2.3 1.1-3.8 2.4-4.9 0 2.2 1.1 3.3 2.2 3.3.8-2.4-1.4-4.7 1-8.6z" />
      );
  }
}
