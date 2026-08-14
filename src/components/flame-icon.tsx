import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { BASE_FLAME_RAMP, useFlameRamp, type FlameRamp } from '@/lib/economy/flame-ramp';

type FlameIconProps = {
  /** Height of the flame mark (or the side length of the square backplate when `background` is set). */
  size?: number;
  /** Square backplate behind the flame (app-icon style) — pass null for the flame alone (e.g. inline next to text). */
  background?: string | null;
};

// PHILOI_UI_SPEC.md §3 — the campfire (crossed logs + three-layer flame), working vector.
// viewBox is intentionally non-square (120x150, taller than wide) — a designer can refine
// the curves later without changing this component's API or the token colors it draws from.
const VIEWBOX_WIDTH = 120;
const VIEWBOX_HEIGHT = 150;
export const FLAME_ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

type FlameSvgProps = {
  width: number;
  height: number;
  /**
   * Equipped flame colourway. Omit to use the stock ramp. This is the ONLY thing a flame cosmetic
   * may change (PHILOI_UI_SPEC §4) — the geometry, the logs, and every animation driven off this
   * vector are identical whatever is equipped, because those signal real activity.
   */
  ramp?: FlameRamp;
};

export function FlameSvg({ width, height, ramp = BASE_FLAME_RAMP }: FlameSvgProps) {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img" aria-label="Philoi">
      {/* logs — never recoloured by a skin; they're the hearth, not the flame */}
      <Rect x={30} y={112} width={60} height={9} rx={4} fill={Colors.logBrown} rotation={18} origin="60, 116" />
      <Rect x={30} y={112} width={60} height={9} rx={4} fill={Colors.logBrownDark} rotation={-18} origin="60, 116" />
      <Circle cx={60} cy={116} r={4} fill={ramp.mid} />
      {/* flame: outer / mid / core */}
      <Path
        d="M60 20 C74 46 90 62 85 92 C82 108 72 116 60 116 C48 116 37 107 37 92 C37 82 42 76 47 72 C44 84 51 92 59 92 C68 92 72 82 67 72 C60 58 52 44 60 20 Z"
        fill={ramp.outer}
      />
      <Path
        d="M60 44 C70 62 78 74 74 92 C72 104 67 110 60 110 C52 110 47 103 47 93 C47 86 50 82 54 80 C52 88 56 94 61 94 C67 94 70 87 67 80 C62 70 56 58 60 44 Z"
        fill={ramp.mid}
      />
      <Path
        d="M60 66 C66 78 70 84 68 94 C67 101 64 105 60 105 C55 105 52 100 52 94 C52 88 55 84 60 66 Z"
        fill={ramp.core}
      />
    </Svg>
  );
}

/**
 * The flame as the user has skinned it. Separate from FlameSvg so the raw component stays usable
 * for fixed-brand marks (the app icon, the splash, anywhere the logo must not change per user).
 */
export function EquippedFlameSvg({ width, height }: { width: number; height: number }) {
  return <FlameSvg width={width} height={height} ramp={useFlameRamp()} />;
}

export function FlameIcon({ size = 32, background = Colors.plum }: FlameIconProps) {
  if (background) {
    // App-icon style: flame centered on a full-bleed square backplate, no transparency.
    const flameHeight = size * 0.72;
    const flameWidth = flameHeight * FLAME_ASPECT_RATIO;
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.24,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
        <FlameSvg width={flameWidth} height={flameHeight} />
      </View>
    );
  }

  const height = size;
  const width = height * FLAME_ASPECT_RATIO;
  return <FlameSvg width={width} height={height} />;
}
