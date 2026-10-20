import { useId, type ReactNode } from 'react';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

// The patron crests (design-mocks 278 art sheet): one gold line glyph per deity inside a shared
// hexagon frame, so they read as a set. Mock 278 draws twelve of the ~40 patrons; any other key
// (the registry in 0247 is larger) gets the same frame with the patron's initial, never an emoji.

const GOLD = '#FFD166';
const EMBER2 = '#FFB05A';

const line = { fill: 'none', stroke: GOLD, strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<string, ReactNode> = {
  athena: (
    <>
      <G {...line}>
        <Path d="M34 36 q16 -12 32 0" />
        <Circle cx={40} cy={48} r={8} />
        <Circle cx={60} cy={48} r={8} />
        <Path d="M47 56 l3 5 l3 -5" fill={GOLD} />
        <Path d="M34 36 l-5 -7 M66 36 l5 -7" />
        <Path d="M36 62 q14 14 28 0" />
      </G>
      <Circle cx={40} cy={48} r={2.4} fill={GOLD} />
      <Circle cx={60} cy={48} r={2.4} fill={GOLD} />
    </>
  ),
  hephaestus: (
    <G {...line}>
      <Path d="M30 66 h40 M34 66 v6 h32 v-6" />
      <Path d="M38 66 q12 -10 24 0" />
      <Rect x={52} y={28} width={20} height={9} rx={2} transform="rotate(32 62 32)" />
      <Path d="M58 40 l-14 20" />
    </G>
  ),
  hermes: (
    <G {...line}>
      <Rect x={30} y={42} width={40} height={28} rx={4} />
      <Path d="M42 42 v-4 a4 4 0 0 1 4 -4 h8 a4 4 0 0 1 4 4 v4" />
      <Path d="M30 54 h40" />
      <Rect x={46} y={50} width={8} height={8} rx={1.5} />
    </G>
  ),
  zeus: <Path d="M56 26 L36 54 H50 L44 74 L66 44 H52 Z" fill={GOLD} stroke={GOLD} strokeWidth={2} strokeLinejoin="round" />,
  poseidon: (
    <G {...line}>
      <Path d="M50 40 v34" />
      <Path d="M36 32 v8 q0 10 14 10 q14 0 14 -10 v-8" />
      <Path d="M36 32 v-6 M50 50 v-24 M64 32 v-6" />
      <Path d="M44 74 h12" />
    </G>
  ),
  daedalus: (
    <G {...line} strokeWidth={2.6}>
      <Path d="M50 52 h6 v-6 M56 46 h-12 v12 h18 v-18 h-24 v24 h30" />
    </G>
  ),
  asclepius: (
    <G {...line}>
      <Path d="M50 28 v46" />
      <Path d="M50 34 q14 6 0 12 q-14 6 0 12 q14 6 0 12" />
      <Circle cx={52} cy={32} r={2.6} fill={GOLD} />
    </G>
  ),
  apollo: (
    <>
      <G {...line}>
        <Path d="M38 44 q-6 20 6 26 M62 44 q6 20 -6 26" />
        <Path d="M38 44 q12 -8 24 0" />
        <Path d="M44 48 v20 M50 48 v22 M56 48 v20" />
      </G>
      <G stroke={EMBER2} strokeWidth={2.2} strokeLinecap="round">
        <Path d="M50 22 v5 M62 26 l-3 4 M38 26 l3 4" />
      </G>
    </>
  ),
  gaia: (
    <G {...line}>
      <Path d="M50 72 v-24" />
      <Path d="M50 54 q-16 -2 -18 -16 q16 2 18 16" />
      <Path d="M50 50 q16 -4 18 -18 q-16 4 -18 18" />
    </G>
  ),
  nike: (
    <G {...line}>
      <Path d="M40 66 q-10 -16 2 -30 M60 66 q10 -16 -2 -30" />
      <Path d="M38 44 l-5 -3 M40 54 l-6 -2 M44 62 l-6 -1 M62 44 l5 -3 M60 54 l6 -2 M56 62 l6 -1" />
      <Path d="M28 36 q8 2 10 8 M72 36 q-8 2 -10 8" />
    </G>
  ),
  heracles: (
    <G {...line}>
      <Path d="M28 66 h18" />
      <Path d="M46 66 V42" />
      <Path d="M38 42 a8 8 0 0 1 16 0" />
      <Path d="M38 42 h16" />
      <Path d="M46 56 q15 -1 15 -13 q0 -5 -5 -7" />
      <Path d="M28 66 q-3 -12 10 -14" />
    </G>
  ),
  hestia: (
    <G {...line}>
      <Path d="M50 30 q14 14 8 28 q-2 6 -8 6 q-6 0 -8 -6 q-4 -10 8 -28" />
      <Path d="M50 48 q6 6 3 14 q-3 4 -6 0 q-3 -8 3 -14" />
      <Path d="M34 72 h32" />
    </G>
  ),
};

export function PatronCrest({ patronKey, name, size = 18 }: { patronKey: string; name: string; size?: number }) {
  // Gradient ids are global in react-native-svg — per-mount, or every crest after the first blanks.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const frame = `pc${uid}`;
  const glyph = GLYPHS[patronKey];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={frame} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE29A" />
          <Stop offset="1" stopColor="#FF9E3D" />
        </LinearGradient>
      </Defs>
      <Polygon points="50,6 88,28 88,72 50,94 12,72 12,28" fill="#140F20" stroke={`url(#${frame})`} strokeWidth={4} />
      {glyph ?? (
        <SvgText x={50} y={63} fontSize={38} fontWeight="900" fill={GOLD} textAnchor="middle">
          {name.replace(/^The\s+/i, '').charAt(0).toUpperCase()}
        </SvgText>
      )}
    </Svg>
  );
}
