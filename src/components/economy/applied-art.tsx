import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { flashCurve, useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { Colors, Radius } from '@/constants/theme';
import { useGatedInterval, useMotionActive } from '@/hooks/use-motion-active';
import { getItem } from '@/lib/economy/catalog';
import type { CatalogItem } from '@/lib/economy/catalog';
import { mix, shade, tint } from '@/lib/economy/colour';
import { creditedSeconds, type LockInClock } from '@/lib/lock-in-clock';

// §2 — cosmetics rendered as ACTUAL ART, applied to the surface.
//
// THE BUG THIS FIXES: the profile card was `backgroundColor: card.art.from` and the halo was two
// bordered circles. Every card looked like a rectangle of colour and every halo like a ring of
// colour, so Cracked Magma and Carbon Fiber — an Epic and a Rare, with completely different
// promised looks — differed only in hue. There was nothing to want.
//
// AND THE SECOND PASS (mocks 234-236). The first fix gave each card a faint texture over a flat
// gradient and each halo a recoloured torus — better, but a profile still read as a coloured panel
// with a coloured ring on it. Now a CARD is a lit scene (a key light, its own backdrop art, a gloss
// sweep, a scrim so the name stays legible) and the epic+ cards carry a live hot layer; a HALO is
// drawn in its own gradient sweep with a soft outer glow, and the premium halos are separate
// constructions (a faceted prism, an orbit of coals, a crown) rather than one ring in new colours.
//
// DISTINCT FROM item-art.tsx, deliberately — but no longer separate from it. That file draws a
// THUMBNAIL: the item on a pedestal in a shop grid. This draws the cosmetic APPLIED — the backdrop
// filling your actual profile card, the ring around your actual avatar. The tile now draws its
// card and halo with `CardScene` and `HaloRing` from HERE, so the thumbnail is a picture of the
// worn thing rather than an approximation that could drift from it.
//
// The two-stop `art: {from, to}` in the catalog stays the single source of colour. What is keyed by
// item id here is the LOOK — because the spec names specific looks ("Cracked Magma = magma cracks
// over a molten gradient; Golden Anvil = brushed gold") and a shared gradient cannot express that.

/** Which scene a card draws. Colour still comes from the catalog's two stops. */
type CardLook = 'hearth' | 'plated' | 'brushed' | 'weave' | 'mesh' | 'magma' | 'grid' | 'anvil' | 'ember' | 'crown' | 'sovereign';

/** How a halo's ring is drawn. */
type HaloStyle = 'ring' | 'band' | 'double' | 'glow' | 'embers' | 'prism' | 'flare' | 'aura' | 'crown';

// Keyed by id rather than rarity: two Epics (Cracked Magma, Plasma Grid) are meant to look nothing
// alike, and rarity would give them the same treatment. Anything unmapped falls to 'hearth', the
// base look drawn in that item's own colours — never a bare surface.
const CARD_LOOK: Record<string, CardLook> = {
  'card-base-hearth': 'hearth',
  'card-forged-bronze': 'plated',
  'card-brushed-steel': 'brushed',
  'card-carbon-fiber': 'weave',
  'card-obsidian-mesh': 'mesh',
  'card-cracked-magma': 'magma',
  'card-plasma-grid': 'grid',
  'card-golden-anvil': 'anvil',
  'card-emberfall': 'ember',
  'card-emberfall-mythic': 'crown',
  'card-emberfall-sovereign': 'sovereign',
};

// Copper Ring and the base Emberring share their two stops exactly, so a STYLE is the only thing
// that can tell them apart — which is why Copper is 'band' rather than 'ring'. Likewise Emberfall
// Halo was sharing Glowing Amber's 'glow'; its lore is a ring of falling embers, so it draws one.
const HALO_STYLE: Record<string, HaloStyle> = {
  'halo-base-ring': 'ring',
  'halo-copper-ring': 'band',
  'halo-ember-halo': 'double',
  'halo-glowing-amber': 'glow',
  'halo-diamond-prism': 'prism',
  'halo-inferno-flare': 'flare',
  'halo-hades': 'aura',
  'halo-emberfall': 'embers',
  'halo-emberfall-mythic': 'crown',
};

/**
 * The live session-tiered aura (ITEM_CATALOG §2b): 0 = not locked in, 1 = Kindled (30m),
 * 2 = Burning (60m), 3 = Locked In (90m).
 *
 * Purely visual — the spec is explicit that there is "no XP coupling". It scales the intensity of
 * whatever is already equipped rather than swapping in different art, which is what keeps a
 * long session a flex about YOUR cosmetic instead of a different one.
 */
export type AuraTier = 0 | 1 | 2 | 3;

/** Minutes elapsed -> tier. One place, so the card, the halo and any future surface agree. */
export function auraTierForMinutes(minutes: number | null | undefined): AuraTier {
  if (minutes == null) return 0;
  if (minutes >= 90) return 3;
  if (minutes >= 60) return 2;
  if (minutes >= 30) return 1;
  return 0;
}

/**
 * The live tier for a running session, recomputed as it crosses each threshold.
 *
 * A HOOK rather than `auraTierForMinutes(Date.now() - startedAt)` inline, for two reasons. The
 * inline version reads the clock during render, which is impure — and more importantly it is
 * computed once and never again, so an aura would be stuck at whatever tier it had when the screen
 * mounted and would never actually ramp. The whole point of 30/60/90 is that it escalates while
 * you watch.
 *
 * Ticks once a minute. The thresholds are minutes apart, so anything finer would be re-rendering a
 * profile card sixty times for each change it can possibly produce.
 */
export function useAuraTier(clock: LockInClock | null | undefined): AuraTier {
  // A ticking TIMESTAMP in state, with the tier derived from it during render — rather than the
  // tier itself in state, set from inside the effect. Both lint rules point the same way here:
  // reading the clock during render is impure, and setting state synchronously in an effect body
  // cascades renders. A lazily-initialised `now` is neither, and the derivation below is pure.
  const [now, setNow] = useState(() => Date.now());

  // setState inside the interval callback is asynchronous, which is the shape the rule wants.
  useGatedInterval(() => setNow(Date.now()), 60_000, Boolean(clock));

  if (!clock) return 0;
  // `now` can be up to a minute stale right after a session starts, which costs nothing: the first
  // threshold is 30 minutes away, so the tier is 0 either way until long after the first tick.
  // Credited minutes (0218): the aura holds while paused rather than ramping on break time.
  return auraTierForMinutes(creditedSeconds(clock, now) / 60);
}

/** Extra opacity and spread the tier adds. Kept small — this sits behind a person's name. */
function auraBoost(tier: AuraTier): { opacity: number; spread: number } {
  return [
    { opacity: 0, spread: 0 },
    { opacity: 0.12, spread: 1 },
    { opacity: 0.24, spread: 2 },
    { opacity: 0.4, spread: 3 },
  ][tier];
}

/**
 * Resolve an equip slot to a catalog item, falling back to the DEFAULT loadout rather than to
 * nothing.
 *
 * The spec's "never a bare colour" rule lives here: every account is seeded with a starter card
 * and halo at signup (#88), so an empty slot means the loadout has not loaded yet, not that the
 * user owns nothing. Falling back to the starter item is both truer and better-looking than
 * falling back to a flat surface.
 */
function resolveOr(itemId: string | undefined, fallbackId: string): CatalogItem | undefined {
  return (itemId ? getItem(itemId) : undefined) ?? getItem(fallbackId);
}

/**
 * Applied cosmetics animate on a single avatar or card, and hold still where the caller says so —
 * a list that already runs one live thing per row, or anything captured to an image. `still`
 * renders the same art frozen, never a reduced version of it.
 */
export type AppliedMotion = 'full' | 'still';

const fmt = (n: number) => n.toFixed(2);

/** Golden-ratio spread, 0..1 — deterministic scatter for embers and specks, so a re-render never
 *  reshuffles a card (React Compiler's purity rule rejects Math.random in render, rightly). */
function scatter(i: number, offset: number): number {
  return ((i + 1) * 0.6180339887 + offset) % 1;
}

// ───────────────────────────── CARD ─────────────────────────────

/**
 * The profile-card backdrop, drawn as the equipped card's scene.
 *
 * Renders the art absolutely behind `children`, so a caller keeps whatever layout it already had —
 * this replaces a background colour, not a container.
 */
export function EquippedCardBackdrop({
  cardId,
  auraTier = 0,
  radius = Radius.card,
  motion = 'full',
  children,
}: {
  cardId?: string;
  auraTier?: AuraTier;
  radius?: number;
  motion?: AppliedMotion;
  children: ReactNode;
}) {
  const item = resolveOr(cardId, 'card-base-hearth');
  const uid = useId();
  const from = item?.art.from ?? Colors.card;
  const to = item?.art.to ?? Colors.disabled;
  const look = CARD_LOOK[item?.id ?? ''] ?? 'hearth';
  const boost = auraBoost(auraTier);

  // MEASURED width/height, never a style-only <Svg>. The art used to be
  // `<Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100">` with no width/height props at
  // all — and an <Svg> with no numeric size inside an absolutely-positioned parent measures as
  // ZERO on Android, so every equipped card painted nothing but its 1px border. That is the whole
  // "cards are buggy" report; campfire-banner-art.tsx carries a comment about the identical trap.
  //
  // One layout pass is the cost. `backgroundColor: from` covers that first frame (and any device
  // where the Svg still fails), so the card is a colour for a moment rather than a hole — the
  // "never a bare surface" rule already stated above.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  // The scene is authored 100 units TALL and as wide as the card's own aspect, rather than
  // stretched from a 0-100 square: a lit scene has round things in it (a key light, magma pools,
  // embers), and preserveAspectRatio="none" turned every one of them into a smear.
  const W = size.h > 0 ? (100 * size.w) / size.h : 100;
  const hasHot = CARD_HOT[look] !== null;

  return (
    <View
      style={[styles.cardWrap, { borderRadius: radius, borderColor: to, backgroundColor: from }]}
      onLayout={onLayout}>
      {size.w > 0 && size.h > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h} viewBox={`0 0 ${fmt(W)} 100`}>
            <CardScene look={look} from={from} to={to} w={W} uid={uid} hot={false} boost={boost.opacity} />
          </Svg>
          {hasHot && <CardHotLayer look={look} to={to} w={W} width={size.w} height={size.h} motion={motion} />}
        </View>
      )}
      {children}
    </View>
  );
}

/** The card id -> its scene. Exported for the shop tile, which draws the same scene in miniature. */
export function cardLookFor(itemId: string): CardLook {
  return CARD_LOOK[itemId] ?? 'hearth';
}

/**
 * One card's scene as SVG nodes, 100 units tall and `w` wide.
 *
 * Layered the way mock 235's `.card-bg` is: the item's own ramp, a key light falling from the top
 * edge, the card's backdrop art, a gloss sweep, then a scrim along the bottom so whatever sits on
 * the card (a name, a rank) still reads. `hot` folds the live layer in, for surfaces that never
 * animate it — the shop tile and a parked card.
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
  const id = (k: string) => `card-${k}-${uid}`;
  return (
    <>
      <Defs>
        {/* Diagonal, not vertical: a card is wider than it is tall, and a vertical ramp on a short
            wide box reads as two stacked bands rather than as a finish. */}
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
        {/* A reusable glow: objectBoundingBox, so each shape that fills with it gets its own
            hot centre — magma pools, a coal bed, an ember horizon. */}
        <RadialGradient id={id('pool')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={tint(to, 0.45)} stopOpacity={0.95} />
          <Stop offset="0.4" stopColor={to} stopOpacity={0.55} />
          <Stop offset="1" stopColor={to} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.16} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={id('gold')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={shade(to, 0.55)} />
          <Stop offset="0.5" stopColor={to} />
          <Stop offset="1" stopColor={shade(to, 0.6)} />
        </LinearGradient>
        <LinearGradient id={id('horizon')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={to} stopOpacity={0} />
          <Stop offset="0.7" stopColor={to} stopOpacity={0.5} />
          <Stop offset="1" stopColor={tint(to, 0.4)} stopOpacity={0.75} />
        </LinearGradient>
        <LinearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="0.4">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.42" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.09} />
          <Stop offset="0.58" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={id('scrim')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.45" stopColor="#000000" stopOpacity={0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('base')})`} />
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('key')})`} />
      {/* The live-session tier turns the key light up rather than swapping the art. */}
      {boost > 0 && <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('key')})`} opacity={Math.min(1, boost * 1.6)} />}
      <CardArt look={look} from={from} to={to} w={w} id={id} />
      {hot && <CardHot look={look} to={to} w={w} />}
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('sheen')})`} />
      <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('scrim')})`} />
    </>
  );
}

/** A card's backdrop art. Every look is drawn in the item's own stops, never a fixed grey. */
function CardArt({ look, from, to, w, id }: { look: CardLook; from: string; to: string; w: number; id: (k: string) => string }) {
  const hot = tint(to, 0.5);
  const pool = `url(#${id('pool')})`;

  switch (look) {
    // Forged Bronze — overlapping struck plates, riveted along the seams, with hammer dents.
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
          <G fill={tint(to, 0.1)}>
            <Path d={`M0 0 L${w} 0 L${w} 24 L0 32 Z`} opacity={0.16} />
            <Path d={`M0 46 L${w} 38 L${w} 62 L0 70 Z`} opacity={0.14} />
            <Path d={`M0 84 L${w} 76 L${w} 100 L0 100 Z`} opacity={0.12} />
          </G>
          <Path
            d={`M0 32 L${w} 24 M0 46 L${w} 38 M0 70 L${w} 62 M0 84 L${w} 76`}
            stroke={shade(from, 0.6)}
            strokeWidth={1.2}
            opacity={0.7}
          />
          <Path d={`M0 33 L${w} 25 M0 71 L${w} 63`} stroke={to} strokeWidth={0.5} opacity={0.4} />
          {rivets}
          <G fill="#ffffff" opacity={0.05}>
            <Ellipse cx={w * 0.22} cy={52} rx={9} ry={5} />
            <Ellipse cx={w * 0.58} cy={14} rx={11} ry={5} />
            <Ellipse cx={w * 0.8} cy={88} rx={8} ry={4} />
          </G>
        </>
      );
    }

    // Brushed Steel — fine parallel striations with a hard specular band across the brushing.
    case 'brushed': {
      let a = '';
      let b = '';
      for (let y = 0; y < 106; y += 1.6) {
        a += `M0 ${fmt(y)} L${fmt(w)} ${fmt(y - 4)} `;
        b += `M0 ${fmt(y + 0.8)} L${fmt(w)} ${fmt(y - 3.2)} `;
      }
      return (
        <>
          <Path d={a} stroke={to} strokeWidth={0.35} opacity={0.24} />
          <Path d={b} stroke={shade(from, 0.5)} strokeWidth={0.35} opacity={0.3} />
          <Rect x="0" y="24" width={w} height="34" fill={`url(#${id('band')})`} />
        </>
      );
    }

    // Carbon Fiber — a 2x2 twill: alternate cells catch the light, so the weave reads in 3D.
    case 'weave': {
      const cell = 9;
      let lit = '';
      let dim = '';
      let edge = '';
      for (let r = 0; r * cell < 100; r += 1) {
        for (let c = 0; c * cell < w; c += 1) {
          const x = c * cell;
          const y = r * cell;
          const cellD = `M${x + 0.6} ${y + 0.6} h${cell - 1.2} v${cell - 1.2} h${-(cell - 1.2)} Z `;
          if ((Math.floor(c / 2) + r) % 2 === 0) {
            lit += cellD;
            edge += `M${x + 1.2} ${y + 1.6} h${cell - 2.4} `;
          } else {
            dim += cellD;
          }
        }
      }
      return (
        <>
          <Path d={dim} fill={to} opacity={0.12} />
          <Path d={lit} fill={tint(to, 0.15)} opacity={0.3} />
          <Path d={edge} stroke="#ffffff" strokeWidth={0.6} opacity={0.12} />
        </>
      );
    }

    // Obsidian Mesh — a glassy diamond lattice with shards of reflection across it.
    case 'mesh': {
      let lattice = '';
      for (let x = -60; x < w + 60; x += 14) {
        lattice += `M${x} 0 L${x - 58} 100 M${x - 58} 0 L${x} 100 `;
      }
      return (
        <>
          <Path d={lattice} stroke={to} strokeWidth={0.6} opacity={0.34} />
          <Path d={`M${w * 0.08} 0 L${w * 0.3} 0 L${w * 0.12} 100 L0 100 L0 40 Z`} fill="#ffffff" opacity={0.045} />
          <Path d={`M${w * 0.6} 0 L${w * 0.68} 0 L${w * 0.5} 100 L${w * 0.44} 100 Z`} fill={to} opacity={0.12} />
          <Path d={`M${w * 0.82} 0 L${w} 0 L${w} 30 Z`} fill="#ffffff" opacity={0.05} />
        </>
      );
    }

    // Cracked Magma — molten pools glowing under a fissured crust. The spec's headline example.
    case 'magma':
      return (
        <>
          <Ellipse cx={w * 0.18} cy={72} rx={30} ry={26} fill={pool} opacity={0.85} />
          <Ellipse cx={w * 0.62} cy={30} rx={34} ry={28} fill={pool} opacity={0.75} />
          <Ellipse cx={w * 0.88} cy={82} rx={24} ry={20} fill={pool} opacity={0.8} />
          <Path d={magmaCracks(w)} stroke={to} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.38} />
        </>
      );

    // Plasma Grid — a contained lattice humming under the picture, nodes lit at the crossings.
    case 'grid': {
      let lines = '';
      for (let x = 0; x <= w; x += 12.5) lines += `M${fmt(x)} 0 L${fmt(x)} 100 `;
      for (let y = 0; y <= 100; y += 12.5) lines += `M0 ${y} L${fmt(w)} ${y} `;
      const nodes = [0, 1, 2, 3, 4, 5].map((i) => ({
        x: Math.round((scatter(i, 0.2) * w) / 12.5) * 12.5,
        y: Math.round((scatter(i, 0.55) * 100) / 12.5) * 12.5,
      }));
      return (
        <>
          <Path d={lines} stroke={to} strokeWidth={1.8} opacity={0.08} />
          <Path d={lines} stroke={to} strokeWidth={0.45} opacity={0.42} />
          {nodes.map((n, i) => (
            <G key={i}>
              <Circle cx={n.x} cy={n.y} r={3.4} fill={to} opacity={0.22} />
              <Circle cx={n.x} cy={n.y} r={1.4} fill={hot} />
            </G>
          ))}
        </>
      );
    }

    // Golden Anvil — gold sheen struck across the card, the anvil itself in relief on the left.
    case 'anvil': {
      let lines = '';
      for (let y = 0; y < 104; y += 2.2) lines += `M0 ${fmt(y)} L${fmt(w)} ${fmt(y - 3)} `;
      return (
        <>
          <Rect x="0" y="0" width={w} height="100" fill={`url(#${id('gold')})`} opacity={0.62} />
          <Path d={lines} stroke="#ffffff" strokeWidth={0.3} opacity={0.08} />
          <Path
            d="M6 46 Q12 40 22 40 L46 40 L46 50 L37 52 L35 64 L43 70 L43 81 L13 81 L13 70 L21 64 L19 52 L14 50 Q8 50 6 46 Z"
            fill={shade(from, 0.5)}
            opacity={0.85}
          />
          <Path d="M22 40.6 L46 40.6" stroke={tint(to, 0.5)} strokeWidth={0.9} opacity={0.85} />
        </>
      );
    }

    // Emberfall Card — ash on dark glass, the season's fire rising from under it.
    case 'ember':
      return (
        <>
          <Ellipse cx={w / 2} cy={114} rx={w * 0.72} ry={62} fill={pool} opacity={0.8} />
          <Path d={`M${w * 0.12} 0 L${w * 0.26} 0 L${w * 0.1} 100 L0 100 L0 50 Z`} fill="#ffffff" opacity={0.035} />
          <G fill="#ffffff">
            {Array.from({ length: 14 }, (_, i) => (
              <Circle key={i} cx={scatter(i, 0.3) * w} cy={scatter(i, 0.71) * 80} r={0.5 + scatter(i, 0.9) * 0.5} opacity={0.14} />
            ))}
          </G>
        </>
      );

    // Emberfall Sovereign Card — the fall commanded: a molten horizon, embers coming down into it,
    // and the crown standing faint over the whole card.
    case 'crown': {
      const cx = w * 0.72;
      return (
        <>
          <Rect x="0" y="62" width={w} height="38" fill={`url(#${id('horizon')})`} />
          <Path
            d={`M${cx - 22} 62 L${cx - 22} 34 L${cx - 11} 46 L${cx} 26 L${cx + 11} 46 L${cx + 22} 34 L${cx + 22} 62 Z`}
            fill={to}
            opacity={0.1}
          />
          <G stroke={hot} strokeWidth={0.9} strokeLinecap="round" opacity={0.55}>
            {Array.from({ length: 7 }, (_, i) => {
              const x = scatter(i, 0.13) * w;
              const y = 6 + scatter(i, 0.47) * 48;
              return <Path key={i} d={`M${fmt(x)} ${fmt(y)} l-2 6`} />;
            })}
          </G>
        </>
      );
    }

    // Emberfall Sovereign — the one-of-one. Gold on black: a sunburst falling from the top edge,
    // and a struck filigree border no other card carries.
    case 'sovereign': {
      let rays = '';
      const ox = w / 2;
      const oy = -12;
      for (let k = 0; k < 16; k += 1) {
        const a0 = Math.PI * (0.06 + (k * 0.88) / 16);
        const a1 = a0 + 0.045;
        rays += `M${ox} ${oy} L${fmt(ox + 260 * Math.cos(a0))} ${fmt(oy + 260 * Math.sin(a0))} L${fmt(ox + 260 * Math.cos(a1))} ${fmt(oy + 260 * Math.sin(a1))} Z `;
      }
      const corner = (x: number, y: number) => `M${x} ${y - 2.6} L${x + 2.6} ${y} L${x} ${y + 2.6} L${x - 2.6} ${y} Z `;
      return (
        <>
          <Path d={rays} fill={to} opacity={0.08} />
          <Rect x="3.5" y="3.5" width={w - 7} height="93" rx="8" fill="none" stroke={to} strokeWidth={0.8} opacity={0.7} />
          <Rect x="6.5" y="6.5" width={w - 13} height="87" rx="6" fill="none" stroke={to} strokeWidth={0.35} opacity={0.4} />
          <Path d={corner(3.5 + 4, 3.5 + 4) + corner(w - 7.5, 7.5) + corner(7.5, 92.5) + corner(w - 7.5, 92.5)} fill={tint(to, 0.3)} />
        </>
      );
    }

    // The base Hearth card: banked coals glowing along the bottom edge.
    case 'hearth':
    default:
      return (
        <>
          <Ellipse cx={w * 0.22} cy={106} rx={w * 0.46} ry={48} fill={pool} opacity={0.5} />
          {Array.from({ length: 8 }, (_, i) => {
            const x = w * (0.05 + i * 0.12);
            const y = 95 - (i % 3) * 3;
            const r = 2.6 + (i % 2) * 1.4;
            return (
              <G key={i}>
                <Circle cx={x} cy={y} r={r} fill={shade(to, 0.35)} opacity={0.8} />
                <Circle cx={x} cy={y - r * 0.2} r={r * 0.45} fill={hot} opacity={0.5} />
              </G>
            );
          })}
        </>
      );
  }
}

/** The crack network for Cracked Magma, laid out across whatever width the card actually is. */
function magmaCracks(w: number): string {
  const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x * w)} ${y}`).join(' ');
  return [
    line([[-0.02, 34], [0.18, 30], [0.3, 40], [0.48, 33], [0.66, 42], [0.84, 34], [1.02, 40]]),
    line([[0.3, 40], [0.26, 62], [0.36, 78], [0.3, 100]]),
    line([[0.66, 42], [0.74, 60], [0.66, 74], [0.72, 100]]),
    line([[0.48, 33], [0.46, 14], [0.54, 0]]),
    line([[0.18, 30], [0.1, 14], [0.14, 0]]),
    line([[0.84, 34], [0.92, 20]]),
  ].join(' ');
}

/**
 * How each look's hot layer moves, or `null` for a look that has none. Only the epic+ cards carry
 * one — mock 235 calls the card an "animated background", and that is the tier it is earned at.
 */
const CARD_HOT: Record<CardLook, 'pulse' | 'flash' | null> = {
  hearth: null,
  plated: null,
  brushed: null,
  weave: null,
  mesh: null,
  magma: 'pulse',
  grid: 'flash',
  anvil: 'pulse',
  ember: 'pulse',
  crown: 'pulse',
  sovereign: 'pulse',
};

/** The bright parts of an epic+ card: what glows, flashes or sparks. No gradients, so it can sit in
 *  its own <Svg> without a second set of <Defs>. */
function CardHot({ look, to, w }: { look: CardLook; to: string; w: number }) {
  const hot = tint(to, 0.5);
  switch (look) {
    case 'magma': {
      const d = magmaCracks(w);
      return (
        <G fill="none" strokeLinecap="round" strokeLinejoin="round">
          <Path d={d} stroke={hot} strokeWidth={1.1} />
          <Path d={d} stroke={tint(to, 0.8)} strokeWidth={0.4} />
        </G>
      );
    }
    // The mock's arc across the grid: one jagged strike between two nodes.
    case 'grid': {
      const pts: [number, number][] = [
        [0.3, 14],
        [0.36, 30],
        [0.31, 42],
        [0.42, 56],
        [0.38, 66],
        [0.5, 84],
      ];
      const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x * w)} ${y}`).join(' ');
      return (
        <G fill="none" strokeLinecap="round" strokeLinejoin="round">
          <Path d={d} stroke={to} strokeWidth={2.6} opacity={0.4} />
          <Path d={d} stroke={tint(to, 0.7)} strokeWidth={0.8} />
        </G>
      );
    }
    // Sparks off the anvil face.
    case 'anvil':
      return (
        <G fill={tint(to, 0.7)}>
          {Array.from({ length: 8 }, (_, i) => (
            <Circle key={i} cx={24 + scatter(i, 0.31) * 34} cy={20 + scatter(i, 0.77) * 18} r={0.7 + scatter(i, 0.5) * 0.9} />
          ))}
          <Path d="M34 38 L30 30 M38 38 L40 28 M42 39 L48 32" stroke={tint(to, 0.7)} strokeWidth={0.6} strokeLinecap="round" />
        </G>
      );
    // Embers climbing out of the glow.
    case 'ember':
      return (
        <G>
          {Array.from({ length: 9 }, (_, i) => {
            const x = w * (0.15 + scatter(i, 0.41) * 0.7);
            const y = 52 + scatter(i, 0.83) * 42;
            const r = 0.9 + scatter(i, 0.27) * 0.9;
            return (
              <G key={i}>
                <Circle cx={x} cy={y} r={r * 2.4} fill={to} opacity={0.28} />
                <Circle cx={x} cy={y} r={r} fill={hot} />
              </G>
            );
          })}
        </G>
      );
    case 'crown':
      return (
        <G>
          <Path d={`M0 88 Q${w * 0.25} 84 ${w * 0.5} 88 T${w} 87`} stroke={hot} strokeWidth={1.2} fill="none" />
          {Array.from({ length: 6 }, (_, i) => (
            <Circle key={i} cx={scatter(i, 0.62) * w} cy={66 + scatter(i, 0.19) * 22} r={0.9 + scatter(i, 0.4)} fill={hot} />
          ))}
        </G>
      );
    case 'sovereign':
      return (
        <G>
          {Array.from({ length: 9 }, (_, i) => {
            const x = w * (0.1 + scatter(i, 0.37) * 0.8);
            const y = 18 + scatter(i, 0.66) * 70;
            return (
              <G key={i}>
                <Circle cx={x} cy={y} r={2.2} fill={to} opacity={0.22} />
                <Circle cx={x} cy={y} r={0.8} fill={tint(to, 0.6)} />
              </G>
            );
          })}
        </G>
      );
    default:
      return null;
  }
}

/** The shared cadence for every card's hot layer — one driver for a whole Agora page. */
const CARD_CLOCK_MS = 4800;

function CardHotLayer({
  look,
  to,
  w,
  width,
  height,
  motion,
}: {
  look: CardLook;
  to: string;
  w: number;
  width: number;
  height: number;
  motion: AppliedMotion;
}) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const animate = motion === 'full' && !reduceMotion && active;
  const art = (
    <Svg width={width} height={height} viewBox={`0 0 ${fmt(w)} 100`}>
      <CardHot look={look} to={to} w={w} />
    </Svg>
  );
  return animate ? (
    <CardHotLive kind={CARD_HOT[look] ?? 'pulse'}>{art}</CardHotLive>
  ) : (
    // Parked: held at a strong frame rather than dark, so a still card still shows its fire.
    <View style={[StyleSheet.absoluteFill, { opacity: 0.85 }]}>{art}</View>
  );
}

function CardHotLive({ kind, children }: { kind: 'pulse' | 'flash'; children: ReactNode }) {
  const clock = useCosmeticClock(CARD_CLOCK_MS, true);
  const style = useAnimatedStyle(() => {
    if (kind === 'flash') {
      // Two strikes a cycle, with the grid's arc never fully gone — it hums between them.
      return { opacity: 0.18 + 0.82 * flashCurve((clock.value * 3) % 1) };
    }
    return { opacity: 0.5 + 0.5 * (0.5 - 0.5 * Math.cos(clock.value * Math.PI * 4)) };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity: 0 }, style]}>{children}</Animated.View>;
}

// ───────────────────────────── HALO ─────────────────────────────

/**
 * How far outside the avatar each style's art reaches, as a multiple of the avatar's RADIUS.
 *
 * This table is what makes the halo hug the avatar. The box used to be a flat `size * 1.34` while
 * every mark was drawn at a hardcoded radius of 42 in a 0-100 viewBox — so the ring only landed
 * correctly at one avatar size and one aura tier. Any other combination either floated the ring
 * away from the face (a boosted aura grew the box, which shrank the avatar inside a fixed-radius
 * ring) or pushed the outer decorations past 50 and CLIPPED them at the viewBox edge — Inferno
 * Flare's tongues, Hades' ticks and the Emberfall crown's points all reached R+9 = 51.
 *
 * Now the box is derived from the reach, and every mark is derived from the avatar. Both bugs
 * ("doesn't centre on the avatar", "reads poorly") come from the same missing link.
 */
const HALO_REACH: Record<HaloStyle, number> = {
  ring: 1.2,
  band: 1.2,
  double: 1.22,
  glow: 1.3,
  embers: 1.34,
  prism: 1.22,
  flare: 1.42,
  aura: 1.48,
  crown: 1.38,
};

/**
 * The premium halos that turn, and how: loops per HALO_CLOCK_MS cycle, negative for the other way.
 * Only styles that are round all the way — a crown or a ring of upward flames has a top, and
 * spinning it would put the top at the bottom.
 */
const HALO_SPIN: Partial<Record<HaloStyle, number>> = {
  prism: 2,
  double: -3,
  aura: 1,
};

const HALO_CLOCK_MS = 24_000;

export function haloStyleFor(itemId: string): HaloStyle {
  return HALO_STYLE[itemId] ?? 'ring';
}

/**
 * The ring around an avatar, drawn from the equipped halo's art.
 *
 * `children` is the avatar itself, centred inside. The ring is drawn OUTSIDE the avatar's bounds
 * (the SVG box is larger than `size`), so a halo never crops the face it surrounds — which is what
 * a plain `borderWidth` did.
 */
export function EquippedAvatarHalo({
  haloId,
  size,
  auraTier = 0,
  motion = 'full',
  children,
}: {
  haloId?: string;
  size: number;
  auraTier?: AuraTier;
  /** `still` parks a spinning halo — list surfaces that already run their own motion per row. */
  motion?: AppliedMotion;
  children: ReactNode;
}) {
  const uid = useId();
  const item = resolveOr(haloId, 'halo-base-ring');
  const from = item?.art.from ?? Colors.ember;
  const to = item?.art.to ?? Colors.amber;
  const style = HALO_STYLE[item?.id ?? ''] ?? 'ring';
  const boost = auraBoost(auraTier);

  // Room for exactly what this style draws, plus the tier's bloom — no more, so the ring stays
  // tight against the avatar, and no less, so nothing clips.
  const reach = HALO_REACH[style] + boost.spread * 0.09;
  const pad = (size / 2) * (reach - 1);
  const box = size + pad * 2;
  // The avatar's radius expressed in the Svg's own 0-100 space. Every mark in HaloRing is a
  // multiple of THIS, which is what keeps the geometry correct at any avatar size and any tier.
  const rAvatar = 50 * (size / box);
  const spin = HALO_SPIN[style];
  const spins = motion === 'full' && spin !== undefined;
  const ring = { style, from, to, boost: boost.opacity, spread: boost.spread, rAvatar };

  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill} pointerEvents="none">
        <HaloRing {...ring} uid={`${uid}f`} part={spins ? 'fixed' : 'all'} />
      </Svg>
      {spins && (
        <HaloSpinLayer box={box} mult={spin}>
          <HaloRing {...ring} uid={`${uid}s`} part="spin" />
        </HaloSpinLayer>
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

/** The turning half of a premium halo. Parks at rest under reduced motion or off-screen. */
function HaloSpinLayer({ box, mult, children }: { box: number; mult: number; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const active = useMotionActive();
  const art = (
    <Svg width={box} height={box} viewBox="0 0 100 100">
      {children}
    </Svg>
  );
  if (reduceMotion || !active) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {art}
      </View>
    );
  }
  return <HaloSpinLive mult={mult}>{art}</HaloSpinLive>;
}

function HaloSpinLive({ mult, children }: { mult: number; children: ReactNode }) {
  const clock = useCosmeticClock(HALO_CLOCK_MS, true);
  // The box is square and centred on the avatar, so the view's own centre IS the pivot.
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${clock.value * mult * 360}deg` }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

/**
 * One halo's ring, as SVG nodes centred on (50, 50) in a 0-100 box. Exported for the shop tile.
 *
 * `part` splits a spinning halo into what stays put (`fixed`) and what turns (`spin`); everything
 * else, and any parked halo, draws `all`.
 */
export function HaloRing({
  style,
  from,
  to,
  boost,
  spread,
  rAvatar,
  uid,
  part = 'all',
}: {
  style: HaloStyle;
  from: string;
  to: string;
  boost: number;
  spread: number;
  rAvatar: number;
  uid: string;
  part?: 'all' | 'fixed' | 'spin';
}) {
  const o = (base: number) => Math.min(1, base + boost);
  // The ring sits just clear of the avatar's edge — 6% of its radius, so a 24px badge and a 72px
  // profile avatar get the same visual gap rather than the same absolute one.
  const R = rAvatar * 1.06;
  // Every offset and stroke below was authored against R = 42, back when that was a constant. `u`
  // rescales that tuning to whatever R now is, so the proportions survive unchanged at any size.
  const u = R / 42;
  const fixed = part !== 'spin';
  const turning = part !== 'fixed';
  const sweepId = `haloSweep-${uid}`;
  const crestId = `haloCrest-${uid}`;
  const sweep = `url(#${sweepId})`;
  const hot = tint(to, 0.55);

  // A soft outer glow without a blur filter: three widening strokes, each fainter than the last.
  const glow = (r: number, colour: string, w: number) => (
    <G fill="none" stroke={colour}>
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 3.2} opacity={0.05} />
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 2} opacity={0.09} />
      <Circle cx="50" cy="50" r={r} strokeWidth={w * 1.3} opacity={0.14} />
    </G>
  );
  const ring = (r: number, stroke: string, w: number, opacity = 1) => (
    <Circle cx="50" cy="50" r={r} fill="none" stroke={stroke} strokeWidth={w} opacity={opacity} />
  );
  const at = (r: number, a: number) => ({ x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) });

  // The live-session tier blooms OUTWARD (HALO_REACH already reserved the room for it) instead of
  // only turning the opacity up. Nothing at tier 0, which is the common case.
  const tierBloom =
    fixed && spread > 0 ? <Circle cx="50" cy="50" r={R + (3 + spread * 2.6) * u} fill={to} opacity={0.07 + spread * 0.02} /> : null;

  const defs = (
    <Defs>
      {/* The gradient SWEEP every ring is stroked with: its own two stops running round the
          circle, light on one shoulder and deep on the other, instead of one flat colour. */}
      <LinearGradient id={sweepId} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={tint(to, 0.25)} />
        <Stop offset="0.5" stopColor={from} />
        <Stop offset="1" stopColor={to} />
      </LinearGradient>
      <LinearGradient id={crestId} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={tint(to, 0.35)} />
        <Stop offset="1" stopColor={from} />
      </LinearGradient>
    </Defs>
  );

  switch (style) {
    // Copper Ring — a channelled band: two bright rails over a dark track, notched all round.
    case 'band': {
      let ticks = '';
      for (let k = 0; k < 24; k += 1) {
        const a = (k * Math.PI * 2) / 24;
        const p0 = at(R - 1.5 * u, a);
        const p1 = at(R + 1.5 * u, a);
        ticks += `M${fmt(p0.x)} ${fmt(p0.y)} L${fmt(p1.x)} ${fmt(p1.y)} `;
      }
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R, to, 3 * u)}
          {ring(R, shade(from, 0.45), 5 * u, o(0.9))}
          <Path d={ticks} stroke={to} strokeWidth={0.9 * u} opacity={o(0.75)} />
          {ring(R + 2.2 * u, sweep, 1.4 * u)}
          {ring(R - 2.2 * u, sweep, 1.4 * u)}
        </>
      );
    }

    // Ember Halo — two condensed rings with an orbit of coals turning between them.
    case 'double':
      return (
        <>
          {defs}
          {fixed && (
            <>
              {tierBloom}
              {glow(R + u, from, 2.4 * u)}
              {ring(R + 3 * u, sweep, 2.6 * u, o(0.95))}
              {ring(R - 3 * u, to, 1.4 * u, o(0.8))}
            </>
          )}
          {turning &&
            Array.from({ length: 6 }, (_, i) => {
              const p = at(R, (i * Math.PI * 2) / 6);
              return (
                <G key={i}>
                  <Circle cx={p.x} cy={p.y} r={4 * u} fill={to} opacity={0.18} />
                  <Circle cx={p.x} cy={p.y} r={2.3 * u} fill={from} />
                  <Circle cx={p.x - 0.5 * u} cy={p.y - 0.5 * u} r={1.1 * u} fill={hot} />
                </G>
              );
            })}
        </>
      );

    // Glowing Amber — a thick ring of honey-light, molten in the middle, with a faint outer echo.
    case 'glow':
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R, to, 5 * u)}
          {ring(R, from, 6 * u, o(0.5))}
          {ring(R, sweep, 3.6 * u, o(0.95))}
          {ring(R, tint(to, 0.6), 1.2 * u, o(0.9))}
          {ring(R + 5.6 * u, to, 0.7 * u, 0.3)}
        </>
      );

    // Emberfall Halo — "a ring of falling embers that never reaches the ground": embers hanging off
    // the lower arc, each a little further out and a little smaller than the last.
    case 'embers':
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R, from, 3 * u)}
          {ring(R, sweep, 3.2 * u, o(0.95))}
          {Array.from({ length: 7 }, (_, i) => {
            const p = at(R + (2.6 + (i % 3) * 2.6) * u, Math.PI * (0.18 + i * 0.107));
            const r = (1.9 - (i % 3) * 0.4) * u;
            return (
              <G key={i}>
                <Circle cx={p.x} cy={p.y} r={r * 2} fill={to} opacity={0.2} />
                <Circle cx={p.x} cy={p.y} r={r} fill={to} />
                <Circle cx={p.x} cy={p.y} r={r * 0.5} fill={hot} />
              </G>
            );
          })}
        </>
      );

    // Diamond Prism — a faceted spectrum sweeping round, glinting, inside a fine bezel.
    case 'prism': {
      const n = 12;
      const gap = 0.07;
      return (
        <>
          {defs}
          {fixed && (
            <>
              {tierBloom}
              {glow(R, mix(from, to, 0.5), 3 * u)}
              {ring(R + 3.3 * u, '#ffffff', 0.5 * u, 0.35)}
              {ring(R - 3.3 * u, '#ffffff', 0.5 * u, 0.3)}
            </>
          )}
          {turning && (
            <G fill="none" strokeLinecap="round">
              {Array.from({ length: n }, (_, i) => {
                const a0 = (i * Math.PI * 2) / n + gap;
                const a1 = ((i + 1) * Math.PI * 2) / n - gap;
                const p0 = at(R, a0);
                const p1 = at(R, a1);
                // from -> to -> from around the circle: the conic sweep of mock 236's prism ring.
                const tri = 1 - Math.abs((2 * i) / n - 1);
                return (
                  <Path
                    key={i}
                    d={`M${fmt(p0.x)} ${fmt(p0.y)} A${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)}`}
                    stroke={mix(from, to, tri)}
                    strokeWidth={4.4 * u}
                    opacity={o(0.95)}
                  />
                );
              })}
              {[0, 4, 8].map((i) => {
                const a = (i * Math.PI * 2) / n + 0.18;
                const p0 = at(R + 0.4 * u, a);
                const p1 = at(R + 0.4 * u, a + 0.2);
                return (
                  <Path
                    key={`g${i}`}
                    d={`M${fmt(p0.x)} ${fmt(p0.y)} A${fmt(R)} ${fmt(R)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)}`}
                    stroke="#ffffff"
                    strokeWidth={1.5 * u}
                    opacity={0.9}
                  />
                );
              })}
            </G>
          )}
        </>
      );
    }

    // Inferno Flare — the spec's named example: a ring of fire, curved tongues licking outward,
    // each with a hot core.
    case 'flare': {
      const outer = flameRing(R, u, 14, 1, (k) => (k % 2 === 0 ? 8 : 5.4));
      const inner = flameRing(R, u, 14, 0.5, (k) => (k % 2 === 0 ? 4.6 : 3));
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R + 2 * u, to, 4 * u)}
          <Path d={outer} fill={to} opacity={o(0.88)} />
          <Path d={inner} fill={hot} opacity={o(0.9)} />
          {ring(R, sweep, 4 * u, o(0.95))}
        </>
      );
    }

    // Hades Halo — the mythic: a wide, dark, chaotic aura, crackling spikes turning slowly round it.
    case 'aura': {
      let spikes = '';
      for (let k = 0; k < 9; k += 1) {
        const a = (k * Math.PI * 2) / 9 + scatter(k, 0.2) * 0.4;
        const len = 6 + scatter(k, 0.6) * 4.5;
        const p0 = at(R + u, a);
        const p1 = at(R + (1 + len * 0.4) * u, a + 0.09);
        const p2 = at(R + (1 + len * 0.7) * u, a - 0.05);
        const p3 = at(R + (1 + len) * u, a + 0.07);
        spikes += `M${fmt(p0.x)} ${fmt(p0.y)} L${fmt(p1.x)} ${fmt(p1.y)} L${fmt(p2.x)} ${fmt(p2.y)} L${fmt(p3.x)} ${fmt(p3.y)} `;
      }
      return (
        <>
          {defs}
          {fixed && (
            <>
              {tierBloom}
              <Circle cx="50" cy="50" r={R + 8 * u} fill={to} opacity={o(0.1)} />
              {glow(R, to, 4 * u)}
              {ring(R, from, 4.5 * u, o(0.95))}
              {ring(R - 1.6 * u, to, 1.2 * u, o(0.9))}
            </>
          )}
          {turning && (
            <G fill="none" strokeLinecap="round" strokeLinejoin="round">
              <Path d={spikes} stroke={to} strokeWidth={1.4 * u} opacity={o(0.85)} />
              <Path d={spikes} stroke={tint(to, 0.5)} strokeWidth={0.5 * u} />
            </G>
          )}
        </>
      );
    }

    // Emberfall Crown — points at the top rather than all the way round, a jewel at the centre.
    case 'crown': {
      let points = '';
      [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9].forEach((offset) => {
        const a = -Math.PI / 2 + offset;
        // The outer points are tallest at the crown's centre and step down toward the sides,
        // which is what makes six spikes read as a crown rather than as a cog.
        const tip = R + (9 - Math.abs(offset) * 3.5) * u;
        const p0 = at(R, a - 0.1);
        const p1 = at(tip, a);
        const p2 = at(R, a + 0.1);
        points += `M${fmt(p0.x)} ${fmt(p0.y)} L${fmt(p1.x)} ${fmt(p1.y)} L${fmt(p2.x)} ${fmt(p2.y)} Z `;
      });
      const jewel = at(R + 3.4 * u, -Math.PI / 2);
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R, from, 3 * u)}
          <Path d={points} fill={`url(#${crestId})`} stroke={tint(to, 0.4)} strokeWidth={0.5 * u} opacity={o(0.95)} />
          {ring(R, sweep, 4 * u, o(0.95))}
          <Circle cx={jewel.x} cy={jewel.y} r={2.4 * u} fill={to} opacity={0.3} />
          <Circle cx={jewel.x} cy={jewel.y} r={1.4 * u} fill={hot} />
        </>
      );
    }

    // Emberring, the base — one clean swept ring with a specular inner edge. The plain one, on
    // purpose: everything above has to read as an upgrade from it.
    case 'ring':
    default:
      return (
        <>
          {defs}
          {tierBloom}
          {glow(R, to, 3 * u)}
          {ring(R, sweep, 3.4 * u, o(0.95))}
          {ring(R - 1.1 * u, '#ffffff', 0.6 * u, 0.22)}
        </>
      );
  }
}

/** `count` flame tongues round a ring of radius R, as one compound path — one draw call, not 14. */
function flameRing(R: number, u: number, count: number, scale: number, length: (k: number) => number): string {
  let d = '';
  for (let k = 0; k < count; k += 1) {
    const a = (k * Math.PI * 2) / count;
    const half = 0.12 * scale + 0.04;
    const base = R + 0.5 * u;
    const tip = R + length(k) * u;
    // A lean, so the tongues curl the same way round the ring instead of standing out like spokes.
    const lean = 0.09;
    const b0 = { x: 50 + base * Math.cos(a - half), y: 50 + base * Math.sin(a - half) };
    const b1 = { x: 50 + base * Math.cos(a + half), y: 50 + base * Math.sin(a + half) };
    const t = { x: 50 + tip * Math.cos(a + lean), y: 50 + tip * Math.sin(a + lean) };
    const mid = (base + tip) / 2;
    const c0 = { x: 50 + mid * Math.cos(a - half * 0.6), y: 50 + mid * Math.sin(a - half * 0.6) };
    const c1 = { x: 50 + mid * Math.cos(a + half * 1.1 + lean), y: 50 + mid * Math.sin(a + half * 1.1 + lean) };
    d += `M${fmt(b0.x)} ${fmt(b0.y)} Q${fmt(c0.x)} ${fmt(c0.y)} ${fmt(t.x)} ${fmt(t.y)} Q${fmt(c1.x)} ${fmt(c1.y)} ${fmt(b1.x)} ${fmt(b1.y)} Z `;
  }
  return d;
}

const styles = StyleSheet.create({
  cardWrap: {
    overflow: 'hidden',
    borderWidth: 1,
  },
});
