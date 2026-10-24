import { useId, type ReactNode } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

// The patron crests — the house seal (mocks 278 / 288 / 290). One bold gold SILHOUETTE per deity
// inside a shared hexagon frame, so the forty read as a set. Silhouettes, not line art: mock 290
// sized every glyph at 44/30/22/15px, and only a filled shape survives being shrunk to sit beside a
// name. The previous twelve were stroked line glyphs (Heracles as a lion pelt and club); the house
// sheet redrew him as a DUMBBELL, which is the one his Kinesiology heirs recognise at a glance.
//
// Each glyph is drawn on mock 290's own 0–100 canvas and scaled into the hexagon, so a path here
// can be checked against the sheet number for number. `attribute` in 0257_programs_and_patrons.sql
// is the brief each one was built from.
//
// ── SMALL SIZES ──
//
// Ten glyphs lean on detail that blurs below ~22px — the coils, the strings, the concentric arcs,
// the interlocks (mock 290's "!" column). Those carry a SIMPLIFIED cut, used automatically at
// SMALL_AT and below: fewer parts, heavier weight, the same silhouette. Every other glyph already
// reads at 15px and draws the same at every size. An unknown key (a patron added server-side before
// a build ships its art) gets the frame with the patron's initial, never an emoji.

const GOLD = '#FFD166';
/** The frame's fill — the cut-outs inside a silhouette (owl pupils, a coin's hole) are this. */
const DARK = '#140F20';

/** At or below this diameter, the ten fine glyphs switch to their simplified cut. */
const SMALL_AT = 22;

/** How much of the hexagon a glyph fills. A shade larger when small, so the shape outweighs the rim. */
const GLYPH_SCALE = 0.58;
const GLYPH_SCALE_SMALL = 0.66;

const GLYPHS: Record<string, ReactNode> = {
  // lion pelt & club → the dumbbell (mock 290)
  heracles: (
    <G fill={GOLD}>
      <Rect x={30} y={44} width={40} height={12} rx={2} />
      <Rect x={18} y={33} width={12} height={34} rx={3} />
      <Rect x={70} y={33} width={12} height={34} rx={3} />
      <Rect x={8} y={40} width={8} height={20} rx={2} />
      <Rect x={84} y={40} width={8} height={20} rx={2} />
    </G>
  ),
  // winged wreath → the wing
  nike: (
    <Path
      d="M16 48 C40 30 66 32 86 42 C66 46 54 46 54 46 C72 50 82 56 88 62 C66 62 56 58 56 58 C68 64 74 70 76 76 C50 72 28 62 16 48 Z"
      fill={GOLD}
    />
  ),
  // caduceus & winged sandals → the winged staff
  hermes: (
    <G fill={GOLD}>
      <Rect x={45} y={22} width={10} height={62} rx={3} />
      <Path d="M50 22 q-30 -4 -40 12 q22 2 40 12 q18 -10 40 -12 q-10 -16 -40 -12z" />
    </G>
  ),
  // bowl & serpent → the chalice
  hygieia: (
    <G fill={GOLD}>
      <Path d="M26 28 h48 a24 24 0 0 1 -48 0z" />
      <Rect x={46} y={48} width={8} height={26} />
      <Rect x={32} y={74} width={36} height={8} rx={3} />
    </G>
  ),
  asclepius: (
    <>
      <Rect x={46} y={16} width={8} height={70} rx={3} fill={GOLD} />
      <Path d="M50 30 c22 6 22 16 0 20 c-22 6 -22 16 0 20" fill="none" stroke={GOLD} strokeWidth={9} strokeLinecap="round" />
    </>
  ),
  panacea: <Path d="M42 16 h16 v16 l14 38 a8 8 0 0 1 -8 12 H36 a8 8 0 0 1 -8 -12 l14 -38z" fill={GOLD} />,
  // bow & stag → bow and arrow
  artemis: (
    <>
      <Path d="M32 18 q38 32 0 64" fill="none" stroke={GOLD} strokeWidth={9} strokeLinecap="round" />
      <Rect x={22} y={46} width={60} height={8} rx={3} fill={GOLD} />
      <Path d="M74 42 l14 8 -14 8z" fill={GOLD} />
    </>
  ),
  demeter: (
    <G fill={GOLD}>
      <Rect x={47} y={34} width={6} height={52} rx={3} />
      <Path d="M50 22 l-11 9 11 6 11 -6z" />
      <Path d="M50 38 l-11 9 11 6 11 -6z" />
      <Path d="M50 54 l-11 9 11 6 11 -6z" />
    </G>
  ),
  // bearing the cosmos → the globe
  atlas: (
    <G fill="none" stroke={GOLD} strokeWidth={9}>
      <Circle cx={50} cy={52} r={30} />
      <Ellipse cx={50} cy={52} rx={12} ry={30} />
      <Line x1={20} y1={52} x2={80} y2={52} />
    </G>
  ),
  urania: <Path d="M50 10 L61 40 L93 42 L68 61 L77 92 L50 73 L23 92 L32 61 L7 42 L39 40 Z" fill={GOLD} />,
  hecate: (
    <G fill={GOLD}>
      <Path d="M38 86 v-20 c-9 -6 -9 -20 0 -30 c-2 9 4 13 6 17 c2 -6 -2 -13 0 -19 c9 9 11 24 2 32 v20z" />
      <Path d="M62 86 v-20 c-9 -6 -9 -20 0 -30 c-2 9 4 13 6 17 c2 -6 -2 -13 0 -19 c9 9 11 24 2 32 v20z" />
    </G>
  ),
  athena: (
    <>
      <G fill={GOLD}>
        <Circle cx={38} cy={48} r={16} />
        <Circle cx={62} cy={48} r={16} />
        <Path d="M44 66 h12 l-6 11z" />
      </G>
      <Circle cx={38} cy={48} r={6} fill={DARK} />
      <Circle cx={62} cy={48} r={6} fill={DARK} />
    </>
  ),
  // thread & spindle
  moirai: (
    <G fill={GOLD}>
      <Rect x={47} y={14} width={6} height={72} rx={3} />
      <Path d="M50 32 l-18 18 18 18 18 -18z" />
    </G>
  ),
  // woven knot
  metis: <Path d="M34 40 a14 14 0 1 1 20 14 a14 14 0 1 0 20 -14" fill="none" stroke={GOLD} strokeWidth={10} strokeLinecap="round" />,
  // hammer & anvil → the hammer
  hephaestus: (
    <G fill={GOLD}>
      <Rect x={20} y={22} width={60} height={22} rx={4} />
      <Rect x={43} y={44} width={14} height={42} rx={3} />
    </G>
  ),
  // labyrinth & compass → the labyrinth
  daedalus: <Path d="M20 20 h60 v60 h-48 v-48 h36 v36 h-24 v-24 h12 v12" fill="none" stroke={GOLD} strokeWidth={8} />,
  // cornucopia → the coin
  plutus: (
    <>
      <Circle cx={50} cy={50} r={30} fill={GOLD} />
      <Circle cx={50} cy={50} r={21} fill={DARK} />
      <Rect x={46} y={34} width={8} height={32} fill={GOLD} />
      <Rect x={38} y={46} width={24} height={8} fill={GOLD} />
    </>
  ),
  // ribbon → the bow
  peitho: (
    <G fill={GOLD}>
      <Path d="M50 50 L24 33 v34z" />
      <Path d="M50 50 L76 33 v34z" />
      <Circle cx={50} cy={50} r={8} />
    </G>
  ),
  psyche: (
    <G fill={GOLD}>
      <Rect x={47} y={30} width={6} height={40} rx={3} />
      <Path d="M50 32 C22 10 8 34 20 52 C8 70 32 82 50 60 Z" />
      <Path d="M50 32 C78 10 92 34 80 52 C92 70 68 82 50 60 Z" />
    </G>
  ),
  // still water → the drop
  mnemosyne: <Path d="M50 14 C66 44 74 56 74 66 a24 24 0 0 1 -48 0 C26 56 34 44 50 14Z" fill={GOLD} />,
  hestia: (
    <Path
      d="M50 12 C62 34 76 42 68 62 C64 76 72 82 60 88 C66 80 58 70 52 74 C56 64 48 60 48 52 C42 60 40 70 44 80 C34 74 32 60 40 48 C48 38 50 28 50 12Z"
      fill={GOLD}
    />
  ),
  // globe & leaf → the leaf
  gaia: (
    <>
      <Path d="M50 14 C20 36 20 70 50 88 C80 70 80 36 50 14Z" fill={GOLD} />
      <Rect x={47} y={24} width={6} height={58} fill={DARK} />
    </>
  ),
  // dove & shell → the shell
  aphrodite: (
    <>
      <Path d="M50 82 C18 60 22 28 50 26 C78 28 82 60 50 82Z" fill={GOLD} />
      <G stroke={DARK} strokeWidth={5}>
        <Line x1={50} y1={28} x2={50} y2={80} />
        <Line x1={38} y1={32} x2={33} y2={78} />
        <Line x1={62} y1={32} x2={67} y2={78} />
      </G>
    </>
  ),
  themis: (
    <G fill={GOLD}>
      <Rect x={47} y={16} width={6} height={66} rx={3} />
      <Rect x={24} y={27} width={52} height={6} rx={3} />
      <Path d="M24 30 l-11 20 h22z" />
      <Path d="M76 30 l-11 20 h22z" />
      <Rect x={36} y={80} width={28} height={7} rx={2} />
    </G>
  ),
  // scales & sword → the sword (the scales are Themis's)
  nemesis: (
    <G fill={GOLD}>
      <Rect x={46} y={16} width={8} height={54} />
      <Rect x={33} y={64} width={34} height={8} rx={2} />
      <Path d="M46 72 h8 l-4 14z" />
    </G>
  ),
  zeus: <Path d="M58 8 L26 54 H46 L40 92 L76 40 H54 Z" fill={GOLD} />,
  // spear & helm → the helm
  ares: (
    <>
      <Path d="M28 48 C28 25 72 25 72 48 C72 60 64 66 64 66 L64 80 L52 80 L52 66 C40 66 28 60 28 48Z" fill={GOLD} />
      <Rect x={40} y={43} width={26} height={7} fill={DARK} />
    </>
  ),
  clio: (
    <>
      <Rect x={30} y={30} width={40} height={40} rx={7} fill={GOLD} />
      <Path d="M30 34 a9 9 0 0 0 0 32 M70 34 a9 9 0 0 1 0 32" fill="none" stroke={DARK} strokeWidth={5} />
    </>
  ),
  calliope: (
    <>
      <Rect x={30} y={24} width={40} height={52} rx={5} fill={GOLD} />
      <G stroke={DARK} strokeWidth={5} strokeLinecap="round">
        <Line x1={38} y1={40} x2={62} y2={40} />
        <Line x1={38} y1={50} x2={62} y2={50} />
        <Line x1={38} y1={60} x2={54} y2={60} />
      </G>
    </>
  ),
  // lyre → the harp (Terpsichore holds the other lyre, drawn as her dance)
  erato: (
    <G fill="none" stroke={GOLD} strokeLinecap="round">
      <Path d="M30 80 C30 40 50 20 72 20" strokeWidth={8} />
      <Line x1={30} y1={80} x2={72} y2={20} strokeWidth={8} />
      <G strokeWidth={4}>
        <Line x1={42} y1={66} x2={48} y2={40} />
        <Line x1={50} y1={70} x2={56} y2={40} />
        <Line x1={58} y1={74} x2={64} y2={40} />
      </G>
    </G>
  ),
  polyhymnia: <Path d="M22 84 C22 40 78 40 78 84 C69 75 60 79 50 72 C40 79 31 75 22 84Z" fill={GOLD} />,
  // bident & helm → the bident
  hades: (
    <G fill={GOLD}>
      <Rect x={45} y={34} width={10} height={54} />
      <Path d="M28 22 h12 v22 H28z M60 22 h12 v22 H60z M28 40 h44 v8 H28z" />
    </G>
  ),
  // lyre & sun → the sun
  apollo: (
    <G fill={GOLD}>
      <Circle cx={50} cy={50} r={22} />
      <Rect x={46} y={6} width={8} height={14} />
      <Rect x={46} y={80} width={8} height={14} />
      <Rect x={6} y={46} width={14} height={8} />
      <Rect x={80} y={46} width={14} height={8} />
      <Rect x={17} y={19} width={8} height={14} transform="rotate(45 21 26)" />
      <Rect x={75} y={19} width={8} height={14} transform="rotate(-45 79 26)" />
      <Rect x={17} y={67} width={8} height={14} transform="rotate(-45 21 74)" />
      <Rect x={75} y={67} width={8} height={14} transform="rotate(45 79 74)" />
    </G>
  ),
  // aulos → the note
  euterpe: (
    <G fill={GOLD}>
      <Ellipse cx={37} cy={72} rx={14} ry={10} transform="rotate(-18 37 72)" />
      <Rect x={47} y={20} width={7} height={50} />
      <Path d="M54 20 q20 6 14 28 q-4 -15 -14 -17z" />
    </G>
  ),
  // grapevine & mask → the mask
  dionysus: (
    <>
      <Path d="M28 30 C28 20 72 20 72 30 C72 70 58 86 50 86 C42 86 28 70 28 30Z" fill={GOLD} />
      <Ellipse cx={40} cy={44} rx={6} ry={4} fill={DARK} />
      <Ellipse cx={60} cy={44} rx={6} ry={4} fill={DARK} />
      <Path d="M38 64 q12 9 24 0" fill="none" stroke={DARK} strokeWidth={5} />
    </>
  ),
  iris: (
    <G fill="none" stroke={GOLD} strokeLinecap="round" strokeWidth={8}>
      <Path d="M18 76 a32 32 0 0 1 64 0" />
      <Path d="M32 76 a18 18 0 0 1 36 0" />
    </G>
  ),
  chloris: (
    <>
      <G fill={GOLD}>
        <Circle cx={50} cy={26} r={13} />
        <Circle cx={73} cy={44} r={13} />
        <Circle cx={64} cy={71} r={13} />
        <Circle cx={36} cy={71} r={13} />
        <Circle cx={27} cy={44} r={13} />
      </G>
      <Circle cx={50} cy={50} r={11} fill={DARK} />
    </>
  ),
  poseidon: (
    <G fill={GOLD}>
      <Rect x={45} y={28} width={10} height={58} />
      <Path d="M26 24 h10 v18 h6 V24 h4 v18 h6 V24 h10 v24 H26 z" />
    </G>
  ),
  // bow & scroll → the open book
  chiron: (
    <>
      <Path d="M50 30 C40 24 24 24 20 28 v40 C24 64 40 64 50 70 C60 64 76 64 80 68 V28 C76 24 60 24 50 30Z" fill={GOLD} />
      <Rect x={47} y={30} width={6} height={40} fill={DARK} />
    </>
  ),
  // lyre → the dance swirl
  terpsichore: (
    <G fill="none" stroke={GOLD} strokeWidth={10} strokeLinecap="round">
      <Path d="M52 20 a22 22 0 1 0 14 38" />
      <Path d="M48 86 a16 16 0 0 1 -10 -28" />
    </G>
  ),
};

// The simplified small-size cuts (mock 290's "!" ten). Each keeps its full glyph's silhouette and
// drops whatever only reads large: one coil not two, one torch not a pair, one arc not concentric
// ones, a solid head where there were ringed eyes.
const SMALL_GLYPHS: Record<string, ReactNode> = {
  // The rod thickens and the serpent becomes one heavy S.
  asclepius: (
    <>
      <Rect x={44} y={12} width={12} height={76} rx={4} fill={GOLD} />
      <Path d="M50 28 c24 8 24 20 0 24 c-24 4 -24 16 0 22" fill="none" stroke={GOLD} strokeWidth={12} strokeLinecap="round" />
    </>
  ),
  // A solid globe, the grid cut into it rather than drawn on top.
  atlas: (
    <>
      <Circle cx={50} cy={50} r={34} fill={GOLD} />
      <Rect x={16} y={46} width={68} height={8} fill={DARK} />
      <Path d="M50 16 q-20 34 0 68" fill="none" stroke={DARK} strokeWidth={7} />
    </>
  ),
  // One torch, wider.
  hecate: (
    <G fill={GOLD}>
      <Path d="M50 10 C68 28 72 44 62 58 H38 C28 44 32 28 50 10Z" />
      <Rect x={42} y={58} width={16} height={30} rx={3} />
    </G>
  ),
  // The owl's head with its ear tufts — a shape, not two rings.
  athena: (
    <>
      <Path d="M20 24 L38 38 H62 L80 24 V62 C80 80 66 90 50 90 C34 90 20 80 20 62Z" fill={GOLD} />
      <Circle cx={37} cy={58} r={9} fill={DARK} />
      <Circle cx={63} cy={58} r={9} fill={DARK} />
    </>
  ),
  // The knot closes into a heavy figure-eight.
  metis: (
    <Path
      d="M50 50 C40 28 14 32 14 50 C14 68 40 72 50 50 C60 28 86 32 86 50 C86 68 60 72 50 50Z"
      fill="none"
      stroke={GOLD}
      strokeWidth={13}
      strokeLinejoin="round"
    />
  ),
  // Two turns of the labyrinth, not four.
  daedalus: <Path d="M16 16 h68 v68 h-50 v-42 h26 v20" fill="none" stroke={GOLD} strokeWidth={12} strokeLinecap="square" />,
  // The wings alone, meeting at the centre — the body was the detail that blurred.
  psyche: (
    <G fill={GOLD}>
      <Path d="M50 50 C30 10 4 24 12 50 C4 76 30 90 50 50Z" />
      <Path d="M50 50 C70 10 96 24 88 50 C96 76 70 90 50 50Z" />
    </G>
  ),
  // A solid lyre: two arms, a crossbar, no strings.
  erato: (
    <G fill={GOLD}>
      <Path d="M24 22 h14 v36 a12 12 0 0 0 24 0 v-36 h14 v36 a26 26 0 0 1 -52 0z" />
      <Rect x={16} y={14} width={68} height={11} rx={4} />
    </G>
  ),
  // One heavy arc.
  iris: <Path d="M16 76 a34 34 0 0 1 68 0" fill="none" stroke={GOLD} strokeWidth={16} strokeLinecap="round" />,
  // One sweep and the dancer's point.
  terpsichore: (
    <>
      <Path d="M58 18 a28 28 0 1 0 16 44" fill="none" stroke={GOLD} strokeWidth={14} strokeLinecap="round" />
      <Circle cx={74} cy={80} r={9} fill={GOLD} />
    </>
  ),
};

export function PatronCrest({ patronKey, name, size = 18 }: { patronKey: string; name: string; size?: number }) {
  // Gradient ids are global in react-native-svg — per-mount, or every crest after the first blanks.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const frame = `pc${uid}`;
  const small = size <= SMALL_AT;
  const glyph = (small ? SMALL_GLYPHS[patronKey] : undefined) ?? GLYPHS[patronKey];
  const scale = small ? GLYPH_SCALE_SMALL : GLYPH_SCALE;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={frame} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE29A" />
          <Stop offset="1" stopColor="#FF9E3D" />
        </LinearGradient>
      </Defs>
      {/* A heavier rim when small: at 4/100 of 15px the frame is half a pixel and simply vanishes. */}
      <Polygon points="50,6 88,28 88,72 50,94 12,72 12,28" fill={DARK} stroke={`url(#${frame})`} strokeWidth={small ? 7 : 4} />
      {glyph ? (
        <G transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}>{glyph}</G>
      ) : (
        <SvgText x={50} y={63} fontSize={38} fontWeight="900" fill={GOLD} textAnchor="middle">
          {name.replace(/^The\s+/i, '').charAt(0).toUpperCase()}
        </SvgText>
      )}
    </Svg>
  );
}
