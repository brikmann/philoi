import { useId } from 'react';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

// The leaderboard #1 crown (punchlist A2, design-mocks/105 Option A — "3-peak royal").
//
// Replaces a raw 👑 emoji on the podium apex. An emoji is not a brand asset: it renders as a
// different drawing on every OS and font version, it cannot take the podium's gold, and at 18px
// on Android it was a flat glyph beside three carefully-lit metal pillars.
//
// Geometry is lifted verbatim from the mock's Option A so the vector matches what was approved,
// viewBox 0 0 48 38. The gold stops are deliberately the SAME hexes as PILLAR_METAL's gold entry
// in parthenon-podium.tsx (#FFE9A8 / #F5C542 / #C79A16, edge #8A6A10) — the crown has to read as
// cut from the first-place pillar, not as a gold-ish sticker sitting on top of it. They are
// restated here rather than imported to keep this a standalone primitive; if the pillar gold ever
// moves, these move with it.

const CROWN_ASPECT = 48 / 38;

type CrownProps = {
  /** Crown width in px; height follows the mock's 48x38 aspect. */
  size?: number;
};

export function Crown({ size = 26 }: CrownProps) {
  // Gradient ids are GLOBAL in react-native-svg — a hardcoded id blanks every instance after the
  // first on Android. Same reason FlameLogo and EmberIcon carry one.
  const uid = useId();
  const gold = `crownGold-${uid}`;
  const gem = `crownGem-${uid}`;
  const ruby = `crownRuby-${uid}`;
  const sapphire = `crownSapphire-${uid}`;
  const emerald = `crownEmerald-${uid}`;

  return (
    <Svg width={size} height={size / CROWN_ASPECT} viewBox="0 0 48 38" role="img" aria-label="First place">
      <Defs>
        <LinearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE9A8" />
          <Stop offset="0.5" stopColor="#F5C542" />
          <Stop offset="1" stopColor="#C79A16" />
        </LinearGradient>
        <RadialGradient id={gem} cx="50%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FF8A8A" />
          <Stop offset="1" stopColor="#C0392B" />
        </RadialGradient>
        <LinearGradient id={ruby} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF5A72" />
          <Stop offset="0.45" stopColor="#C41E3A" />
          <Stop offset="1" stopColor="#7A0F1E" />
        </LinearGradient>
        <LinearGradient id={sapphire} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6BA8FF" />
          <Stop offset="0.5" stopColor="#2E5BC0" />
          <Stop offset="1" stopColor="#16307A" />
        </LinearGradient>
        <LinearGradient id={emerald} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#6FE0A0" />
          <Stop offset="0.5" stopColor="#1FA05A" />
          <Stop offset="1" stopColor="#0D5E33" />
        </LinearGradient>
      </Defs>

      {/* The band + three peaks, one path. */}
      <Path
        d="M5 34 L5 17 L14 23 L24 9 L34 23 L43 17 L43 34 Z"
        fill={`url(#${gold})`}
        stroke="#8A6A10"
        strokeWidth={0.6}
        strokeLinejoin="round"
      />
      <Rect x={5} y={30} width={38} height={4.5} fill="#C79A16" />

      {/* Ruby accents capping each of the three peaks. */}
      <Circle cx={5} cy={17} r={2.6} fill={`url(#${gem})`} />
      <Circle cx={24} cy={9} r={3} fill={`url(#${gem})`} />
      <Circle cx={43} cy={17} r={2.6} fill={`url(#${gem})`} />

      {/* Centre ruby: elongated hexagon cut, dead-centre at the midpoint of peak <-> band. The
          three overlaid paths are the stone, its top-facet highlight, and the facet lines — that
          layering is what stops it reading as a flat red blob at podium size. */}
      <Path
        d="M24 17.4 L26.4 19.6 L26.4 23.4 L24 25.6 L21.6 23.4 L21.6 19.6 Z"
        fill={`url(#${ruby})`}
        stroke="#5E0C18"
        strokeWidth={0.4}
        strokeLinejoin="round"
      />
      <Path d="M24 17.4 L26.4 19.6 L24 20.9 L21.6 19.6 Z" fill="#FF8397" opacity={0.6} />
      <Path
        d="M21.6 19.6 L26.4 19.6 M24 20.9 L24 25.6 M21.6 23.4 L24 20.9 L26.4 23.4"
        stroke="#7A0F1E"
        strokeWidth={0.3}
        fill="none"
        opacity={0.55}
      />

      {/* Side stones: sapphire left, emerald right, each with a small specular ellipse. */}
      <Circle cx={15.5} cy={24.5} r={2.3} fill={`url(#${sapphire})`} stroke="#12245E" strokeWidth={0.4} />
      <Ellipse cx={14.7} cy={23.6} rx={0.8} ry={0.5} fill="#CFE2FF" opacity={0.7} />
      <Circle cx={32.5} cy={24.5} r={2.3} fill={`url(#${emerald})`} stroke="#0B4A2A" strokeWidth={0.4} />
      <Ellipse cx={31.7} cy={23.6} rx={0.8} ry={0.5} fill="#CFF7E0" opacity={0.7} />
    </Svg>
  );
}
