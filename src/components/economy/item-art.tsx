import { useEffect, useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { RelicArt, hasRelicArt } from '@/components/economy/relic-art';
import type { ArtKind, CatalogItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, type Rarity } from '@/lib/economy/rarity';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ITEM ART — one 2.5D vector family per item TYPE (design-mocks/216).
//
// One vector family per TYPE, recoloured by the item's own two-stop palette (21f, art from
// mocks 61/63/64/65). ~60 items don't need ~60 hand-drawn files: within a type the silhouette is
// the constant and the PALETTE is the item, which is also exactly the §4 flame constraint —
// a flame cosmetic changes the colour ramp and nothing else.
//
// WHAT MOCK 216 CHANGED. The silhouettes used to be flat fills: one colour for the body, one for
// the accent, sitting on nothing. Next to a Rocket-League inventory that reads as clip art. The
// mock's answer is four things applied to every type at once, and they are what this file now
// draws:
//
//   1. a GRADIENT body — a white specular top, the item's own colour through the middle, and a
//      shaded base derived from its second stop, so the shape has a light direction;
//   2. a RARITY GLOW behind it, which is the one piece of colour that is NOT the item's;
//   3. a GROUND SHADOW, which is what actually makes it read as an object rather than a sticker;
//   4. a slow FLOAT, with the shadow tightening under it as it rises.
//
// 1-3 are static and free. 4 is not, so it is gated — see `ItemPedestal`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type ArtMotion = 'auto' | 'off' | 'on';

type Props = {
  item: CatalogItem;
  size?: number;
  /**
   * `auto` (the default) floats at hero sizes and holds still in a grid — see FLOAT_MIN_SIZE.
   * `off` is for anything captured to an image: a share card rendered mid-float would snapshot
   * the item at a random point in its cycle. `on` forces it, for a hero drawn small.
   */
  motion?: ArtMotion;
};

/**
 * The aspect every caller has laid out against since the flat era (90×96). Kept exactly, so
 * nothing that already positions an item moves: the drawing inside the box is what changed.
 */
const ASPECT = 1.07;

/**
 * Below this, the float is dropped and the whole icon collapses to a SINGLE <Svg> with the glow
 * and the shadow drawn inside it.
 *
 * THIS IS THE PERF GATE, and it is a size rather than a count on purpose. A full inventory is an
 * un-virtualised ScrollView — every tile a user owns is mounted at once — so a per-icon animation
 * is a per-icon transform commit every frame, and at 40px a 2px rise is a shimmer nobody asked
 * for anyway. Capping by mount order instead would mean the first N tiles floated and the rest did
 * not, which is worse: an inconsistency that moves as you scroll. Grids get depth without motion;
 * heroes, reveals and detail screens — one or two on screen, drawn large — get the float.
 */
const FLOAT_MIN_SIZE = 56;

export function ItemArt({ item, size = 44, motion = 'auto' }: Props) {
  const { from, to } = tilePalette(item);
  const uid = useId();
  const g = gradientIds(uid);

  // RELICS ARE THE ONE TYPE WHERE THE SILHOUETTE IS THE ITEM, so they are drawn per KEY rather than
  // per kind — see relic-art.tsx. Delegated here rather than at each call site so the reveal, the
  // share card, the Trophy Hall shelf and the Collection can never disagree about what a scroll
  // looks like. Still recoloured from `tilePalette`, and since mock 216 still pedestalled: the
  // drawing is the relic's own, the glow and the ground shadow under it are everyone's.
  if (hasRelicArt(item.id)) {
    return (
      <ItemPedestal size={size} rarity={item.rarity} motion={motion}>
        <RelicArt relicKey={item.id} from={from} to={to} size={size} />
      </ItemPedestal>
    );
  }

  return (
    <ItemPedestal
      size={size}
      rarity={item.rarity}
      motion={motion}
      inline={
        <>
          <Defs>
            {/* The body ramp — specular white, the item's own colour, a shaded base. This is the
                whole 2.5D trick: one vertical gradient reads as a lit object. */}
            <LinearGradient id={g.body} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
              <Stop offset="0.4" stopColor={from} />
              <Stop offset="1" stopColor={shade(to, 0.55)} />
            </LinearGradient>
            {/* The face ramp — for the flat planes (a card, a banner, a plate) that catch light
                across a corner rather than down their height. */}
            <LinearGradient id={g.face} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={shade(to, 0.35)} />
            </LinearGradient>
          </Defs>
          {shapeFor(item.art.kind, from, to, g)}
        </>
      }
    />
  );
}

/**
 * The two stops this tile draws with — `item.art` for everything except a FLARE.
 *
 * A flare tile is a preview of the perimeter aura, so it leads with `flare.colour`, which IS the
 * colour the aura paints. Zeus' Wrath is why: its stops run blue -> gold and its aura is golden
 * thunderbolts, but the tile is built dominant-stop-first, so the mythic rendered as a BLUE
 * starburst — the wrong item entirely (COSMETIC_UI_FIXES §4). Leading with the aura's own colour
 * fixes it by construction rather than by special-casing one id, and it can never drift again:
 * change the aura and the tile follows.
 *
 * The trailing stop is whichever of the two the lead is NOT, so Zeus keeps its blue as the faint
 * storm undertone the spec asks for, and Asgardian Valor — blue stops, blue aura — stays blue.
 */
function tilePalette(item: CatalogItem): { from: string; to: string } {
  const lead = item.flare?.colour;
  if (item.art.kind !== 'flare' || !lead) return item.art;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return { from: lead, to: same(lead, item.art.to) ? item.art.from : item.art.to };
}

// ─────────────────────────── the pedestal ───────────────────────────

/**
 * Glow, ground shadow and float — the part of mock 216 that is the same for every type, and for a
 * loot box too (box-art.tsx opts in with `pedestal`).
 *
 * TWO RENDER PATHS, and the split is the reason a full grid stays cheap:
 *
 *   · STILL — one <Svg>. The glow, the shadow and the item are three shapes in a single native
 *     view, which is what a 60-tile inventory gets. Drawing the pedestal as separate layers there
 *     would triple the view count for two shapes that never move.
 *   · FLOATING — three layers, because the art and its shadow have to transform independently
 *     (the shadow tightens and fades as the item rises). Only reachable at hero sizes, where
 *     there is one of these on screen rather than sixty.
 *
 * Callers that draw SVG hand it `inline` and get the cheap path; callers handing a foreign
 * component (RelicArt, BoxArt) pass it as `children` and always layer.
 */
export function ItemPedestal({
  size,
  rarity,
  motion = 'auto',
  inline,
  children,
}: {
  size: number;
  rarity: Rarity;
  motion?: ArtMotion;
  /** SVG nodes, drawn into the pedestal's own <Svg>. */
  inline?: ReactNode;
  /** A whole component with its own <Svg>, layered over the pedestal. */
  children?: ReactNode;
}) {
  const uid = useId();
  const glowId = `itemGlow-${uid}`;
  const reducedMotion = useReducedMotion();
  const floats = motion === 'on' || (motion === 'auto' && size >= FLOAT_MIN_SIZE);
  const active = floats && !reducedMotion;
  useFloatClock(active);

  const w = size;
  const h = Math.round(size * ASPECT);
  const rise = Math.max(2, size * 0.055);

  // Both of these return the SAME KEYS whether or not the icon floats, and gate the VALUE instead.
  // A style whose key set changes between renders is the one thing Reanimated cannot undo: it has
  // no previous value to restore a dropped key to, so an icon that stopped floating mid-life —
  // which is exactly what flipping the OS "reduce motion" switch does — would freeze at whatever
  // offset it happened to be holding. `floatClock.value` is still only READ when active, so an
  // idle icon subscribes to nothing.
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: active ? -rise * floatClock.value : 0 }],
  }));
  // The shadow is the tell. An item that rises over a shadow that does not tighten under it reads
  // as a sticker sliding up the tile rather than as a thing leaving the ground.
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: active ? 1 - 0.36 * floatClock.value : 1,
    transform: [{ scaleX: active ? 1 - 0.18 * floatClock.value : 1 }],
  }));

  const glow = (
    <>
      <Defs>
        <RadialGradient id={glowId} cx="50%" cy="46%" r="52%">
          <Stop offset="0" stopColor={RARITY_COLOR[rarity]} stopOpacity="0.42" />
          <Stop offset="0.55" stopColor={RARITY_COLOR[rarity]} stopOpacity="0.13" />
          <Stop offset="1" stopColor={RARITY_COLOR[rarity]} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="46" r="50" fill={`url(#${glowId})`} />
    </>
  );
  // Two heights, because the two paths hand the pedestal drawings that sit differently in the box.
  // The silhouettes below bottom out around y=84, so their shadow lands at 88. A foreign component
  // — RelicArt's 24-grid, BoxArt's 48-grid — fills its viewBox to the floor, so a shadow at 88
  // would be drawn INSIDE the object instead of under it.
  const groundShadow = <Ellipse cx="50" cy={inline ? 88 : 95} rx="24" ry="5.5" fill="#000000" opacity={0.34} />;

  if (!active && inline) {
    return (
      <View style={{ width: w, height: h }}>
        <Svg width={w} height={h} viewBox={VIEW_BOX}>
          {glow}
          {groundShadow}
          {inline}
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width: w, height: h }}>
      <Svg style={styles.layer} width={w} height={h} viewBox={VIEW_BOX}>
        {glow}
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shadowStyle]}>
        <Svg width={w} height={h} viewBox={VIEW_BOX}>
          {groundShadow}
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.centre, artStyle]}>
        {inline ? (
          <Svg width={w} height={h} viewBox={VIEW_BOX}>
            {inline}
          </Svg>
        ) : (
          children
        )}
      </Animated.View>
    </View>
  );
}

const VIEW_BOX = '0 0 100 100';

/**
 * ONE clock for every floating icon in the app, not one per icon.
 *
 * Reanimated re-evaluates an animated style whenever a shared value it reads changes, so N icons
 * reading one clock costs one driver and N transform commits — where N icons each running their
 * own `withRepeat` would cost N drivers as well. It also makes them float in step, which is what
 * the mock shows (CSS animations declared together start together).
 *
 * The clock is cancelled when the last floating icon unmounts, so an app sitting on a screen with
 * no item art is not paying for a timer.
 */
const floatClock = makeMutable(0);
let floatUsers = 0;

function useFloatClock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    floatUsers += 1;
    if (floatUsers === 1) {
      floatClock.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
    return () => {
      floatUsers -= 1;
      if (floatUsers === 0) {
        cancelAnimation(floatClock);
        floatClock.value = 0;
      }
    };
  }, [active]);
}

// ─────────────────────────── colour ───────────────────────────

/**
 * Gradient ids MUST be unique per mount — react-native-svg leaks duplicate <Defs> ids across
 * instances on Android, which makes every icon after the first render blank. Same fix as
 * ember-icon.tsx: derive them from useId.
 */
function gradientIds(uid: string) {
  return { body: `itemBody-${uid}`, face: `itemFace-${uid}` };
}

type Gradients = ReturnType<typeof gradientIds>;

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 136];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

/** Toward black — the base of the body ramp, which is what gives the silhouette its underside. */
function shade(colour: string, amount: number): string {
  const [r, g, b] = channels(colour);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** Toward white — hot cores and specular edges, kept on the item's own hue rather than flat #fff. */
function tint(colour: string, amount: number): string {
  const [r, g, b] = channels(colour);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

// ─────────────────────────── the silhouettes, one per type ───────────────────────────

function shapeFor(kind: ArtKind, from: string, to: string, g: Gradients) {
  const body = `url(#${g.body})`;
  const face = `url(#${g.face})`;
  const deep = shade(to, 0.55);
  const hot = tint(from, 0.62);

  switch (kind) {
    // FLAME — mock 216's flame: a licking outer body on the ramp, with a hot inner core. The core
    // is the item's own colour lightened rather than a fixed cream, so a blue flame burns blue.
    case 'flame':
      return (
        <>
          <Path
            d="M50 84 C26 72 22 48 36 30 C40 42 48 42 49 32 C50 18 42 12 52 4 C54 22 74 22 75 46 C90 40 86 16 78 8 C96 26 98 58 74 80 C82 66 74 52 64 50 C68 66 62 78 50 84 Z"
            fill={body}
          />
          <Path
            d="M50 78 C40 72 38 58 45 48 C47 55 51 55 51 48 C52 40 47 36 53 28 C55 42 66 42 66 56 C72 52 70 40 66 36 C76 46 76 64 62 76 C66 68 60 60 54 60 C57 68 55 74 50 78 Z"
            fill={hot}
            opacity={0.6}
          />
        </>
      );

    // PARTICLE — no row of its own in 216, drawn in its register: the flame dimmed back to an
    // ember, and the motes it throws off given the same body ramp so they read as beads with a
    // lit side rather than as dots.
    case 'particle':
      return (
        <>
          <Path
            d="M50 80 C32 70 30 52 42 38 C44 48 50 48 50 40 C51 28 45 24 53 16 C55 32 70 32 70 50 C70 66 60 76 50 80 Z"
            fill={body}
            opacity={0.8}
          />
          <G fill={body}>
            <Circle cx="20" cy="30" r="5" />
            <Circle cx="80" cy="38" r="4.4" />
            <Circle cx="14" cy="58" r="3.6" />
            <Circle cx="84" cy="64" r="3.2" />
            <Circle cx="30" cy="14" r="3" />
            <Circle cx="66" cy="12" r="3.6" />
          </G>
          <G fill={hot} opacity={0.75}>
            <Circle cx="18.6" cy="28.4" r="1.7" />
            <Circle cx="78.8" cy="36.6" r="1.5" />
            <Circle cx="65" cy="10.8" r="1.2" />
          </G>
        </>
      );

    // FLARE — 216's starburst: sixteen rays, long/short alternating, over a lit core. The rays are
    // the aura the perimeter overlay paints, read as a burst.
    case 'flare': {
      const rays = [];
      for (let k = 0; k < 16; k += 1) {
        const a = (k * 22.5 * Math.PI) / 180;
        const long = k % 2 === 0;
        const reach = long ? 40 : 32;
        rays.push(
          <Line
            key={k}
            x1={(50 + 18 * Math.cos(a)).toFixed(1)}
            y1={(46 + 18 * Math.sin(a)).toFixed(1)}
            x2={(50 + reach * Math.cos(a)).toFixed(1)}
            y2={(46 + reach * Math.sin(a)).toFixed(1)}
            stroke={from}
            strokeWidth={long ? 4 : 2}
            strokeLinecap="round"
          />
        );
      }
      return (
        <>
          <G opacity={0.9}>{rays}</G>
          <Circle cx="50" cy="46" r="16" fill={body} />
          <Circle cx="45" cy="41" r="5" fill="#ffffff" opacity={0.5} />
        </>
      );
    }

    // CARD — the profile-card backdrop, tilted off-square so it reads as a held plate: the face
    // ramp across the corner, a specular wash down it, and the banded content ghosted on top.
    case 'card':
      return (
        <G transform="rotate(-8 50 46)">
          <Rect x="30" y="14" width="40" height="58" rx="6" fill={face} stroke={from} strokeWidth={1.5} />
          <Rect x="30" y="14" width="40" height="58" rx="6" fill={body} opacity={0.25} />
          <Path d="M34 60 L46 48 L54 56 L66 42" fill="none" stroke="#ffffff" strokeWidth={2} opacity={0.5} />
          <Circle cx="44" cy="30" r="5" fill="#ffffff" opacity={0.6} />
        </G>
      );

    // HALO — the avatar ring. 216 draws a torus (its RING row) and a tilted halo band; in this app
    // they are ONE type, because a HALO here is the ring worn around an avatar. So it is drawn as
    // the torus, with the halo row's back-band kept underneath it: that shaded lower arc is what
    // sells the ring as a circle seen in perspective rather than as a drawn "O".
    case 'halo':
      return (
        <>
          <Ellipse cx="50" cy="52" rx="30" ry="26" fill="none" stroke={deep} strokeWidth={8} opacity={0.75} />
          <Ellipse cx="50" cy="46" rx="30" ry="30" fill="none" stroke={body} strokeWidth={9} />
          <Ellipse cx="50" cy="46" rx="30" ry="30" fill="none" stroke={from} strokeWidth={2} opacity={0.6} />
          <Ellipse cx="50" cy="42" rx="24" ry="20" fill="none" stroke="#ffffff" strokeWidth={2} opacity={0.28} />
        </>
      );

    // TITLE — it is text in the product, so the art is the nameplate it sits on. Sheared rather
    // than square (216's skewY): a flat rectangle is the one shape that cannot read as 2.5D.
    // Written as a matrix because it is the one transform every SVG parser agrees on.
    case 'title':
      return (
        <G transform="matrix(1,-0.07,0,1,0,3)">
          <Rect x="18" y="34" width="64" height="24" rx="6" fill={face} stroke={from} strokeWidth={1.5} />
          <Rect x="18" y="34" width="64" height="10" rx="6" fill="#ffffff" opacity={0.2} />
          <Line x1="27" y1="46" x2="73" y2="46" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.7} />
        </G>
      );

    // BANNER — the campfire header: a hanging pennant with a swallowtail, the face ramp across it
    // and a specular wash over it.
    case 'banner':
      return (
        <>
          <Path d="M32 12 L68 12 L68 74 L50 62 L32 74 Z" fill={face} stroke={from} strokeWidth={1.5} />
          <Path d="M32 12 L68 12 L68 74 L50 62 L32 74 Z" fill={body} opacity={0.2} />
          <Path d="M50 22 L54 34 L66 34 L56 42 L60 54 L50 46 L40 54 L44 42 L34 34 L46 34 Z" fill="#ffffff" opacity={0.5} />
        </>
      );

    // AUDIO — the focus loop: two weighted note heads on a beam, the heads on the body ramp so
    // they read as spheres rather than as discs.
    case 'audio':
      return (
        <>
          <Circle cx="38" cy="62" r="11" fill={body} />
          <Circle cx="66" cy="54" r="11" fill={body} />
          <Path d="M47 62 L47 24 L77 18 L77 54" fill="none" stroke={from} strokeWidth={4} strokeLinecap="round" />
          <Circle cx="34" cy="58" r="3" fill="#ffffff" opacity={0.5} />
        </>
      );

    // SFX — a one-shot sting, drawn as the waveform it is: a flat line spiking once and settling.
    case 'sfx':
      return (
        <>
          <Path
            d="M20 46 L30 46 L36 24 L48 70 L56 32 L62 46 L80 46"
            fill="none"
            stroke={body}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M20 46 L30 46 L36 24 L48 70 L56 32 L62 46 L80 46"
            fill="none"
            stroke={from}
            strokeWidth={1.6}
            strokeLinecap="round"
            opacity={0.5}
          />
        </>
      );

    // RELIC — THE FALLBACK ONLY since relic-art.tsx landed: every relic the catalog actually ships
    // is drawn as itself, and this is what a key granted by a server ahead of this build gets.
    // 216's tablet, which is the right shape for "an artifact whose own drawing is missing".
    case 'relic':
      return (
        <G transform="rotate(-6 50 46)">
          <Rect x="30" y="16" width="40" height="54" rx="4" fill={face} stroke={from} strokeWidth={1.5} />
          <G stroke="#ffffff" strokeWidth={1.6} opacity={0.55} fill="none">
            <Path d="M37 28 L63 28 M37 38 L58 38 M37 48 L63 48 M37 58 L52 58" />
            <Circle cx="55" cy="58" r="5" />
          </G>
          <Circle cx="30" cy="43" r="4" fill={from} />
          <Circle cx="70" cy="43" r="4" fill={from} />
        </G>
      );

    // MEDAL — season-stamped, never re-issued. No row in 216 either; drawn in register as a struck
    // disc on a ribbon, the disc on the body ramp over a darker twin so the rim reads as thickness.
    case 'medal':
      return (
        <>
          <Path d="M34 8 L44 44 L30 46 Z" fill={shade(to, 0.25)} />
          <Path d="M66 8 L70 46 L56 44 Z" fill={face} />
          <Circle cx="50" cy="61" r="25" fill={deep} />
          <Circle cx="50" cy="58" r="25" fill={body} />
          <Circle cx="50" cy="58" r="25" fill="none" stroke={from} strokeWidth={2.5} opacity={0.8} />
          <Path d="M50 43 L55 55 L68 55 L57 63 L61 76 L50 68 L39 76 L43 63 L32 55 L45 55 Z" fill="#ffffff" opacity={0.55} />
        </>
      );

    // Unreachable while ArtKind and this switch agree — but the switch is exhaustive by convention,
    // not by construction, and returning `undefined` into <Svg> from a kind added to the union
    // without a case here would take out whatever grid the item is in. A neutral plate is a far
    // better failure than a blank screen (punchlist 8 §1).
    default:
      return (
        <>
          <Rect x="24" y="22" width="52" height="52" rx="10" fill={body} opacity={0.7} />
          <Circle cx="50" cy="48" r="12" fill={hot} opacity={0.8} />
        </>
      );
  }
}

const styles = StyleSheet.create({
  // The glow sits under everything and is already sized to the frame, so it is pinned rather than
  // stretched: absoluteFill's right/bottom would fight the <Svg>'s own width/height.
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
