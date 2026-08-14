import { useId } from 'react';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

/** The ember/coal currency token (mock 86). Charred rim, glowing hollow core. Scales cleanly. */
export function EmberIcon({ size = 16 }: { size?: number }) {
  // Gradient ids MUST be unique per mount — react-native-svg leaks duplicate <Defs> ids across
  // instances on Android, which makes every ember after the first render blank/black. useId fixes it.
  const uid = useId();
  const core = `emberCore-${uid}`;
  const coal = `emberCoal-${uid}`;
  const h = Math.round(size * (60 / 48));
  return (
    <Svg width={size} height={h} viewBox="0 0 48 60">
      <Defs>
        <RadialGradient id={core} cx="50%" cy="60%" r="62%">
          <Stop offset="0" stopColor="#FFF3D6" />
          <Stop offset="0.34" stopColor="#FFD27A" />
          <Stop offset="0.68" stopColor="#F2A33C" />
          <Stop offset="1" stopColor="#E0612C" />
        </RadialGradient>
        {/* Outer body is ORANGE, not charcoal — warm tip at top, deep ember at the base. */}
        <LinearGradient id={coal} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8C3A" />
          <Stop offset="0.5" stopColor="#E0612C" />
          <Stop offset="1" stopColor="#8A3410" />
        </LinearGradient>
      </Defs>
      {/* Flame silhouette: sharp tip, tapered body, tongue-lick on the left. */}
      <Path d="M24 3 C26 15 37 23 37 39 C37 49 31 56 24 56 C17 56 11 49 11 39 C11 30 17 26 20 32 C19 21 22 12 24 3 Z" fill={`url(#${coal})`} />
      <Path d="M24 13 C25.5 22 31 28 31 39 C31 47 28 51 24 51 C20 51 17 47 17 39 C17 32 20 30 22 34 C21 26 23 20 24 13 Z" fill={`url(#${core})`} />
      <Path d="M24 23 C25 29 27.5 33 27.5 40 C27.5 45 26 48 24 48 C22 48 20.5 45 20.5 40 C20.5 35 22 34 23 36 C22.5 31 23.5 27 24 23 Z" fill="#FFF1CE" opacity={0.85} />
    </Svg>
  );
}
