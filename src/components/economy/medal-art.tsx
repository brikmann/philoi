import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { useCosmeticClock } from '@/components/economy/cosmetic-clock';
import { FLAME_MIRROR_TRANSFORM, FLAME_PATH } from '@/components/ui/flame-logo';
import { useMotionActive } from '@/hooks/use-motion-active';
import type { CatalogItem, MedalArchetype, PlacementMetal } from '@/lib/economy/catalog';
import { shade, tint } from '@/lib/economy/colour';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MEDAL ART — mock 246's struck medallions.
//
// Every medal used to be the same disc in a different colour. Mock 246 makes each one a STRUCK
// PIECE: a beveled metal disc (radial ramp + rim + inner shadow), a ring of bead-studs in the
// medal's own metal, a ribbon, a gloss, and an engraved emblem per archetype. On top of that the
// rarity adds a flourish (laurel / aura / crown), and the placement ladder adds its numeral, star
// finial and gems.
//
// REGISTER. Drawn into item-art's 0–100 viewBox like every other silhouette: centred on x = 50,
// bottoming out at y ≈ 82 so the pedestal's ground shadow at 88 lands under it. Everything is
// authored in the mock's own 104px disc box (disc centre 52,52, r 52) and mapped onto the 0–100
// frame by one transform (DISC_BOX) — so the mock's coordinates are pasted, not re-derived, and
// the drawing cannot drift from the spec by arithmetic.
//
// THE MEDAL DOES NOT BOB. The pedestal's float (item-art) is the only motion an item gets in a
// grid; the medal itself is static SVG. The one live layer is the sweeping gloss, and only at
// hero size, via `MedalGlossOverlay` — a single Animated.View on a shared cosmetic clock, so
// nothing here re-renders React per frame (campfire-banner-art's four rules). Reduce motion, an
// unfocused screen, or a tile: the gloss holds a still frame.
//
// FLAMES ARE ALWAYS THE CINDY FLAME — FLAME_PATH under FLAME_MIRROR_TRANSFORM, the one flip
// (flame-logo.tsx). Never mirror it again here.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Below this the medal is drawn for a tile: emblem enlarged, fewer/larger beads, sparser laurel. */
const COMPACT_BELOW = 56;

/** Maps the mock's 104px disc box onto item-art's 0–100 frame: disc centre (50, 54), r ≈ 28. */
const DISC_SCALE = 56 / 104;
const DISC_BOX = `translate(22 26) scale(${DISC_SCALE})`;
/** The disc in 0–100 units — the gloss overlay clips to exactly this. */
const DISC = { cx: 50, cy: 54, r: 28 };

// ─────────────────────────── metals ───────────────────────────

type Metal = { m1: string; m2: string; rim: string; rib: string };

/** Mock 246's `M` table, verbatim. Placement medals key by `item.metal`; the six by archetype. */
const PLACEMENT_METALS: Record<PlacementMetal, Metal> = {
  bronze: { m1: '#703f1d', m2: '#d58a3c', rim: '#f0b36a', rib: '#4a2a13' },
  silver: { m1: '#8f96a2', m2: '#e9edf3', rim: '#ffffff', rib: '#595f68' },
  gold: { m1: '#a9761a', m2: '#ffdf7a', rim: '#fff3c0', rib: '#6a4a12' },
  platinum: { m1: '#6f86ad', m2: '#eaf2ff', rim: '#cfe0ff', rib: '#4a5878' },
  diamond: { m1: '#9ccfe0', m2: '#ffffff', rim: '#ffffff', rib: '#7fb0c6' },
};

const ARCHETYPE_METALS: Partial<Record<MedalArchetype, Metal>> = {
  logo: { m1: '#cdb98d', m2: '#fff9ea', rim: '#fffdf5', rib: '#7a2d1a' }, // cream
  crown: { m1: '#a9761a', m2: '#fff0b8', rim: '#fff6d8', rib: '#6a4a12' }, // sovereign
  shield: { m1: '#2f7d46', m2: '#9fe6b4', rim: '#d8ffe2', rib: '#1f4d2c' }, // unbroken
  seal: { m1: '#B23410', m2: '#FF9A3C', rim: '#FFC877', rib: '#6e2409' },
  centurion: { m1: '#6a2a18', m2: '#ffd24d', rim: '#ffe08a', rib: '#4a1d10' },
  ashmark: { m1: '#4e4e57', m2: '#9a9aa4', rim: '#c7c7cf', rib: '#33333a' }, // ash
};

const KNOWN_ARCHETYPES: ReadonlySet<string> = new Set<MedalArchetype>([
  'logo',
  'crown',
  'shield',
  'seal',
  'centurion',
  'ashmark',
  'placement-pct',
  'placement-podium',
]);

function isPlacementMetal(m: unknown): m is PlacementMetal {
  return typeof m === 'string' && m in PLACEMENT_METALS;
}

/**
 * The metal this medal is struck in. An unknown archetype or metal (a server ahead of this build)
 * falls back to the item's own two stops, so it still reads as ITS medal rather than as bronze.
 */
function metalFor(archetype: MedalArchetype | null, metal: unknown, from: string, to: string): Metal {
  if (isPlacementMetal(metal)) return PLACEMENT_METALS[metal];
  const own = archetype ? ARCHETYPE_METALS[archetype] : undefined;
  if (own) return own;
  return { m1: from, m2: tint(to, 0.5), rim: tint(to, 0.75), rib: shade(from, 0.45) };
}

function archetypeOf(item: CatalogItem): MedalArchetype | null {
  const a = item.archetype;
  return typeof a === 'string' && KNOWN_ARCHETYPES.has(a) ? (a as MedalArchetype) : null;
}

// ─────────────────────────── rank numerals ───────────────────────────

const PCT_BY_METAL: Record<PlacementMetal, number> = { bronze: 50, silver: 25, gold: 10, platinum: 5, diamond: 1 };
const PODIUM_BY_METAL: Partial<Record<PlacementMetal, number>> = { gold: 1, silver: 2, bronze: 3 };

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/**
 * The numeral struck on a placement medal. The catalog carries no rank field — the rank lives in
 * the id (`medal-s1-top-50`, `medal-s1-podium-3`), so it is parsed from there, falling back to the
 * metal ladder (the metal IS the rank) for an id shaped some other way.
 */
export function medalRankLabel(item: CatalogItem): string | null {
  const a = archetypeOf(item);
  if (a === 'placement-pct') {
    const m = /top-(\d+)$/.exec(item.id);
    const n = m ? Number(m[1]) : isPlacementMetal(item.metal) ? PCT_BY_METAL[item.metal] : null;
    return n ? `${n}%` : null;
  }
  if (a === 'placement-podium') {
    const m = /podium-(\d+)$/.exec(item.id);
    const n = m ? Number(m[1]) : isPlacementMetal(item.metal) ? PODIUM_BY_METAL[item.metal] : undefined;
    return n ? ordinal(n) : null;
  }
  return null;
}

/** "S1" for the Ashmark — read off the id when it carries a season, else Season 1 (Emberfall). */
function seasonLabel(item: CatalogItem): string {
  const m = /-s(\d+)(?:-|$)/.exec(item.id);
  return `S${m ? m[1] : '1'}`;
}

// ─────────────────────────── the medal ───────────────────────────

export type MedalShapeProps = {
  item: CatalogItem;
  /** The item's two stops — only used when the archetype/metal is unknown to this build. */
  from: string;
  to: string;
  /** useId() from the caller, so gradient ids are unique per mount (Android Defs leak). */
  uid: string;
  /** Rendered px width of the 0–100 frame. Below 56 the tile cut is drawn. Omit for hero. */
  size?: number;
  /**
   * True when a `MedalGlossOverlay` is mounted over this drawing — the static gloss band is then
   * left out so there are not two. Pass exactly when the overlay is passed.
   */
  liveGloss?: boolean;
};

/** SVG nodes (no <Svg> wrapper) for a medal, in item-art's 0–100 viewBox. */
export function MedalShape({ item, from, to, uid, size, liveGloss = false }: MedalShapeProps): ReactNode {
  const archetype = archetypeOf(item);
  const metal = metalFor(archetype, item.metal, from, to);
  const compact = size !== undefined && size < COMPACT_BELOW;
  const ids = {
    disc: `medalDisc-${uid}`,
    hi: `medalHi-${uid}`,
    lo: `medalLo-${uid}`,
    clip: `medalClip-${uid}`,
    gloss: `medalGloss-${uid}`,
    rib: `medalRib-${uid}`,
    flame: `medalFlame-${uid}`,
    aura: `medalAura-${uid}`,
    gem: `medalGem-${uid}`,
    ember: `medalEmber-${uid}`,
  };

  const mythic = item.rarity === 'mythic';
  const legendaryPlus = mythic || item.rarity === 'legendary';
  const placement = archetype === 'placement-pct' || archetype === 'placement-podium';
  const podium = archetype === 'placement-podium';
  const rank = medalRankLabel(item);
  const first = podium && rank === '1st';

  // Flourishes. Laurel: every legendary+ and every placement medal (mock 246 rows A+B). Aura: mythic,
  // and the two legendaries the mock lights (Champion, Sovereign). Crown finial: a mythic that has
  // no star of its own. Star: the podium. Gems: Top 5% / Top 1% and 1st.
  const laurel = legendaryPlus || placement;
  const aura = mythic || archetype === 'logo' || archetype === 'crown';
  const crown = mythic && !podium;
  const star = podium;
  const gems = first || (archetype === 'placement-pct' && (item.metal === 'platinum' || item.metal === 'diamond'));
  const flameRibbon = archetype === 'logo';

  return (
    <G transform={DISC_BOX}>
      <Defs>
        <RadialGradient id={ids.disc} cx="38%" cy="30%" r="72%" fx="38%" fy="30%">
          <Stop offset="0" stopColor={metal.m2} />
          <Stop offset="0.5" stopColor={metal.m1} />
          <Stop offset="1" stopColor={shade(metal.m1, 0.62)} />
        </RadialGradient>
        {/* The inner bevel: light catching the top lip, shadow pooling in the bottom. */}
        <LinearGradient id={ids.hi} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <Stop offset="0.28" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={ids.lo} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.62" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.45" />
        </LinearGradient>
        <LinearGradient id={ids.gloss} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={ids.rib} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
          <Stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0.25" />
        </LinearGradient>
        <LinearGradient id={ids.flame} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#E0612C" />
          <Stop offset="0.55" stopColor="#FF9A2C" />
          <Stop offset="1" stopColor="#FFE9A8" />
        </LinearGradient>
        <RadialGradient id={ids.aura} cx="50%" cy="50%" r="50%">
          <Stop offset="0.5" stopColor="#FFA03C" stopOpacity="0.4" />
          <Stop offset="1" stopColor="#FFA03C" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={ids.gem} cx="35%" cy="30%" r="70%" fx="35%" fy="30%">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.58" stopColor="#cdebff" />
          <Stop offset="1" stopColor="#7fb6d8" />
        </RadialGradient>
        <RadialGradient id={ids.ember} cx="50%" cy="76%" r="65%">
          <Stop offset="0" stopColor="#FFE9A8" />
          <Stop offset="0.6" stopColor="#FF8A2C" />
          <Stop offset="1" stopColor="#E0612C" />
        </RadialGradient>
        <ClipPath id={ids.clip}>
          <Circle cx={52} cy={52} r={52} />
        </ClipPath>
      </Defs>

      {aura ? <Circle cx={52} cy={52} r={84} fill={`url(#${ids.aura})`} /> : null}

      <Ribbon metal={metal} sheenId={ids.rib} flameId={ids.flame} flame={flameRibbon} diamonds={first} />

      {laurel ? <Laurel rim={metal.rim} compact={compact} /> : null}

      {/* The disc: a drop shadow, the struck edge (a darker twin, so the rim reads as thickness),
          then the face on its radial ramp. */}
      <Circle cx={52} cy={58} r={52} fill="#000000" opacity={0.4} />
      <Circle cx={52} cy={55.5} r={52} fill={shade(metal.m1, 0.5)} />
      <Circle cx={52} cy={52} r={52} fill={`url(#${ids.disc})`} />
      <Circle cx={52} cy={52} r={52} fill={`url(#${ids.hi})`} />
      <Circle cx={52} cy={52} r={52} fill={`url(#${ids.lo})`} />
      {/* The rim: a bright lip and a dark channel inside it (mock's inset 4px rim + 7px shadow). */}
      <Circle cx={52} cy={52} r={50} fill="none" stroke={metal.rim} strokeWidth={compact ? 5 : 4} />
      <Circle cx={52} cy={52} r={46.5} fill="none" stroke="#000000" strokeOpacity={0.32} strokeWidth={3} />

      <Beads rim={metal.rim} compact={compact} />

      <G transform={compact ? 'translate(52 52) scale(1.14) translate(-52 -52)' : undefined}>
        <Emblem item={item} archetype={archetype} rim={metal.rim} rank={rank} compact={compact} flameId={ids.flame} emberId={ids.ember} />
      </G>

      {/* The still gloss: one diagonal band across the upper-left, clipped to the face. Omitted
          when the live overlay sweeps it instead. */}
      {liveGloss ? null : (
        <G clipPath={`url(#${ids.clip})`}>
          <Rect x={4} y={-40} width={36} height={190} fill={`url(#${ids.gloss})`} transform="rotate(18 22 52)" />
        </G>
      )}

      {gems ? <Gems gemId={ids.gem} /> : null}
      {crown ? <CrownFinial rim={metal.rim} /> : null}
      {star ? <StarFinial rim={metal.rim} /> : null}
    </G>
  );
}

// ─────────────────────────── parts (all in the 104 disc box) ───────────────────────────

const TAIL = 'M0 0 L26 0 L26 60 L13 49 L0 60 Z';
/** The Champion's flaming lanyard — the tail ends in three tongues instead of a notch. */
const FLAME_TAIL = 'M0 0 L26 0 L26 43 L18.7 60 L13 47 L7.3 60 L0 43 Z';

function Ribbon({ metal, sheenId, flameId, flame, diamonds }: { metal: Metal; sheenId: string; flameId: string; flame: boolean; diamonds: boolean }) {
  const d = flame ? FLAME_TAIL : TAIL;
  const fill = flame ? `url(#${flameId})` : metal.rib;
  const tail = (x: number, deg: number) => (
    <G transform={`rotate(${deg} ${x + 13} -41) translate(${x} -41)`}>
      <Path d={d} fill={fill} />
      <Path d={d} fill={`url(#${sheenId})`} />
    </G>
  );
  return (
    <>
      {tail(22, 16)}
      {tail(56, -16)}
      {diamonds ? (
        <G>
          {RIBBON_DIAMONDS.map(([x, y]) => (
            <Rect
              key={`${x}-${y}`}
              x={x - 3.5}
              y={y - 3.5}
              width={7}
              height={7}
              fill="#e6f5ff"
              stroke="#ffffff"
              strokeWidth={1}
              transform={`rotate(45 ${x} ${y})`}
            />
          ))}
        </G>
      ) : null}
    </>
  );
}

/** Mock 246's `.ribdia` positions, mapped into the disc box. */
const RIBBON_DIAMONDS: readonly (readonly [number, number])[] = [
  [33.5, -28.5],
  [35.5, -10.5],
  [70.5, -28.5],
  [68.5, -10.5],
];

/** The bead ring: studs struck just inside the rim, in the medal's OWN metal (no blue glint). */
function Beads({ rim, compact }: { rim: string; compact: boolean }) {
  const n = compact ? 16 : 28;
  const R = 42;
  const out: ReactNode[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const x = 52 + Math.cos(a) * R;
    const y = 52 + Math.sin(a) * R;
    out.push(<Circle key={`d${i}`} cx={x} cy={y + 0.7} r={compact ? 3 : 2} fill="#000000" opacity={0.32} />);
    out.push(<Circle key={`l${i}`} cx={x} cy={y - 0.4} r={compact ? 2.3 : 1.5} fill={rim} opacity={0.6} />);
  }
  return <>{out}</>;
}

/** Laurel branches hugging the disc's lower half — deterministic arc, no randomness. */
function Laurel({ rim, compact }: { rim: string; compact: boolean }) {
  const n = compact ? 4 : 6;
  const R = 60;
  const leaves: ReactNode[] = [];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      // From just off the bottom (side * 18° from straight down) up to the shoulder (side * 118°).
      const deg = 90 + side * (18 + t * 100);
      const a = (deg * Math.PI) / 180;
      const x = 52 + Math.cos(a) * R;
      const y = 52 + Math.sin(a) * R;
      // Tangent to the arc, tipped outward so the leaves fan like a wreath.
      const rot = deg + 90 + side * 28;
      const rx = compact ? 10 : 8.5;
      const ry = compact ? 4.4 : 3.6;
      leaves.push(
        <G key={`${side}-${i}`} transform={`rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}>
          <Ellipse cx={x} cy={y + 1} rx={rx} ry={ry} fill="#000000" opacity={0.35} />
          <Ellipse cx={x} cy={y} rx={rx} ry={ry} fill={rim} opacity={0.92} />
        </G>
      );
    }
  }
  return <>{leaves}</>;
}

/** A medal's mythic crown finial, seated on the disc's top edge over the ribbon knot. */
function CrownFinial({ rim }: { rim: string }) {
  return (
    <G transform="translate(29 -28)">
      <Path d="M3 28 L3 8 L13 18 L23 2 L33 18 L43 8 L43 28 Z" fill={rim} stroke="#000000" strokeOpacity={0.4} strokeWidth={1} />
      <Circle cx={3} cy={6} r={2.6} fill={rim} />
      <Circle cx={23} cy={0.5} r={3} fill={rim} />
      <Circle cx={43} cy={6} r={2.6} fill={rim} />
    </G>
  );
}

/** The podium's star finial. */
function StarFinial({ rim }: { rim: string }) {
  return (
    <G transform="translate(37 -24)">
      <Path
        d="M15 1 L18.9 10.5 L29 11.2 L21.2 17.8 L23.8 28 L15 22.3 L6.2 28 L8.8 17.8 L1 11.2 L11.1 10.5 Z"
        fill={rim}
        stroke="#000000"
        strokeOpacity={0.4}
        strokeWidth={1}
      />
    </G>
  );
}

/** Mock 246's three gems: the two shoulders and the ribbon knot. */
function Gems({ gemId }: { gemId: string }) {
  return (
    <>
      {GEMS.map(([x, y]) => (
        <G key={`${x}-${y}`}>
          <Circle cx={x} cy={y} r={7} fill="#bfe6ff" opacity={0.3} />
          <Circle cx={x} cy={y} r={4.6} fill={`url(#${gemId})`} stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.8} />
        </G>
      ))}
    </>
  );
}

const GEMS: readonly (readonly [number, number])[] = [
  [6, 4],
  [98, 4],
  [52, -34],
];

// ─────────────────────────── emblems ───────────────────────────

const DARK = 0.42;
const LIGHT = 0.5;

/** The Cindy flame engraved into the face: a rim-coloured top lip under a dark struck fill. */
function EngravedFlame({ scale, dy, rim }: { scale: number; dy: number; rim: string }) {
  const off = (104 - 24 * scale) / 2;
  return (
    <G transform={`translate(${off} ${off + dy}) scale(${scale})`}>
      <G transform={FLAME_MIRROR_TRANSFORM}>
        <Path d={FLAME_PATH} fill={rim} opacity={LIGHT} transform="translate(0 -0.5)" />
        <Path d={FLAME_PATH} fill="#000000" opacity={DARK} />
      </G>
    </G>
  );
}

/** Struck text: dark engraving with the rim catching the bottom edge. */
function StruckText({ text, y, fontSize, rim }: { text: string; y: number; fontSize: number; rim: string }) {
  const common = { x: 52, textAnchor: 'middle' as const, fontSize, fontWeight: '800' as const };
  return (
    <>
      <SvgText {...common} y={y + 1.3} fill={rim} opacity={LIGHT}>
        {text}
      </SvgText>
      <SvgText {...common} y={y} fill="#000000" opacity={0.44}>
        {text}
      </SvgText>
    </>
  );
}

function Emblem({
  item,
  archetype,
  rim,
  rank,
  compact,
  flameId,
  emberId,
}: {
  item: CatalogItem;
  archetype: MedalArchetype | null;
  rim: string;
  rank: string | null;
  compact: boolean;
  flameId: string;
  emberId: string;
}) {
  switch (archetype) {
    // THE Cindy flame, in brand ember colour — the Champion's logo, not engraved but enamelled.
    case 'logo': {
      const sc = 2.8;
      const off = (104 - 24 * sc) / 2;
      return (
        <G transform={`translate(${off} ${off}) scale(${sc})`}>
          <G transform={FLAME_MIRROR_TRANSFORM}>
            <Path d={FLAME_PATH} fill={`url(#${flameId})`} stroke="#78320a" strokeOpacity={0.35} strokeWidth={0.5} />
          </G>
        </G>
      );
    }

    case 'crown': {
      const d = 'M-26 8 L-26 -14 L-13 0 L0 -20 L13 0 L26 -14 L26 8 Z';
      return (
        <G transform="translate(52 54)">
          <Path d={d} fill={rim} opacity={LIGHT} transform="translate(0 -1.4)" />
          <G fill="#000000" opacity={DARK}>
            <Path d={d} />
            <Circle cx={-26} cy={-16} r={3.4} />
            <Circle cx={0} cy={-23} r={3.6} />
            <Circle cx={26} cy={-16} r={3.4} />
          </G>
        </G>
      );
    }

    case 'shield': {
      const d = 'M-22 0 L-22 -14 L22 -14 L22 0 C22 24 0 40 0 44 C0 40 -22 24 -22 0 Z';
      return (
        <G transform="translate(52 52) scale(0.92)">
          <Path d={d} fill={rim} opacity={LIGHT} transform="translate(0 -16.4)" />
          <Path d={d} fill="#000000" opacity={DARK} transform="translate(0 -15)" />
          <Path d="M0 -26 L0 24" stroke={rim} strokeWidth={2} opacity={0.4} />
          <Path d="M-22 -18 L22 -18" stroke="#000000" strokeOpacity={0.4} strokeWidth={2} />
        </G>
      );
    }

    // The Emberfall Seal: the flame, with a live ember heart burning at its belly (held still).
    case 'seal':
      return (
        <>
          <EngravedFlame scale={2.3} dy={0} rim={rim} />
          <Circle cx={52} cy={58} r={9} fill="#ff7a1e" opacity={0.35} />
          <Path d="M52 50 C56 50 58.5 55 58.5 59 C58.5 63 55.5 66 52 66 C48.5 66 45.5 63 45.5 59 C45.5 55 48 50 52 50 Z" fill={`url(#${emberId})`} />
        </>
      );

    case 'centurion':
      return <StruckText text="C" y={63} fontSize={compact ? 40 : 34} rim={rim} />;

    case 'ashmark':
      return (
        <>
          <EngravedFlame scale={2.0} dy={-9} rim={rim} />
          <StruckText text={seasonLabel(item)} y={84} fontSize={13} rim={rim} />
        </>
      );

    case 'placement-pct':
      return rank ? <StruckText text={rank} y={60} fontSize={compact ? 27 : 22} rim={rim} /> : <GenericEmblem rim={rim} />;

    // The podium: the Philoi flame with its rank struck beneath.
    case 'placement-podium':
      return (
        <>
          <EngravedFlame scale={2.0} dy={-10} rim={rim} />
          {rank ? <StruckText text={rank} y={82} fontSize={compact ? 17 : 14} rim={rim} /> : null}
        </>
      );

    // Unknown to this build — the clean struck star, item-art's old `case 'medal'` emblem.
    default:
      return <GenericEmblem rim={rim} />;
  }
}

function GenericEmblem({ rim }: { rim: string }) {
  // The fallback star, re-centred onto (52,52) and scaled to the 104 box.
  const d = 'M0 -30 L9.3 -12.9 L33.1 -12.9 L14.3 1.5 L22 25.5 L0 11.3 L-22 25.5 L-14.3 1.5 L-33.1 -12.9 L-9.3 -12.9 Z';
  return (
    <G transform="translate(52 54)">
      <Path d={d} fill={rim} opacity={LIGHT} transform="translate(0 -1.4)" />
      <Path d={d} fill="#000000" opacity={DARK} />
    </G>
  );
}

// ─────────────────────────── the live gloss (hero only) ───────────────────────────

const GLOSS_CYCLE_MS = 3600;

/**
 * The sweeping gloss, as ONE Animated.View translating a static band across the disc on the shared
 * 3.6s cosmetic clock. Pass as ItemPedestal's `overlay` (it is laid on the pedestal's w×w square)
 * at hero size only, and set `liveGloss` on MedalShape at the same time.
 *
 * Reduce motion or an unfocused screen: the band holds a still frame (the same diagonal the static
 * drawing uses), and the clock is not even subscribed.
 */
export function MedalGlossOverlay({ size }: { size: number }) {
  const reduced = useReducedMotion();
  const focused = useMotionActive();
  const active = !reduced && focused;
  const k = size / 100;
  const d = DISC.r * 2 * k;
  const frame = {
    left: (DISC.cx - DISC.r) * k,
    top: (DISC.cy - DISC.r) * k,
    width: d,
    height: d,
    borderRadius: d / 2,
  };
  return (
    <View pointerEvents="none" style={[styles.clip, frame]}>
      {active ? <SweepingBand d={d} /> : <Band d={d} x={0.06 * d} />}
    </View>
  );
}

function SweepingBand({ d }: { d: number }) {
  const clock = useCosmeticClock(GLOSS_CYCLE_MS, true);
  // Mock 246: sweep across in the first 55% of the cycle, ease-in-out, then rest off the disc.
  const style = useAnimatedStyle(() => {
    const t = clock.value;
    const p = t < 0.55 ? t / 0.55 : 1;
    const e = p * p * (3 - 2 * p);
    return { transform: [{ translateX: (-0.75 + 2.1 * e) * d }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Band d={d} x={0} />
    </Animated.View>
  );
}

/** The gloss band itself — static SVG, rotated 18° like the mock's. */
function Band({ d, x }: { d: number; x: number }) {
  const uid = useId();
  const id = `medalSweep-${uid}`;
  const w = d * 0.6;
  const h = d * 1.8;
  return (
    <View style={[styles.band, { left: x, top: -0.4 * d, width: w, height: h }]}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    transform: [{ rotate: '18deg' }],
  },
});
