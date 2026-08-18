import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

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
      {/* NO LOGS. The campfire (crossed logs + three-layer flame) is retired as the mark
          (punchlist 16 §2) — the flame glyph alone is the brand now, and it's what mock 92 and the
          iOS app icon already use. Changing it HERE rather than at each call site means the hero,
          the done screen, the hexagon badge and the share cards all switch together, and flame
          COSMETICS keep working: the ramp still recolours it, which is the one thing a flame skin
          is allowed to change (PHILOI_UI_SPEC §4).

          Geometry is mock 92's `#flameMark`, scaled from its 24x24 viewBox onto this 120x150 one
          (x5, centred: x*5, y*5 + 15) so every existing size/aspect call site is unaffected. */}
      <Path
        d="M69 25 C72.5 40.5 63 49 55 56 C45.5 64.5 37.5 73.5 37.5 87.5 A32.5 32.5 0 0 0 102.5 87.5 C102.5 80.5 100.25 74 96.5 68.5 C95.25 74.25 91.5 78.25 86.25 79.5 C90.25 70.75 88.5 60 81.25 53 C65.5 49.5 75.5 38.5 69 25 Z"
        fill={ramp.outer}
      />
      <Path
        d="M69 47 C71 58 65 63.5 59.5 68.5 C53 74 48.5 80 48.5 88.5 A20.5 20.5 0 0 0 89.5 88.5 C89.5 84 88 79.5 85.5 76 C84.5 79.5 82 82 78.5 82.8 C81 77 79.9 70.5 75.4 66.2 C66 63.5 71.5 56 69 47 Z"
        fill={ramp.mid}
      />
      <Path
        d="M69 68 C70 75 67 78 64 81 C60.5 84 58 87.5 58 92 A11 11 0 0 0 80 92 C80 89.5 79.2 87 78 85 C77.4 87 76 88.4 74.2 88.8 C75.6 85.6 75 82 72.5 79.6 C67.5 78 70.4 73.6 69 68 Z"
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
