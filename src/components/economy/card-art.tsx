import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { flashCurve, useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { spread } from '@/components/economy/flare-perimeter';
import { useMotionActive } from '@/hooks/use-motion-active';
import type { CardArchetype, CatalogItem } from '@/lib/economy/catalog';
import { mix, shade, tint } from '@/lib/economy/colour';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE CARD FAMILY — one material scene per card archetype (design-mocks/241-card-family-bespoke).
//
// A card is the profile BACKDROP, the biggest flex surface a person has, and it used to be a flat
// fill of its colour: Cracked Magma was an orange rectangle. Mock 241 makes each card a material —
// stone, forged metal, a weave, magma, a plasma grid, falling-ember glass — plus the bespoke ones
// (the Marble of Olympus statue, the Golden Anvil's strike). The catalog's `archetype` picks the
// family; the id refines inside a family (Bronze vs Steel, Carbon vs Obsidian, the three Emberfall
// cards) where one family covers several looks.
//
// The same scene is drawn in three places, which is why it is plain SVG nodes and not a component
// that owns its own <Svg>:
//   · worn, as the profile-card backdrop (CardBackdropArt, via applied-art's EquippedCardBackdrop),
//   · in the shop tile, scaled to a ~27pt plate with the live layer folded in still (`hot`),
//   · at hero size in the inspect / reveal screens (the backdrop again, just bigger).
//
// Built to campfire-banner-art.tsx's four rules, because a card runs behind every row of the Agora:
//   1. STATIC SVG, ANIMATED VIEWS. The material is drawn once and never re-renders. Only the hot
//      layer moves — an opacity pulse, a translating sheen, a few dots — each an Animated.View
//      driven on the UI thread.
//   2. CAPPED COUNTS. ≤ 6 embers, 4 glints, 5 anvil shards; every scene is one cheap live layer
//      except the two flourishes (Golden Anvil, Plasma Grid's arc).
//   3. ONE DRIVER, MANY CONSUMERS. Every live layer reads a shared `useCosmeticClock` cadence, so
//      a page of thirty Hearth cards is one timer, and the anvil's hammer, flash and shatter agree.
//   4. DETERMINISTIC LAYOUT. Scatter comes from `spread()`, never Math.random().
// Reduce-motion (or `motion="still"`, or an off-screen tab) renders the hot layer's still frame.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Which scene a card draws. Colour still comes from the catalog's two stops. */
export type CardLook =
  | 'hearth'
  | 'plated'
  | 'brushed'
  | 'weave'
  | 'mesh'
  | 'magma'
  | 'grid'
  | 'marble'
  | 'anvil'
  | 'ember'
  | 'crown'
  | 'sovereign';

/** Same shape as applied-art's AppliedMotion — declared here so this file never imports that one. */
export type CardMotion = 'full' | 'still';

type IdFn = (k: string) => string;

const f = (n: number) => n.toFixed(2);

// The id table — the refinement INSIDE a family, and the whole answer for an item with no archetype.
const CARD_LOOK: Record<string, CardLook> = {
  'card-base-hearth': 'hearth',
  'card-forged-bronze': 'plated',
  'card-brushed-steel': 'brushed',
  'card-carbon-fiber': 'weave',
  'card-obsidian-mesh': 'mesh',
  'card-cracked-magma': 'magma',
  'card-plasma-grid': 'grid',
  'card-marble-of-olympus': 'marble',
  'card-golden-anvil': 'anvil',
  'card-emberfall': 'ember',
  'card-emberfall-mythic': 'crown',
  'card-emberfall-sovereign': 'sovereign',
};

/** Each archetype's looks, the first being the family default for an item the id table doesn't know. */
const FAMILY: Record<CardArchetype, readonly CardLook[]> = {
  stone: ['hearth'],
  metal: ['brushed', 'plated'],
  weave: ['weave', 'mesh'],
  magma: ['magma'],
  grid: ['grid'],
  ash: ['ember', 'crown', 'sovereign'],
  marble: ['marble'],
  anvil: ['anvil'],
};

function isCardArchetype(a: unknown): a is CardArchetype {
  return typeof a === 'string' && Object.prototype.hasOwnProperty.call(FAMILY, a);
}

/** The card id -> its scene. Kept for callers that only hold an id; prefer `cardLookForItem`. */
export function cardLookFor(itemId: string): CardLook {
  return CARD_LOOK[itemId] ?? 'hearth';
}

/**
 * The scene for a catalog card: its ARCHETYPE picks the family, its id picks the look within it.
 * An archetype this build doesn't know (an item added after it shipped) falls back to the id table,
 * then to Hearth — the clean base look, in the item's own colours.
 */
export function cardLookForItem(item: Pick<CatalogItem, 'id' | 'archetype'> | null | undefined): CardLook {
  if (!item) return 'hearth';
  const byId = CARD_LOOK[item.id];
  if (isCardArchetype(item.archetype)) {
    const family = FAMILY[item.archetype];
    return byId && family.includes(byId) ? byId : family[0];
  }
  return byId ?? 'hearth';
}

// ───────────────────────────── the static scene ─────────────────────────────

/**
 * One card's scene as SVG nodes, 100 units tall and `w` wide.
 *
 * The item's own ramp and a key light from the top, the material (CardArt), a gloss sweep, then a
 * scrim along the bottom so a name sitting on the card still reads. `hot` folds the live layer's
 * still frame in, for surfaces that never animate it — the shop tile and a parked card.
 */
export function CardScene({
  look,
  from,
  to,
  w,
  uid,
  hot,
  boost = 0,
}: {
  look: CardLook;
  from: string;
  to: string;
  w: number;
  uid: string;
  hot: boolean;
  boost?: number;
}) {
  const id: IdFn = (k) => `card-${k}-${uid}`;
  return (
    <>
      <Defs>
        <LinearGradient id={id('base')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={mix(from, to, 0.22)} />
          <Stop offset="0.55" stopColor={from} />
          <Stop offset="1" stopColor={shade(from, 0.45)} />
        </LinearGradient>
        <RadialGradient id={id('key')} cx="50%" cy="0%" r="80%">
          <Stop offset="0" stopColor={to} stopOpacity={0.42} />
          <Stop offset="0.55" stopColor={to} stopOpacity={0.08} />
          <Stop offset="1" stopColor={to} stopOpacity={0} />
        </RadialGradient>
        {/* objectBoundingBox, so each shape that fills with it gets its own hot centre. */}
        <RadialGradient id={id('pool')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={tint(to, 0.45)} stopOpacity={0.95} />
          <Stop offset="0.4" stopColor={to} stopOpacity={0.55} />
          <Stop offset="1" stopColor={to} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0.4">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.07} />
          <Stop offset="0.58" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
        {/* Mock 241's scrim: 5% at the top to 45% at the foot, where the avatar and name sit. */}
        <LinearGradient id={id('scrim')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity={0.04} />
          <Stop offset="0.45" stopColor="#000000" stopOpacity={0.1} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.42} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('base')})`} />
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('key')})`} />
      <CardArt look={look} from={from} to={to} w={w} id={id} />
      {/* The live-session tier turns the key light up rather than swapping the art. */}
      {boost > 0 && <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('key')})`} opacity={Math.min(1, boost * 1.6)} />}
      {hot && <CardHot look={look} to={to} w={w} id={id} />}
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('sheen')})`} />
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('scrim')})`} />
    </>
  );
}

/** Parallel lines across the card — brushed metal grain, stone hatching, carbon streaks. */
function lines(x0: number, x1: number, step: number, dx: number): string {
  let d = '';
  for (let x = x0; x < x1; x += step) d += `M${f(x)} 100 L${f(x + dx)} 0 `;
  return d;
}

/** Banked coals along the bottom edge — the Hearth's, shared by its static and hot layers. */
function coal(i: number, w: number) {
  return { x: w * (0.05 + i * 0.12), y: 95 - (i % 3) * 3, r: 2.6 + (i % 2) * 1.4 };
}

/** Forged metal's base: a dark-bright-dark ramp at 120°, the bright stop at 60% (mock 241 §2). */
function MetalBase({ id, w, dark, light }: { id: IdFn; w: number; dark: string; light: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={id('metal')} x1="0" y1="0" x2="1" y2="0.58">
          <Stop offset="0" stopColor={dark} />
          <Stop offset="0.6" stopColor={light} />
          <Stop offset="1" stopColor={dark} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('metal')})`} />
    </>
  );
}

// Obsidian's facets (mock 241's three clip-path panes), in card fractions: x of w, y of 100.
const OBSIDIAN_FACETS: { pts: [number, number][]; colour: string; opacity: number }[] = [
  { pts: [[0, 0], [0.54, 8.6], [0.227, 48], [0, 34.6]], colour: '#7a52c2', opacity: 0.42 },
  { pts: [[0.568, 44], [1, 66.4], [0.82, 100], [0.4, 81]], colour: '#4a3a7a', opacity: 0.36 },
  { pts: [[0.56, 14.4], [0.92, 8], [0.848, 40], [0.596, 33.6]], colour: '#8a6ad0', opacity: 0.36 },
];

/** Obsidian's vertex glints: [x fraction, y, delay seconds on the 3.2s cycle]. */
const GLINTS: [number, number, number][] = [
  [0.42, 6, 0],
  [0.7, 52, 0.9],
  [0.1, 70, 1.7],
  [0.86, 20, 2.4],
];

// Cracked Magma — mock 241's crack network, authored in a 200 × 220 frame and laid out across
// whatever width the card is. Basalt plates, then two seam sets that pulse out of phase.
const MAGMA_PLATES: { pts: [number, number][]; fill: string }[] = [
  { pts: [[-5, -5], [70, -5], [56, 54], [-5, 66]], fill: '#2b2b31' },
  { pts: [[70, -5], [150, -5], [140, 56], [100, 58], [56, 54]], fill: '#202026' },
  { pts: [[150, -5], [205, -5], [205, 70], [140, 56]], fill: '#2e2e35' },
  { pts: [[-5, 66], [56, 54], [60, 120], [-5, 140]], fill: '#242429' },
  { pts: [[56, 54], [100, 58], [104, 116], [60, 120]], fill: '#34343b' },
  { pts: [[100, 58], [140, 56], [205, 70], [205, 150], [150, 138], [104, 116]], fill: '#1d1d22' },
  { pts: [[-5, 140], [60, 120], [90, 170], [50, 200], [-5, 210]], fill: '#2a2a30' },
  { pts: [[60, 120], [104, 116], [150, 138], [140, 180], [90, 170]], fill: '#191a1e' },
  { pts: [[150, 138], [205, 150], [205, 225], [140, 225], [140, 180]], fill: '#2d2d34' },
  { pts: [[-5, 210], [50, 200], [90, 170], [140, 180], [140, 225], [-5, 225]], fill: '#232329' },
];
const MAGMA_SEAMS_A: [number, number][][] = [
  [[-6, 60], [56, 54], [100, 58], [140, 56], [206, 70]],
  [[60, 120], [104, 116], [150, 138], [206, 150]],
  [[-6, 140], [60, 120], [104, 116], [140, 56]],
  [[56, 54], [60, 120], [90, 170], [50, 200]],
];
const MAGMA_SEAMS_B: [number, number][][] = [
  [[100, 58], [104, 116], [140, 180], [140, 225]],
  [[-6, 210], [50, 200], [90, 170], [140, 180]],
];
const MAGMA_NODES: [number, number, number][] = [
  [56, 54, 1.3],
  [104, 116, 1.6],
  [60, 120, 1.2],
  [140, 56, 1.1],
  [90, 170, 1.3],
];
const mx = (x: number, w: number) => (x / 200) * w;
const my = (y: number) => y / 2.2;
const magmaPoly = (pts: [number, number][], w: number) => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(mx(x, w))} ${f(my(y))}`).join(' ');
const magmaSeams = (set: [number, number][][], w: number) => set.map((pts) => magmaPoly(pts, w)).join(' ');

/** The falling embers each Emberfall card carries: [x fraction, delay seconds on the 4s fall]. */
const EMBERS: Record<'ember' | 'crown' | 'sovereign', [number, number][]> = {
  ember: [
    [0.2, 0],
    [0.46, 1.3],
    [0.7, 0.6],
    [0.86, 2.1],
  ],
  crown: [
    [0.18, 0.2],
    [0.4, 1.1],
    [0.64, 0.7],
    [0.82, 1.8],
    [0.52, 2.6],
  ],
  sovereign: [
    [0.14, 0],
    [0.34, 0.9],
    [0.54, 1.6],
    [0.74, 0.5],
    [0.9, 2.3],
    [0.44, 3],
  ],
};

const SOVEREIGN_GOLD = '#F5C542';

/** The Sovereigns' crown standing at the top of the card, with its own glow. */
function Crown({ w, colour }: { w: number; colour: string }) {
  const cx = w / 2;
  const d = `M${f(cx - 7)} 15.5 L${f(cx - 7.6)} 7 L${f(cx - 3.4)} 10.6 L${f(cx)} 4.6 L${f(cx + 3.4)} 10.6 L${f(cx + 7.6)} 7 L${f(cx + 7)} 15.5 Z`;
  return (
    <G>
      <Circle cx={cx} cy={11} r={11} fill="#ffcf5a" opacity={0.12} />
      <Circle cx={cx} cy={11} r={7} fill="#ffcf5a" opacity={0.16} />
      <Path d={d} fill={colour} />
      <Rect x={cx - 7} y={13.6} width={14} height={2} fill={shade(colour, 0.35)} />
      <Circle cx={cx} cy={4.6} r={1} fill="#fff6d8" />
      <Circle cx={cx - 7.6} cy={7} r={0.8} fill="#fff6d8" />
      <Circle cx={cx + 7.6} cy={7} r={0.8} fill="#fff6d8" />
    </G>
  );
}

/** The Sovereigns' gold inner edge — mock 241's inset glow, as concentric strokes. */
function GoldEdge({ w }: { w: number }) {
  return (
    <G fill="none" stroke={SOVEREIGN_GOLD}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Rect
          key={i}
          x={0.8 + i * 1.6}
          y={0.8 + i * 1.6}
          width={w - 1.6 - i * 3.2}
          height={98.4 - i * 3.2}
          rx={Math.max(1, 8.5 - i * 1.4)}
          strokeWidth={1.8}
          opacity={0.3 * (1 - i / 5)}
        />
      ))}
    </G>
  );
}

/**
 * The Golden Anvil's hammer in its own frame: the pivot (where the hand would be) at the origin,
 * the head 70 units out along -x. The still tile and the live swing draw the same shape.
 */
const HAMMER_LEN = 70;
function HammerShape({ to }: { to: string }) {
  const L = HAMMER_LEN;
  return (
    <G>
      <Rect x={-L + 8} y={-2.2} width={L - 8} height={4.4} rx={2} fill="#5b3a1e" />
      <Rect x={-L + 8} y={-2.2} width={L - 8} height={1.2} fill="#8a5a30" opacity={0.8} />
      <Rect x={-L + 17} y={-3} width={4} height={6} rx={1} fill={to} />
      <Rect x={-L} y={-15} width={17} height={30} rx={2} fill="#2c2a30" />
      <Rect x={-L} y={-15} width={17} height={4} rx={1.5} fill={tint(to, 0.2)} />
      <Rect x={-L} y={11} width={17} height={4} rx={1.5} fill={tint(to, 0.2)} />
      <Rect x={-L + 2} y={-11} width={3} height={22} fill="#ffffff" opacity={0.18} />
    </G>
  );
}
/** Where the hammer's head lands at the bottom of its arc (scene units), given a pivot at (w+3, 50). */
const strikeX = (w: number) => w + 3 - HAMMER_LEN + 8.5;

/** A card's material. Drawn once; nothing in here moves. */
function CardArt({ look, from, to, w, id }: { look: CardLook; from: string; to: string; w: number; id: IdFn }) {
  const hot = tint(to, 0.5);
  const pool = `url(#${id('pool')})`;

  switch (look) {
    // ── 2 · FORGED METAL ──
    // Forged Bronze — brushed vertical grain over the metal ramp, struck plates riveted at the seams.
    case 'plated': {
      const seams: [number, number][] = [
        [32, 24],
        [70, 62],
      ];
      const seamY = (s: [number, number], x: number) => s[0] + ((s[1] - s[0]) * x) / w;
      const rivets: ReactNode[] = [];
      seams.forEach((s, si) => {
        for (let x = 9; x < w; x += 22) {
          rivets.push(<Circle key={`${si}-${x}`} cx={x} cy={seamY(s, x) + 3} r={1.3} fill={hot} opacity={0.7} />);
        }
      });
      return (
        <>
          <MetalBase id={id} w={w} dark={shade(from, 0.25)} light={to} />
          <Path d={lines(0, w, 2.13, 0)} stroke="#ffffff" strokeWidth={0.5} opacity={0.07} />
          <Path
            d={`M0 32 L${w} 24 M0 46 L${w} 38 M0 70 L${w} 62 M0 84 L${w} 76`}
            stroke={shade(from, 0.5)}
            strokeWidth={1.2}
            opacity={0.55}
          />
          <Path d={`M0 33 L${w} 25 M0 71 L${w} 63`} stroke={tint(to, 0.3)} strokeWidth={0.5} opacity={0.4} />
          {rivets}
          <G fill="#000000" opacity={0.07}>
            <Ellipse cx={w * 0.22} cy={52} rx={9} ry={5} />
            <Ellipse cx={w * 0.58} cy={14} rx={11} ry={5} />
            <Ellipse cx={w * 0.8} cy={88} rx={8} ry={4} />
          </G>
        </>
      );
    }

    // Brushed Steel — cold and plain: the metal ramp with fine near-horizontal striations, which is
    // what keeps it from reading as Bronze in grey.
    case 'brushed': {
      let a = '';
      let b = '';
      for (let y = 0; y < 106; y += 1.6) {
        a += `M0 ${f(y)} L${f(w)} ${f(y - 4)} `;
        b += `M0 ${f(y + 0.8)} L${f(w)} ${f(y - 3.2)} `;
      }
      return (
        <>
          <MetalBase id={id} w={w} dark={from} light={to} />
          <Path d={a} stroke="#ffffff" strokeWidth={0.35} opacity={0.16} />
          <Path d={b} stroke={shade(from, 0.4)} strokeWidth={0.35} opacity={0.22} />
        </>
      );
    }

    // Golden Anvil — brushed gold, the anvil struck faintly into it. The hammer is the hot layer.
    case 'anvil':
      return (
        <>
          <MetalBase id={id} w={w} dark={shade(from, 0.25)} light={to} />
          <Path d={lines(0, w, 2.13, 0)} stroke="#ffffff" strokeWidth={0.5} opacity={0.07} />
          <Path
            d="M6 46 Q12 40 22 40 L46 40 L46 50 L37 52 L35 64 L43 70 L43 81 L13 81 L13 70 L21 64 L19 52 L14 50 Q8 50 6 46 Z"
            fill={shade(from, 0.45)}
            opacity={0.32}
          />
          <Path d="M22 40.6 L46 40.6" stroke={tint(to, 0.5)} strokeWidth={0.9} opacity={0.5} />
        </>
      );

    // ── 3 · WEAVE ── told apart by colour AND construction, not hue alone.
    // Carbon Fiber — a neutral charcoal 2×2 twill; cool blue-white streaks travel it (the hot layer).
    case 'weave': {
      const cell = 5.5;
      let lit = '';
      let dim = '';
      let edge = '';
      for (let r = 0; r * cell < 100; r += 1) {
        for (let c = 0; c * cell < w; c += 1) {
          const x = c * cell;
          const y = r * cell;
          const cellD = `M${f(x + 0.4)} ${f(y + 0.4)} h${cell - 0.8} v${cell - 0.8} h${-(cell - 0.8)} Z `;
          if ((Math.floor(c / 2) + r) % 2 === 0) {
            lit += cellD;
            edge += `M${f(x + 0.8)} ${f(y + 1)} h${cell - 1.6} `;
          } else {
            dim += cellD;
          }
        }
      }
      return (
        <>
          <Rect x="0" y="0" width={w} height="100" fill={mix('#14141c', from, 0.4)} />
          <Path d={dim} fill="#101017" opacity={0.9} />
          <Path d={lit} fill={mix('#2a2a36', to, 0.2)} opacity={0.95} />
          <Path d={edge} stroke="#bcd6f0" strokeWidth={0.45} opacity={0.16} />
        </>
      );
    }

    // Obsidian Mesh — volcanic glass: violet wedges fanning from one point (mock 241's conic
    // gradient, faceted), three bright panes, and dim vertices the glints light up.
    case 'mesh': {
      const cx = 0.34 * w;
      const cy = 28;
      const cols = ['#2a1f3e', '#0b0912', '#1e1830', '#09070f', '#241a38', '#0f0d16'];
      const widths = [38, 46, 30, 52, 34, 44, 28, 50, 38];
      let a0 = (12 * Math.PI) / 180;
      const wedges = widths.map((deg, i) => {
        const a1 = a0 + (deg * Math.PI) / 180;
        const d = `M${f(cx)} ${cy} L${f(cx + 400 * Math.sin(a0))} ${f(cy - 400 * Math.cos(a0))} L${f(cx + 400 * Math.sin(a1))} ${f(cy - 400 * Math.cos(a1))} Z`;
        a0 = a1;
        return <Path key={i} d={d} fill={mix(cols[i % cols.length], to, 0.1)} />;
      });
      return (
        <>
          <Rect x="0" y="0" width={w} height="100" fill="#0a0810" />
          {wedges}
          <Defs>
            {OBSIDIAN_FACETS.map((fc, i) => (
              <LinearGradient key={i} id={id(`facet${i}`)} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={fc.colour} stopOpacity={fc.opacity} />
                <Stop offset="0.62" stopColor={fc.colour} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {OBSIDIAN_FACETS.map((fc, i) => {
            const d = fc.pts.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${f(x * w)} ${y}`).join(' ') + ' Z';
            return (
              <G key={i}>
                <Path d={d} fill={`url(#${id(`facet${i}`)})`} />
                <Path d={d} fill="none" stroke="#b79cff" strokeWidth={0.4} opacity={0.22} />
              </G>
            );
          })}
          <G fill="#b79cff" opacity={0.35}>
            {GLINTS.map(([x, y], i) => (
              <Circle key={i} cx={x * w} cy={y} r={0.7} />
            ))}
          </G>
        </>
      );
    }

    // ── 4 · MAGMA ── cooled grey basalt, the seams glowing through. The bright core lines and the
    // junction blobs are static; the wide glow around them is the pulsing hot layer.
    case 'magma':
      return (
        <>
          <Defs>
            <RadialGradient id={id('under')} cx="50%" cy="46%" r="62%">
              <Stop offset="0" stopColor={mix(shade(to, 0.7), '#4a1804', 0.5)} />
              <Stop offset="1" stopColor="#15151a" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={w} height="100" fill="#15151a" />
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('under')})`} opacity={0.4} />
          {MAGMA_PLATES.map((p, i) => (
            <Path key={i} d={`${magmaPoly(p.pts, w)} Z`} fill={p.fill} />
          ))}
          <G fill="none" strokeLinecap="round" strokeLinejoin="round">
            <Path d={magmaSeams(MAGMA_SEAMS_A, w)} stroke={to} strokeWidth={1.6} opacity={0.55} />
            <Path d={magmaSeams(MAGMA_SEAMS_B, w)} stroke={mix(to, '#ff2a10', 0.4)} strokeWidth={1.2} opacity={0.5} />
            <Path d={`${magmaSeams(MAGMA_SEAMS_A, w)} ${magmaPoly(MAGMA_SEAMS_B[0], w)}`} stroke={mix(to, '#ffd98a', 0.85)} strokeWidth={0.75} opacity={0.95} />
          </G>
          <G fill="#ffe9a0">
            {MAGMA_NODES.map(([x, y, r], i) => (
              <Circle key={i} cx={mx(x, w)} cy={my(y)} r={r} />
            ))}
          </G>
        </>
      );

    // ── 5 · PLASMA GRID ── a lattice of contained lightning; the hum and the arc are hot.
    case 'grid': {
      const step = 11.7;
      let grid = '';
      for (let x = 0; x <= w; x += step) grid += `M${f(x)} 0 L${f(x)} 100 `;
      for (let y = 0; y <= 100; y += step) grid += `M0 ${f(y)} L${f(w)} ${f(y)} `;
      const nodes = [0, 1, 2, 3, 4, 5].map((i) => ({
        x: Math.round((spread(i, 0.2) * w) / step) * step,
        y: Math.round((spread(i, 0.55) * 100) / step) * step,
      }));
      return (
        <>
          <Defs>
            <LinearGradient id={id('gridBg')} x1="0.3" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor="#0a0814" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('gridBg')})`} />
          <Path d={grid} stroke={to} strokeWidth={1.8} opacity={0.08} />
          <Path d={grid} stroke={to} strokeWidth={0.55} opacity={0.36} />
          {nodes.map((n, i) => (
            <G key={i}>
              <Circle cx={n.x} cy={n.y} r={3.4} fill={to} opacity={0.22} />
              <Circle cx={n.x} cy={n.y} r={1.4} fill={hot} />
            </G>
          ))}
        </>
      );
    }

    // ── 1b · MARBLE OF OLYMPUS ── a spot-lit marble bust on black: mock 241's statue, authored in
    // a 160 × 188 frame and stood right of centre so the avatar at the card's foot-left stays clear.
    case 'marble': {
      const s = 0.6;
      const tx = w * 0.6 - 80 * s;
      const stone = (t: number) => mix(to, from, t);
      return (
        <>
          <Defs>
            <RadialGradient id={id('spot')} cx="58%" cy="24%" r="78%">
              <Stop offset="0" stopColor="#2b313d" />
              <Stop offset="0.6" stopColor="#171a22" />
              <Stop offset="1" stopColor="#0a0c11" />
            </RadialGradient>
            <LinearGradient id={id('marb')} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={stone(0.06)} />
              <Stop offset="0.5" stopColor={stone(0.4)} />
              <Stop offset="1" stopColor={from} />
            </LinearGradient>
            <RadialGradient id={id('mface')} cx="38%" cy="34%" r="66%">
              <Stop offset="0" stopColor={to} />
              <Stop offset="1" stopColor={stone(0.7)} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('spot')})`} />
          <G transform={`translate(${f(tx)} -4) scale(${s})`}>
            <Path d="M12,192 C16,146 42,122 60,118 L100,118 C118,122 144,146 148,192 Z" fill={`url(#${id('marb')})`} />
            <Path d="M64,96 L96,96 L94,122 L66,122 Z" fill={`url(#${id('marb')})`} />
            <Ellipse cx={80} cy={60} rx={33} ry={41} fill={`url(#${id('mface')})`} />
            <Path d="M52,80 C56,104 70,112 80,112 C90,112 104,104 108,80 Z" fill={`url(#${id('mface')})`} />
            <G fill={stone(0.3)}>
              <Circle cx={52} cy={32} r={9} />
              <Circle cx={66} cy={23} r={10.5} />
              <Circle cx={82} cy={20} r={10.5} />
              <Circle cx={98} cy={23} r={10} />
              <Circle cx={110} cy={35} r={8.5} />
              <Circle cx={46} cy={46} r={7} />
              <Circle cx={114} cy={50} r={7} />
            </G>
            <G fill={stone(0.55)} opacity={0.65}>
              <Circle cx={56} cy={32} r={4} />
              <Circle cx={82} cy={23} r={4.5} />
              <Circle cx={104} cy={28} r={3.5} />
              <Circle cx={68} cy={24} r={3.5} />
            </G>
            <G fill={from} opacity={0.4}>
              <Ellipse cx={69} cy={55} rx={7} ry={3.6} />
              <Ellipse cx={91} cy={55} rx={7} ry={3.6} />
              <Path d="M80,52 L85,74 L75,74 Z" />
              <Ellipse cx={80} cy={84} rx={8} ry={3} />
            </G>
            <Path d="M60,70 C62,86 66,96 72,104" stroke={from} strokeWidth={2} fill="none" opacity={0.4} />
            <Ellipse cx={64} cy={46} rx={10} ry={17} fill="#ffffff" opacity={0.16} />
            <Path d="M107,48 C113,66 105,92 93,106" stroke="#cfe0ff" strokeWidth={2} fill="none" opacity={0.18} />
          </G>
        </>
      );
    }

    // ── 6 · EMBERFALL / ASH ── dark glass lit from above, ash settled on it; the embers fall live.
    case 'ember':
    case 'crown':
    case 'sovereign': {
      const sov = look !== 'ember';
      return (
        <>
          <Defs>
            <LinearGradient id={id('ashBg')} x1="0.4" y1="0" x2="0.6" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor="#0a0608" />
            </LinearGradient>
            <RadialGradient id={id('ashTop')} cx="50%" cy="15%" r="60%">
              <Stop offset="0" stopColor={to} stopOpacity={0.4} />
              <Stop offset="0.9" stopColor={to} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('ashBg')})`} />
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('ashTop')})`} />
          <Path d={`M${w * 0.12} 0 L${w * 0.26} 0 L${w * 0.1} 100 L0 100 L0 50 Z`} fill="#ffffff" opacity={0.035} />
          <G fill="#ffffff">
            {Array.from({ length: 14 }, (_, i) => (
              <Circle key={i} cx={spread(i, 0.3) * w} cy={30 + spread(i, 0.71) * 66} r={0.4 + spread(i, 0.9) * 0.5} opacity={0.14} />
            ))}
          </G>
          {sov && <GoldEdge w={w} />}
          {look === 'sovereign' && (
            <>
              <Rect x="5" y="5" width={w - 10} height="90" rx="6" fill="none" stroke={to} strokeWidth={0.4} opacity={0.45} />
              <Rect x={w - 31} y={4.5} width={26} height={8} rx={4} fill="#ff4d6d" fillOpacity={0.22} stroke="#ff4d6d" strokeWidth={0.5} />
              <SvgText x={w - 18} y={10.2} fontSize={4.6} fontWeight="800" fill="#ffd0d6" textAnchor="middle" letterSpacing={0.3}>
                1 OF 1
              </SvgText>
            </>
          )}
          {sov && <Crown w={w} colour={look === 'sovereign' ? '#FFD24D' : SOVEREIGN_GOLD} />}
        </>
      );
    }

    // ── 1 · STONE / HEARTH ── the base, and the fallback for anything this build doesn't know:
    // plain dressed stone, hatched, with coals banked along the bottom.
    case 'hearth':
    default: {
      const rows = [0, 24, 49, 74, 100];
      let joints = '';
      for (let r = 0; r < 4; r += 1) {
        if (r > 0) joints += `M0 ${rows[r]} L${f(w)} ${rows[r]} `;
        for (let x = r % 2 === 0 ? 34 : 17; x < w; x += 34) joints += `M${f(x)} ${rows[r] + 1} L${f(x)} ${rows[r + 1] - 1} `;
      }
      return (
        <>
          <Path d={lines(-100, w + 10, 3.7, 90)} stroke="#000000" strokeWidth={1.3} opacity={0.13} />
          <Path d={joints} stroke={shade(from, 0.55)} strokeWidth={0.9} opacity={0.5} />
          <Path d={joints} stroke={to} strokeWidth={0.35} opacity={0.08} transform="translate(0.7 0.7)" />
          <Ellipse cx={w * 0.5} cy={112} rx={w * 0.6} ry={44} fill={pool} opacity={0.5} />
          {Array.from({ length: 8 }, (_, i) => {
            const c = coal(i, w);
            return (
              <G key={i}>
                <Circle cx={c.x} cy={c.y} r={c.r} fill={shade(to, 0.35)} opacity={0.8} />
                <Circle cx={c.x} cy={c.y - c.r * 0.2} r={c.r * 0.45} fill={hot} opacity={0.5} />
              </G>
            );
          })}
        </>
      );
    }
  }
}

// ───────────────────────────── the hot layer ─────────────────────────────

/** How bright each sheen look's specular band peaks. */
const SHEEN_PEAK: Partial<Record<CardLook, number>> = { plated: 0.4, brushed: 0.4, anvil: 0.27, marble: 0.09 };

/** Carbon's streaks, as a horizontal period (≈ mock 241's 11px diagonal repeat on a 188px card). */
const STREAK_P = 8.3;

/**
 * The bright, MOVING parts of a card, drawn still: what the live layer animates, at one frame.
 * `part` splits a look whose live layer is two things moving differently (magma's two seam sets,
 * the grid's hum and arc); omitted, it draws everything — the tile and the parked card.
 */
function CardHot({ look, to, w, id, part }: { look: CardLook; to: string; w: number; id: IdFn; part?: 'a' | 'b' }) {
  const a = part !== 'b';
  const b = part !== 'a';
  const peak = SHEEN_PEAK[look];
  switch (look) {
    case 'hearth':
      return a ? (
        <>
          <Defs>
            <RadialGradient id={id('h-coal')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={tint(to, 0.35)} stopOpacity={0.85} />
              <Stop offset="0.45" stopColor={to} stopOpacity={0.4} />
              <Stop offset="1" stopColor={to} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={w / 2} cy={110} rx={w * 0.62} ry={40} fill={`url(#${id('h-coal')})`} />
          <G fill={tint(to, 0.6)}>
            {Array.from({ length: 8 }, (_, i) => {
              const c = coal(i, w);
              return <Circle key={i} cx={c.x} cy={c.y - c.r * 0.2} r={c.r * 0.35} />;
            })}
          </G>
        </>
      ) : null;

    case 'plated':
    case 'brushed':
    case 'marble':
    case 'anvil': {
      const c = w * 0.32;
      return (
        <>
          {a && peak != null && (
            <>
              <Defs>
                <LinearGradient id={id('h-sheen')} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
                  <Stop offset="0.5" stopColor="#ffffff" stopOpacity={peak} />
                  <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path
                d={`M${f(c - w * 0.15 + 22)} 0 L${f(c + w * 0.15 + 22)} 0 L${f(c + w * 0.15 - 22)} 100 L${f(c - w * 0.15 - 22)} 100 Z`}
                fill={`url(#${id('h-sheen')})`}
              />
            </>
          )}
          {/* The Golden Anvil still: the hammer raised for the next blow, sparks off the last one. */}
          {b && look === 'anvil' && (
            <>
              <G fill={tint(to, 0.7)}>
                {Array.from({ length: 8 }, (_, i) => (
                  <Circle
                    key={i}
                    cx={strikeX(w) - 10 + spread(i, 0.31) * 20}
                    cy={56 + spread(i, 0.77) * 18}
                    r={0.6 + spread(i, 0.5) * 0.8}
                  />
                ))}
              </G>
              <G transform={`translate(${f(w + 3)} 50) rotate(32)`}>
                <HammerShape to={to} />
              </G>
            </>
          )}
        </>
      );
    }

    case 'weave':
      return a ? <Path d={lines(-110 - STREAK_P * 4, w + 10, STREAK_P, 100)} stroke="#bcd6f0" strokeWidth={0.55} opacity={0.3} /> : null;

    case 'mesh':
      return a ? (
        <G>
          {GLINTS.map(([x, y], i) => (
            <G key={i}>
              <Circle cx={x * w} cy={y} r={3} fill="#b79cff" opacity={0.3} />
              <Circle cx={x * w} cy={y} r={1.2} fill="#e4d6ff" />
            </G>
          ))}
        </G>
      ) : null;

    // The molten glow round each seam — mock 241's blurred stroke, as three widening passes
    // (react-native-svg's blur filter is not dependable across both platforms).
    case 'magma':
      return (
        <G fill="none" strokeLinecap="round" strokeLinejoin="round">
          {a &&
            [5.5, 3.4, 2].map((sw, i) => (
              <Path key={`a${i}`} d={magmaSeams(MAGMA_SEAMS_A, w)} stroke={to} strokeWidth={sw} opacity={[0.14, 0.24, 0.42][i]} />
            ))}
          {b &&
            [4.2, 2.6].map((sw, i) => (
              <Path key={`b${i}`} d={magmaSeams(MAGMA_SEAMS_B, w)} stroke={mix(to, '#ff2a10', 0.4)} strokeWidth={sw} opacity={[0.16, 0.3][i]} />
            ))}
        </G>
      );

    case 'grid': {
      const pts: [number, number][] = [
        [0.3, 14],
        [0.36, 30],
        [0.31, 42],
        [0.42, 56],
        [0.38, 66],
        [0.5, 84],
      ];
      const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x * w)} ${y}`).join(' ');
      return (
        <>
          {a && (
            <>
              <Defs>
                <RadialGradient id={id('h-hum')} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={to} stopOpacity={0.4} />
                  <Stop offset="0.65" stopColor={to} stopOpacity={0.12} />
                  <Stop offset="1" stopColor={to} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx={w / 2} cy={50} rx={w * 0.5} ry={44} fill={`url(#${id('h-hum')})`} />
            </>
          )}
          {b && (
            <G fill="none" strokeLinecap="round" strokeLinejoin="round">
              <Path d={d} stroke={to} strokeWidth={2.6} opacity={0.4} />
              <Path d={d} stroke={tint(to, 0.7)} strokeWidth={0.8} />
            </G>
          )}
        </>
      );
    }

    case 'ember':
    case 'crown':
    case 'sovereign':
      return a ? (
        <G>
          {EMBERS[look].map(([x], i) => {
            const y = 14 + spread(i, 0.43) * 70;
            return (
              <G key={i}>
                <Circle cx={x * w} cy={y} r={2.6} fill={to} opacity={0.3} />
                <Circle cx={x * w} cy={y} r={1} fill={tint(to, 0.5)} />
              </G>
            );
          })}
        </G>
      ) : null;

    default:
      return null;
  }
}

// ───────────────────────────── worn: static + live ─────────────────────────────

/**
 * The full worn backdrop at a measured pixel size: the static scene, and over it the hot layer —
 * live when this card is allowed to move, its still frame otherwise.
 */
export function CardBackdropArt({
  look,
  from,
  to,
  width,
  height,
  boost = 0,
  motion,
  uid,
}: {
  look: CardLook;
  from: string;
  to: string;
  width: number;
  height: number;
  boost?: number;
  motion: CardMotion;
  uid: string;
}) {
  // 100 units TALL and as wide as the card's aspect, so round things in the scene stay round.
  const w = height > 0 ? (100 * width) / height : 100;
  return (
    <>
      <Svg width={width} height={height} viewBox={`0 0 ${f(w)} 100`}>
        <CardScene look={look} from={from} to={to} w={w} uid={uid} hot={false} boost={boost} />
      </Svg>
      <CardHotLayer look={look} from={from} to={to} w={w} width={width} height={height} motion={motion} uid={uid} boost={boost} />
    </>
  );
}

type LayerProps = {
  look: CardLook;
  from: string;
  to: string;
  w: number;
  width: number;
  height: number;
  uid: string;
  boost: number;
};

function CardHotLayer({ motion, ...p }: LayerProps & { motion: CardMotion }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  if (motion === 'full' && !reduceMotion && active) return <CardLive {...p} />;
  // Parked: held at a strong frame rather than dark, so a still card still shows its fire.
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: 0.85 }]} pointerEvents="none">
      <Svg width={p.width} height={p.height} viewBox={`0 0 ${f(p.w)} 100`}>
        <CardHot look={p.look} to={p.to} w={p.w} id={(k) => `card-${k}-${p.uid}-still`} />
      </Svg>
    </View>
  );
}

// Cadences. Each is one shared clock however many cards are on screen.
const HEARTH_MS = 3200;
const METAL_SWEEP_MS = 3600;
const MARBLE_SWEEP_MS = 6000;
const CARBON_MS = 1800;
const GLINT_MS = 3200;
const MAGMA_MS = 10_000; // seams A at 5 loops (2s), seams B at 4 (2.5s) — mock 241's two pulses
const GRID_HUM_MS = 1800;
const GRID_ARC_MS = 4800;
const EMBER_MS = 4000;
const ANVIL_MS = 5000;

function CardLive({ look, from, to, w, width, height, uid, boost }: LayerProps) {
  const hotSvg = (part: 'a' | 'b', suffix: string, vw = w) => (
    <Svg width={(vw * height) / 100} height={height} viewBox={`0 0 ${f(vw)} 100`}>
      <CardHot look={look} to={to} w={vw} id={(k) => `card-${k}-${uid}-${suffix}`} part={part} />
    </Svg>
  );
  switch (look) {
    case 'plated':
    case 'brushed':
      return <SweepLive ms={METAL_SWEEP_MS} peak={0.4} width={width} height={height} uid={uid} />;
    case 'marble':
      return <SweepLive ms={MARBLE_SWEEP_MS} peak={0.09} width={width} height={height} uid={uid} />;
    case 'anvil':
      return <AnvilLive from={from} to={to} w={w} width={width} height={height} uid={uid} boost={boost} />;
    case 'weave':
      // Wider than the card by the distance it travels in one loop, so the loop seam never shows.
      return (
        <StreakLive width={width} height={height}>
          {hotSvg('a', 'live', w + STREAK_P * 4)}
        </StreakLive>
      );
    case 'mesh':
      return <GlintLive width={width} height={height} />;
    case 'magma':
      return (
        <>
          <PulseLive ms={MAGMA_MS} mult={5} phase={0}>
            {hotSvg('a', 'la')}
          </PulseLive>
          <PulseLive ms={MAGMA_MS} mult={4} phase={0.2}>
            {hotSvg('b', 'lb')}
          </PulseLive>
        </>
      );
    case 'grid':
      return (
        <>
          <PulseLive ms={GRID_HUM_MS} mult={1} phase={0}>
            {hotSvg('a', 'la')}
          </PulseLive>
          <FlashLive>{hotSvg('b', 'lb')}</FlashLive>
        </>
      );
    case 'ember':
    case 'crown':
    case 'sovereign':
      return <EmberLive embers={EMBERS[look]} to={to} width={width} height={height} />;
    case 'hearth':
    default:
      return (
        <PulseLive ms={HEARTH_MS} mult={1} phase={0}>
          {hotSvg('a', 'la')}
        </PulseLive>
      );
  }
}

/** Breathing opacity, 0.5 -> 1 -> 0.5, `mult` times per clock loop. */
function PulseLive({ ms, mult, phase, children }: { ms: number; mult: number; phase: number; children: ReactNode }) {
  const clock = useCosmeticClock(ms, true);
  const style = useAnimatedStyle(() => ({
    opacity: 0.75 - 0.25 * Math.cos((clock.value * mult + phase) * Math.PI * 2),
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.5 }, style]}>
      {children}
    </Animated.View>
  );
}

/** The plasma grid's arc: two strikes a cycle, never fully gone — it hums between them. */
function FlashLive({ children }: { children: ReactNode }) {
  const clock = useCosmeticClock(GRID_ARC_MS, true);
  const style = useAnimatedStyle(() => ({ opacity: 0.18 + 0.82 * flashCurve((clock.value * 3) % 1) }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0 }, style]}>
      {children}
    </Animated.View>
  );
}

/** A specular band sweeping across and back — forged metal, the anvil, and (faintly) the marble. */
function SweepLive({ ms, peak, width, height, uid }: { ms: number; peak: number; width: number; height: number; uid: string }) {
  const clock = useCosmeticClock(ms, true);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -0.7 * width * Math.cos(clock.value * Math.PI * 2) }],
  }));
  const gid = `card-sweep-${uid}`;
  const c = width / 2;
  const bw = width * 0.15;
  const sl = height * 0.22;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={peak} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={`M${f(c - bw + sl)} 0 L${f(c + bw + sl)} 0 L${f(c + bw - sl)} ${f(height)} L${f(c - bw - sl)} ${f(height)} Z`} fill={`url(#${gid})`} />
      </Svg>
    </Animated.View>
  );
}

/** Carbon's light streaks travelling the weave: a linear slide of exactly four streak periods. */
function StreakLive({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const clock = useCosmeticClock(CARBON_MS, true);
  const travel = ((STREAK_P * 4) * height) / 100;
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -travel + travel * clock.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: width + travel, height }, style]}>
      {children}
    </Animated.View>
  );
}

/** Obsidian's vertex glints: four points that flare and fade in turn. */
function GlintLive({ width, height }: { width: number; height: number }) {
  const clock = useCosmeticClock(GLINT_MS, true);
  const g = Math.max(8, height * 0.09);
  return (
    <>
      {GLINTS.map(([x, y, delay], i) => (
        <Glint key={i} clock={clock} left={x * width - g / 2} top={(y / 100) * height - g / 2} size={g} phase={(delay * 1000) / GLINT_MS} />
      ))}
    </>
  );
}

function glide(u: number): { o: number; s: number } {
  'worklet';
  if (u < 0.2) return { o: u / 0.2, s: 0.5 + 0.7 * (u / 0.2) };
  if (u < 0.45) return { o: 1 - (u - 0.2) / 0.25, s: 1.2 - 0.6 * ((u - 0.2) / 0.25) };
  return { o: 0, s: 0.6 };
}

function Glint({ clock, left, top, size, phase }: { clock: SharedValue<number>; left: number; top: number; size: number; phase: number }) {
  const style = useAnimatedStyle(() => {
    const g = glide((clock.value - phase + 1) % 1);
    return { opacity: g.o, transform: [{ scale: g.s }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, width: size, height: size, opacity: 0 }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: '#b79cff', opacity: 0.35 }]} />
      <View
        style={{
          position: 'absolute',
          left: size * 0.3,
          top: size * 0.3,
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size * 0.2,
          backgroundColor: '#e4d6ff',
        }}
      />
    </Animated.View>
  );
}

/** Emberfall's embers drifting down the dark glass, fading in at the top and out at the foot. */
function EmberLive({ embers, to, width, height }: { embers: [number, number][]; to: string; width: number; height: number }) {
  const clock = useCosmeticClock(EMBER_MS, true);
  const g = Math.max(5, height * 0.06);
  return (
    <>
      {embers.map(([x, delay], i) => (
        <Ember key={i} clock={clock} left={x * width - g / 2} size={g} height={height} colour={to} phase={(delay * 1000) / EMBER_MS} />
      ))}
    </>
  );
}

function Ember({
  clock,
  left,
  size,
  height,
  colour,
  phase,
}: {
  clock: SharedValue<number>;
  left: number;
  size: number;
  height: number;
  colour: string;
  phase: number;
}) {
  const style = useAnimatedStyle(() => {
    const u = (clock.value - phase + 1) % 1;
    return {
      opacity: u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85,
      transform: [{ translateY: -size + u * (height + size * 2) }],
    };
  });
  const core = size * 0.36;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top: 0, width: size, height: size, opacity: 0 }, style]}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: colour, opacity: 0.35 }]} />
      <View
        style={{
          position: 'absolute',
          left: (size - core) / 2,
          top: (size - core) / 2,
          width: core,
          height: core,
          borderRadius: core / 2,
          backgroundColor: tint(colour, 0.5),
        }}
      />
    </Animated.View>
  );
}

// ── GOLDEN ANVIL ── the hammer swings in over the top-right corner, strikes, the card cracks into
// five chunks and holds, then sutures back whole. One 5s clock drives all of it, so the flash, the
// jolt and the shatter land on the same frame as the hammer (mock 241's 35% mark).

// Mock 241's five clip-path chunks, in card fractions, and how far each flies (px on a 188px card).
const SHARDS: { pts: [number, number][]; tx: number; ty: number; r: number }[] = [
  { pts: [[0, 0], [0.52, 0], [0.42, 0.48], [0, 0.56]], tx: -14, ty: -11, r: -8 },
  { pts: [[0.52, 0], [1, 0], [1, 0.42], [0.42, 0.48]], tx: 15, ty: -9, r: 7 },
  { pts: [[0, 0.56], [0.42, 0.48], [0.48, 1], [0, 1]], tx: -16, ty: 12, r: -6 },
  { pts: [[0.42, 0.48], [1, 0.42], [1, 0.74], [0.48, 1]], tx: 15, ty: 9, r: 5 },
  { pts: [[0.48, 1], [1, 0.74], [1, 1]], tx: 12, ty: 15, r: 9 },
];

/** 0 = whole, 1 = cracked apart. Whole until the hit, apart at 41%, held, sutured by 80%. */
function shardProgress(t: number): number {
  'worklet';
  if (t < 0.35) return 0;
  if (t < 0.41) {
    const x = (t - 0.35) / 0.06;
    return 1 - (1 - x) * (1 - x);
  }
  if (t < 0.62) return 1;
  if (t < 0.8) {
    const x = (t - 0.62) / 0.18;
    return 1 - x * x * (3 - 2 * x);
  }
  return 0;
}

/** Degrees clockwise from pointing left: raised off the top-right at 140, strike at 0. */
function hammerAngle(t: number): number {
  'worklet';
  if (t < 0.33) {
    const x = t / 0.33;
    return 140 - 144 * x * x; // accelerating into the blow
  }
  if (t < 0.35) return -4 - 4 * ((t - 0.33) / 0.02);
  if (t < 0.38) return -8 + 14 * ((t - 0.35) / 0.03);
  if (t < 0.58) {
    const x = (t - 0.38) / 0.2;
    return 6 + 134 * x * x * (3 - 2 * x);
  }
  return 140;
}

function anvilFlash(t: number): number {
  'worklet';
  if (t < 0.34) return 0;
  if (t < 0.36) return 0.95 * ((t - 0.34) / 0.02);
  if (t < 0.46) return 0.95 * (1 - (t - 0.36) / 0.1);
  return 0;
}

/** The impact jolt: a damped shake across 35%-48%. */
function anvilJolt(t: number): number {
  'worklet';
  if (t < 0.35 || t > 0.48) return 0;
  const x = (t - 0.35) / 0.13;
  return Math.sin(x * Math.PI * 3) * (1 - x);
}

function AnvilLive({ from, to, w, width, height, uid, boost }: Omit<LayerProps, 'look'>) {
  const clock = useCosmeticClock(ANVIL_MS, true);
  const k = height / 100;
  // The dark under the chunks shows only while they are apart, so at rest the seams between five
  // anti-aliased clip edges sit over the whole static card rather than over black.
  const backing = useAnimatedStyle(() => ({ opacity: shardProgress(clock.value) > 0 ? 1 : 0 }));
  const jolt = useAnimatedStyle(() => {
    const a = anvilJolt(clock.value);
    return { transform: [{ translateX: -3 * k * a }, { translateY: 2 * k * Math.abs(a) }, { scale: 1 + 0.02 * Math.abs(a) }] };
  });
  const flash = useAnimatedStyle(() => ({ opacity: anvilFlash(clock.value) }));
  const swing = useAnimatedStyle(() => ({ transform: [{ rotate: `${hammerAngle(clock.value)}deg` }] }));
  const flashId = `card-flash-${uid}`;
  const L = HAMMER_LEN * k;
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#0b0804', opacity: 0 }, backing]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, jolt]}>
        {SHARDS.map((s, i) => (
          <AnvilShard key={i} index={i} shard={s} clock={clock} from={from} to={to} w={w} width={width} height={height} uid={uid} boost={boost} />
        ))}
      </Animated.View>
      <SweepLive ms={METAL_SWEEP_MS} peak={0.27} width={width} height={height} uid={`${uid}-a`} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0 }, flash]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id={flashId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
              <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={strikeX(w) * k} cy={50 * k} r={Math.max(width, height) * 0.48} fill={`url(#${flashId})`} />
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: (w + 3) * k - L, top: 35 * k, width: L, height: 30 * k, transformOrigin: '100% 50%' },
          swing,
        ]}>
        <Svg width={L} height={30 * k} viewBox={`${-HAMMER_LEN} -15 ${HAMMER_LEN} 30`}>
          <HammerShape to={to} />
        </Svg>
      </Animated.View>
    </>
  );
}

function AnvilShard({
  index,
  shard,
  clock,
  from,
  to,
  w,
  width,
  height,
  uid,
  boost,
}: Omit<LayerProps, 'look'> & { index: number; shard: (typeof SHARDS)[number]; clock: SharedValue<number> }) {
  const px = height / 188;
  const style = useAnimatedStyle(() => {
    const p = shardProgress(clock.value);
    return {
      transform: [{ translateX: shard.tx * px * p }, { translateY: shard.ty * px * p }, { rotate: `${shard.r * p}deg` }],
    };
  });
  const clipId = `card-shard-${uid}-${index}`;
  const d = shard.pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x * w)} ${f(y * 100)}`).join(' ') + ' Z';
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${f(w)} 100`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={d} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          <CardScene look="anvil" from={from} to={to} w={w} uid={`${uid}-s${index}`} hot={false} boost={boost} />
        </G>
      </Svg>
    </Animated.View>
  );
}
