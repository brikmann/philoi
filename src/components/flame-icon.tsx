import { View } from 'react-native';
import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { FLAME_PATH } from '@/components/ui/flame-logo';
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
const VIEWBOX_WIDTH = 24;
const VIEWBOX_HEIGHT = 24;
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
  /**
   * Mirror the mark horizontally (CINDY_SPEC, rendering rule 1). Cindy's crest points the OPPOSITE
   * way to the app-icon flame, so the companion reads as its own character rather than as the logo
   * pasted into the app. Opt-in and false by default: most callers here ARE the brand mark
   * (sign-in, campfire, share cards) and must not flip.
   */
  mirrored?: boolean;
};

export function FlameSvg({ width, height, ramp = BASE_FLAME_RAMP, mirrored = false }: FlameSvgProps) {
  // ONE path, ONE smooth vertical gradient — not three stacked opaque layers.
  //
  // The stacked version was the bug (punchlist 17 P0): outer/mid/core painted as three solid fills
  // read as the old tri-colour campfire no matter what geometry they used, which is why the Home
  // tab bar looked right (it uses FlameLogo) and every hero did not. A single silhouette with the
  // ramp feeding the gradient STOPS gives FlameLogo's look while keeping flame cosmetics working:
  // a skin still recolours the flame, it just recolours a gradient instead of three shapes.
  //
  // Geometry is FLAME_PATH, imported from flame-logo rather than copied, so the mark cannot drift
  // between the brand component and the cosmetic one again.
  const uid = useId();
  const grad = `flameRamp-${uid}`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img" aria-label="Philoi">
      <Defs>
        {/* Bottom-up: deep ember base -> mid -> pale tip, matching mock 92's #flameGrad. */}
        <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={ramp.outer} />
          <Stop offset="0.55" stopColor={ramp.mid} />
          <Stop offset="1" stopColor={ramp.core} />
        </LinearGradient>
      </Defs>
      {/* Mirrored INSIDE the svg, not with an outer scaleX(-1). SessionFlame and PersonalFlame
          already animate scaleX for the flicker, and a mirror applied on the same wrapper would
          multiply into it — the flame would flip back and forth as it flickered. Translating by
          the viewBox width keeps the mark in frame after the flip. */}
      <Path
        d={FLAME_PATH}
        fill={`url(#${grad})`}
        transform={mirrored ? `translate(${VIEWBOX_WIDTH},0) scale(-1,1)` : undefined}
      />
    </Svg>
  );
}

/**
 * The flame as the user has skinned it. Separate from FlameSvg so the raw component stays usable
 * for fixed-brand marks (the app icon, the splash, anywhere the logo must not change per user).
 */
export function EquippedFlameSvg({
  width,
  height,
  mirrored = false,
}: {
  width: number;
  height: number;
  mirrored?: boolean;
}) {
  return <FlameSvg width={width} height={height} ramp={useFlameRamp()} mirrored={mirrored} />;
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
