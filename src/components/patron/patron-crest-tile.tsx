import { useId, type ReactNode } from 'react';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

// THE PATRON CRESTS (Phase 9, mocks 340 / 341) — one rounded gradient tile per persona with its
// emblem: Zeus's bolt, Heracles's club, Athena's owl, Socrates's column, Aphrodite's shell, Ares's
// crossed swords, Apollo's lyre, Nike's wing, Hermes's winged cap, Hades's bident, Artemis's bow,
// Dionysus's grapes. GENERATED from design-mocks/patron-crests/<key>.svg by a converter — the SVGs
// are the source; symbol + palette per patron are locked (and are the brief for any bespoke pass).
//
// Drawn on the source's own 120 canvas, cropped to the tile (6–114) so `size` is the tile's edge.
// The source's drop-shadow filter is left out: react-native-svg's filter support isn't reliable on
// both platforms, and the tile reads on the dark UI without it.
//
// A key that isn't one of the twelve (a retired program-era patron the server hasn't resolved, or a
// patron added server-side before a build ships its art) draws a neutral tile with the initial.

type Crest = { from: string; to: string; emblem: ReactNode };

const CRESTS: Record<string, Crest> = {
  zeus: {
    from: '#ffd166',
    to: '#ff9e3d',
    emblem: (
      <>
      <Polygon points="28,5 13,27 22,27 19,43 35,19 26,19 32,5" fill="#160d26" />
      </>
    ),
  },
  heracles: {
    from: '#ff8a5c',
    to: '#e0533d',
    emblem: (
      <>
      <Line x1={13} y1={37} x2={30} y2={20} stroke="#160d26" strokeWidth={5} strokeLinecap="round" />
      <Circle cx={33} cy={16} r={7.5} fill="#160d26" />
      <Circle cx={31} cy={13} r={1.3} fill="#ffd166" />
      <Circle cx={36} cy={15} r={1.3} fill="#ffd166" />
      <Circle cx={33} cy={18.5} r={1.3} fill="#ffd166" />
      </>
    ),
  },
  athena: {
    from: '#8fb4ff',
    to: '#5a7af0',
    emblem: (
      <>
      <Path d="M24 12c-7 0-12 5-12 13 0 7 5 12 12 12s12-5 12-12c0-8-5-13-12-13z" fill="#160d26" />
      <Path d="M13 13l3.5 7 4.5-3z" fill="#160d26" />
      <Path d="M35 13l-3.5 7-4.5-3z" fill="#160d26" />
      <Circle cx={19} cy={23} r={4.3} fill="#fff" />
      <Circle cx={29} cy={23} r={4.3} fill="#fff" />
      <Circle cx={19} cy={23} r={1.9} fill="#160d26" />
      <Circle cx={29} cy={23} r={1.9} fill="#160d26" />
      <Path d="M24 27l-2.6 4h5.2z" fill="#ffd166" />
      </>
    ),
  },
  socrates: {
    from: '#b98bff',
    to: '#7a4df0',
    emblem: (
      <>
      <Rect x={13} y={11} width={22} height={4} rx={1} fill="#160d26" />
      <Rect x={16.5} y={15} width={15} height={19} fill="#160d26" />
      <Rect x={12} y={34} width={24} height={4.5} rx={1} fill="#160d26" />
      <G stroke="#ffb05a" strokeWidth={1.3}>
        <Line x1={20} y1={16} x2={20} y2={33} />
        <Line x1={24} y1={16} x2={24} y2={33} />
        <Line x1={28} y1={16} x2={28} y2={33} />
      </G>
      </>
    ),
  },
  aphrodite: {
    from: '#ff9ebf',
    to: '#e05dc8',
    emblem: (
      <>
      <Path d="M24 15C14 17 11 29 13 36L35 36C37 29 34 17 24 15Z" fill="#fff0f6" />
      <G stroke="#160d26" strokeWidth={1.4} strokeLinecap="round">
        <Line x1={24} y1={34} x2={24} y2={18} />
        <Line x1={24} y1={34} x2={16} y2={20} />
        <Line x1={24} y1={34} x2={32} y2={20} />
        <Line x1={24} y1={34} x2={14} y2={28} />
        <Line x1={24} y1={34} x2={34} y2={28} />
      </G>
      <Circle cx={24} cy={35} r={2} fill="#160d26" />
      </>
    ),
  },
  ares: {
    from: '#ff6f6f',
    to: '#d63a3a',
    emblem: (
      <>
      <G stroke="#160d26" strokeWidth={3.2} strokeLinecap="round">
        <Line x1={13} y1={13} x2={33} y2={33} />
        <Line x1={35} y1={13} x2={15} y2={33} />
      </G>
      <G stroke="#ffd166" strokeWidth={3.4} strokeLinecap="round">
        <Line x1={33} y1={33} x2={37} y2={37} />
        <Line x1={15} y1={33} x2={11} y2={37} />
      </G>
      <G stroke="#160d26" strokeWidth={2.4} strokeLinecap="round">
        <Line x1={30} y1={38} x2={37} y2={31} />
        <Line x1={18} y1={38} x2={11} y2={31} />
      </G>
      </>
    ),
  },
  apollo: {
    from: '#ffe08a',
    to: '#ffb03d',
    emblem: (
      <>
      <G fill="none" stroke="#160d26" strokeWidth={3} strokeLinecap="round">
        <Path d="M16 34C12 24 14 14 20 12" />
        <Path d="M32 34C36 24 34 14 28 12" />
        <Line x1={16} y1={34} x2={32} y2={34} />
        <Line x1={20} y1={12} x2={28} y2={12} />
      </G>
      <G stroke="#ffd166" strokeWidth={1.3}>
        <Line x1={21} y1={14} x2={20.5} y2={32} />
        <Line x1={24} y1={14} x2={24} y2={32} />
        <Line x1={27} y1={14} x2={27.5} y2={32} />
      </G>
      </>
    ),
  },
  nike: {
    from: '#7af0c0',
    to: '#1fae6b',
    emblem: (
      <>
      <G fill="#160d26">
        <Path d="M12 35C16 31 23 29 31 28C25 28 21 30 16 34Z" />
        <Path d="M14 29C20 25 27 23 34 22C28 22 23 25 18 29Z" fill="#160d26" />
        <Path d="M17 23C23 19 30 16 37 15C31 16 26 19 21 24Z" fill="#160d26" />
      </G>
      </>
    ),
  },
  hermes: {
    from: '#9fe0ff',
    to: '#36c8d6',
    emblem: (
      <>
      <Path d="M14 27a10 6.5 0 0 1 20 0z" fill="#160d26" />
      <Rect x={12} y={27} width={24} height={3.4} rx={1.7} fill="#160d26" />
      <Path d="M14 23C8 20 5 22 6 26C10 23 12 24 15 25Z" fill="#9fe0ff" />
      <Path d="M34 23C40 20 43 22 42 26C38 23 36 24 33 25Z" fill="#9fe0ff" />
      </>
    ),
  },
  hades: {
    from: '#b0a0d8',
    to: '#6b5aa0',
    emblem: (
      <>
      <G fill="none" stroke="#160d26" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <Line x1={24} y1={19} x2={24} y2={40} />
        <Line x1={18} y1={19} x2={30} y2={19} />
        <Path d="M18 19V10" />
        <Path d="M30 19V10" />
      </G>
      <Circle cx={18} cy={9} r={1.8} fill="#160d26" />
      <Circle cx={30} cy={9} r={1.8} fill="#160d26" />
      <Circle cx={24} cy={24} r={2.3} fill="#b98bff" />
      </>
    ),
  },
  artemis: {
    from: '#8fe0b0',
    to: '#2f9e6b',
    emblem: (
      <>
      <G fill="none" stroke="#160d26" strokeWidth={3} strokeLinecap="round">
        <Path d="M31 9C19 17 19 31 31 39" />
        <Line x1={31} y1={9} x2={31} y2={39} />
      </G>
      <Line x1={12} y1={24} x2={40} y2={24} stroke="#ffb05a" strokeWidth={2.6} strokeLinecap="round" />
      <Path d="M41 24l-6-3.2v6.4z" fill="#160d26" />
      <G stroke="#160d26" strokeWidth={2} strokeLinecap="round">
        <Line x1={12} y1={24} x2={16} y2={20.5} />
        <Line x1={12} y1={24} x2={16} y2={27.5} />
      </G>
      </>
    ),
  },
  dionysus: {
    from: '#ffb0d0',
    to: '#e0608f',
    emblem: (
      <>
      <Path d="M24 20C24 14 28 11 34 11" fill="none" stroke="#39d98a" strokeWidth={2} strokeLinecap="round" />
      <Path d="M34 11c4-2 6 1 4.2 4C35 16 33 14 34 11z" fill="#39d98a" />
      <G fill="#160d26">
        <Circle cx={20} cy={22} r={3.3} />
        <Circle cx={27} cy={22} r={3.3} />
        <Circle cx={16.5} cy={28} r={3.3} />
        <Circle cx={23.5} cy={28} r={3.3} />
        <Circle cx={30.5} cy={28} r={3.3} />
        <Circle cx={20} cy={34} r={3.3} />
        <Circle cx={27} cy={34} r={3.3} />
        <Circle cx={23.5} cy={39.5} r={3.1} />
      </G>
      </>
    ),
  },
};

export const PATRON_CREST_KEYS = Object.keys(CRESTS);

export function PatronCrestTile({ patronKey, name, size }: { patronKey: string; name?: string | null; size: number }) {
  const gid = `pc${useId().replace(/:/g, '')}`;
  const crest = CRESTS[patronKey];
  const from = crest?.from ?? '#3a2d5c';
  const to = crest?.to ?? '#241a3d';
  return (
    <Svg width={size} height={size} viewBox="6 6 108 108">
      <Defs>
        <LinearGradient id={gid} x1={0} y1={0} x2={1} y2={1}>
          <Stop offset={0} stopColor={from} />
          <Stop offset={1} stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={6} y={6} width={108} height={108} rx={28} fill={`url(#${gid})`} />
      {crest ? (
        <G transform="translate(24,24) scale(1.5)">{crest.emblem}</G>
      ) : (
        <SvgText x={60} y={78} fontSize={48} fontWeight="900" fill="#ffffff" textAnchor="middle">
          {(name ?? patronKey).trim().charAt(0).toUpperCase() || '?'}
        </SvgText>
      )}
    </Svg>
  );
}
