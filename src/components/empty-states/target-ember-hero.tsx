import { useId } from 'react';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// The Challenges tab's empty hero (design-mocks/98, screen 1) — a crosshair/target drawn in
// ember amber, sitting in a soft radial ember glow.
//
// Replaces the Spartan-armor mascot, which was carrying an illustration style nothing else in
// the Ember language uses: the rest of the app is flat ember-on-purple geometry, so a shaded
// character read as borrowed art. A target is also the more honest glyph here — the screen is
// asking you to pick something to race for.
export function TargetEmberHero({ size = 112 }: { size?: number }) {
  // Gradient ids are global in react-native-svg — see the note in primary-button.tsx.
  const glow = `targetGlow-${useId()}`;

  // Geometry is the mock's 24-unit glyph scaled by 56/24 about a 112-box centre, so the target
  // fills half the glow's diameter exactly as it does in the mock's 56-in-96 hero.
  const c = size / 2;
  const k = size / 112;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <RadialGradient id={glow} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.26" />
          <Stop offset="0.65" stopColor={Colors.coral} stopOpacity="0.08" />
          <Stop offset="1" stopColor={Colors.coral} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={c} cy={c} r={c} fill={`url(#${glow})`} />

      <Circle cx={c} cy={c} r={21 * k} stroke={Colors.amber} strokeWidth={4.2 * k} fill="none" />
      <Circle cx={c} cy={c} r={10.5 * k} stroke={Colors.amber} strokeWidth={4.2 * k} fill="none" />
      <Circle cx={c} cy={c} r={2.4 * k} fill={Colors.amber} />

      {/* The four ticks — outside the ring, on the axes. */}
      <Path
        d={`M${c} ${c - 25.7 * k}V${c - 18.7 * k}M${c} ${c + 18.7 * k}V${c + 25.7 * k}` +
          `M${c - 25.7 * k} ${c}H${c - 18.7 * k}M${c + 18.7 * k} ${c}H${c + 25.7 * k}`}
        stroke={Colors.amber}
        strokeWidth={4.2 * k}
        strokeLinecap="round"
      />
    </Svg>
  );
}
