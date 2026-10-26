import type { ReactNode } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import type { NavGlyphName } from '@/components/ui/nav-glyph';
import type { GoalType } from '@/types/database';

// THE SESSION GLYPHS — the running lock-in's own controls (pause, play, camera, audio, energy,
// minimize…), drawn in the same hand as ui-glyph.tsx: 48 grid, 2.6 round stroke, single
// `currentColor`. Kept apart from ui-glyph.tsx because only the timer and its done screen use these,
// and that file is the app-wide control set. Pause and play are filled — they sit on a lit disc at
// 18px, where an outline reads as a smudge.

export type SessionGlyphName =
  | 'pause'
  | 'play'
  | 'camera'
  | 'music'
  | 'minimize'
  | 'timer'
  | 'shield'
  | 'level1'
  | 'level2'
  | 'level3';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<SessionGlyphName, ReactNode> = {
  pause: (
    <G>
      <Rect x="14" y="11" width="7" height="26" rx="2.4" fill="currentColor" />
      <Rect x="27" y="11" width="7" height="26" rx="2.4" fill="currentColor" />
    </G>
  ),
  play: <Path d="M16 10.5 C16 9 17.6 8.1 18.9 8.9 L37.4 22.4 C38.5 23.2 38.5 24.8 37.4 25.6 L18.9 39.1 C17.6 39.9 16 39 16 37.5 Z" fill="currentColor" />,
  camera: (
    <G>
      <Path d="M9 17 C9 15.3 10.3 14 12 14 H17 L20 10 H28 L31 14 H36 C37.7 14 39 15.3 39 17 V35 C39 36.7 37.7 38 36 38 H12 C10.3 38 9 36.7 9 35 Z" {...S} />
      <Circle cx="24" cy="25.5" r="6.5" {...S} />
    </G>
  ),
  music: (
    <G>
      <Path d="M19 33 V12 L37 9 V30" {...S} />
      <Circle cx="15" cy="33" r="4.5" {...S} />
      <Circle cx="33" cy="30" r="4.5" {...S} />
    </G>
  ),
  minimize: <Path d="M13 24 H35" {...S} />,
  timer: (
    <G>
      <Circle cx="24" cy="27" r="13" {...S} />
      <Path d="M24 27 V20" {...S} />
      <Path d="M20 9 H28" {...S} />
      <Path d="M24 9 V14" {...S} />
    </G>
  ),
  shield: (
    <G>
      <Path d="M24 8 L37 13 V23 C37 31 31.5 37 24 40 C16.5 37 11 31 11 23 V13 Z" {...S} />
      <Path d="M18.5 24 L22.5 28 L30 20" {...S} />
    </G>
  ),
  // The gym energy chips (light / same / dialed): three rising bars, lit up to the level. Bars
  // rather than a leaf/flash pair so the three read as one scale, not three unrelated things.
  level1: (
    <G>
      <Rect x="10" y="28" width="7" height="10" rx="2" fill="currentColor" />
      <Rect x="20.5" y="20" width="7" height="18" rx="2" {...S} />
      <Rect x="31" y="11" width="7" height="27" rx="2" {...S} />
    </G>
  ),
  level2: (
    <G>
      <Rect x="10" y="28" width="7" height="10" rx="2" fill="currentColor" />
      <Rect x="20.5" y="20" width="7" height="18" rx="2" fill="currentColor" />
      <Rect x="31" y="11" width="7" height="27" rx="2" {...S} />
    </G>
  ),
  level3: (
    <G>
      <Rect x="10" y="28" width="7" height="10" rx="2" fill="currentColor" />
      <Rect x="20.5" y="20" width="7" height="18" rx="2" fill="currentColor" />
      <Rect x="31" y="11" width="7" height="27" rx="2" fill="currentColor" />
    </G>
  ),
};

export function SessionGlyph({ name, size = 20, color }: { name: SessionGlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" color={color}>
      {GLYPHS[name]}
    </Svg>
  );
}

/**
 * A flat goal_type → the Lock In tab's discipline glyph (nav-glyph.tsx), so a finished session
 * wears the same mark it was started from. Follows categoryForGoalType: 'custom' and
 * 'job_applications' are Deep Work (brain), 'read' is Studying (book), 'run' is Cardio (lungs).
 * Exhaustive over GoalType on purpose — a new type fails the type-check here, not at runtime.
 */
export const GOAL_TYPE_NAV_GLYPH: Record<GoalType, NavGlyphName> = {
  gym: 'dumbbell',
  run: 'lungs',
  study: 'book',
  read: 'book',
  custom: 'brain',
  job_applications: 'brain',
  social_media: 'plus',
};
