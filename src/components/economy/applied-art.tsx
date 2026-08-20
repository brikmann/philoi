import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Colors, Radius } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import type { CatalogItem } from '@/lib/economy/catalog';

// §2 — cosmetics rendered as ACTUAL ART, applied to the surface.
//
// THE BUG THIS FIXES: the profile card was `backgroundColor: card.art.from` and the halo was two
// bordered circles. Every card looked like a rectangle of colour and every halo like a ring of
// colour, so Cracked Magma and Carbon Fiber — an Epic and a Rare, with completely different
// promised looks — differed only in hue. There was nothing to want.
//
// DISTINCT FROM item-art.tsx, deliberately. That file draws a THUMBNAIL of an item for an
// inventory tile: a little picture *of* a card. This draws the cosmetic APPLIED — the texture
// filling your actual profile card, the ring around your actual avatar. Same catalog entry, two
// jobs, and collapsing them would mean the inventory tile and the profile could never diverge in
// scale or detail.
//
// The two-stop `art: {from, to}` in the catalog stays the single source of colour. What is added
// here is TEXTURE, keyed by item id — because the spec names specific looks ("Cracked Magma =
// magma cracks over a molten gradient; Golden Anvil = brushed gold") and a shared gradient cannot
// express that.

/** How a card's surface is drawn. Colour still comes from the catalog's two stops. */
type CardTexture = 'plain' | 'brushed' | 'weave' | 'mesh' | 'cracks' | 'grid' | 'plated';

/** How a halo's ring is drawn. */
type HaloStyle = 'ring' | 'double' | 'glow' | 'prism' | 'flare' | 'aura' | 'crown';

// Keyed by id rather than rarity: two Epics (Cracked Magma, Plasma Grid) are meant to look nothing
// alike, and rarity would give them the same treatment. Anything unmapped falls to 'plain', which
// is the base Hearth look — never a bare colour.
const CARD_TEXTURE: Record<string, CardTexture> = {
  'card-base-hearth': 'plain',
  'card-forged-bronze': 'plated',
  'card-brushed-steel': 'brushed',
  'card-carbon-fiber': 'weave',
  'card-obsidian-mesh': 'mesh',
  'card-cracked-magma': 'cracks',
  'card-plasma-grid': 'grid',
  'card-golden-anvil': 'brushed',
  'card-emberfall': 'cracks',
  'card-emberfall-mythic': 'plated',
  'card-emberfall-sovereign': 'plated',
};

const HALO_STYLE: Record<string, HaloStyle> = {
  'halo-base-ring': 'ring',
  'halo-copper-ring': 'ring',
  'halo-ember-halo': 'double',
  'halo-glowing-amber': 'glow',
  'halo-diamond-prism': 'prism',
  'halo-inferno-flare': 'flare',
  'halo-hades': 'aura',
  'halo-emberfall': 'glow',
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

// ───────────────────────────── CARD ─────────────────────────────

/**
 * The profile-card backdrop, drawn as the equipped skin's texture.
 *
 * Renders the art absolutely behind `children`, so a caller keeps whatever layout it already had —
 * this replaces a background colour, not a container.
 */
export function EquippedCardBackdrop({
  cardId,
  auraTier = 0,
  radius = Radius.card,
  children,
}: {
  cardId?: string;
  auraTier?: AuraTier;
  radius?: number;
  children: ReactNode;
}) {
  const item = resolveOr(cardId, 'card-base-hearth');
  const uid = useId();
  const gradId = `cardGrad-${uid}`;
  const from = item?.art.from ?? Colors.card;
  const to = item?.art.to ?? Colors.disabled;
  const texture = CARD_TEXTURE[item?.id ?? ''] ?? 'plain';
  const boost = auraBoost(auraTier);

  return (
    <View style={[styles.cardWrap, { borderRadius: radius, borderColor: to }]}>
      <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          {/* Diagonal, not vertical: a card is wider than it is tall, and a vertical ramp on a
              short wide box reads as two stacked bands rather than as a finish. */}
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} stopOpacity={0.55} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${gradId})`} />
        <CardTextureLayer texture={texture} to={to} boost={boost.opacity} />
      </Svg>
      {children}
    </View>
  );
}

function CardTextureLayer({ texture, to, boost }: { texture: CardTexture; to: string; boost: number }) {
  // Every texture is drawn in the item's OWN second stop, so a skin is recoloured rather than
  // overlaid with a fixed grey — the same rule the flame ramp follows.
  const o = (base: number) => Math.min(1, base + boost);

  switch (texture) {
    // Brushed metal — fine parallel striations.
    case 'brushed':
      return (
        <G stroke={to} strokeWidth={0.4} opacity={o(0.18)}>
          {Array.from({ length: 14 }, (_, i) => (
            <Path key={i} d={`M0 ${i * 7.5} L100 ${i * 7.5 - 6}`} />
          ))}
        </G>
      );

    // Carbon weave — a tight basket cross-hatch.
    case 'weave':
      return (
        <G stroke={to} strokeWidth={0.5} opacity={o(0.16)}>
          {Array.from({ length: 12 }, (_, i) => (
            <Path key={`a${i}`} d={`M${i * 9 - 20} 0 L${i * 9 + 20} 100`} />
          ))}
          {Array.from({ length: 12 }, (_, i) => (
            <Path key={`b${i}`} d={`M${i * 9 + 20} 0 L${i * 9 - 20} 100`} />
          ))}
        </G>
      );

    // Obsidian mesh — a coarser, glassier lattice with nodes.
    case 'mesh':
      return (
        <G opacity={o(0.2)}>
          <G stroke={to} strokeWidth={0.6}>
            {Array.from({ length: 7 }, (_, i) => (
              <Path key={`h${i}`} d={`M0 ${i * 16} L100 ${i * 16}`} />
            ))}
            {Array.from({ length: 7 }, (_, i) => (
              <Path key={`v${i}`} d={`M${i * 16} 0 L${i * 16} 100`} />
            ))}
          </G>
        </G>
      );

    // Cracked Magma — irregular fissures with the hot stop showing through. The spec's headline
    // example, so it gets real branching rather than a regular pattern.
    case 'cracks':
      return (
        <G stroke={to} strokeLinecap="round" opacity={o(0.55)}>
          <Path d="M-2 34 L18 30 L30 40 L48 33 L66 42 L84 34 L102 40" strokeWidth={1.1} fill="none" />
          <Path d="M30 40 L26 62 L36 78 L30 100" strokeWidth={0.8} fill="none" />
          <Path d="M66 42 L74 60 L66 74 L72 100" strokeWidth={0.8} fill="none" />
          <Path d="M48 33 L46 14 L54 0" strokeWidth={0.7} fill="none" />
          <Path d="M18 30 L10 14 L14 0" strokeWidth={0.6} fill="none" opacity={0.8} />
          <Path d="M84 34 L92 20" strokeWidth={0.6} fill="none" opacity={0.8} />
        </G>
      );

    // Plasma Grid — a contained lattice, brighter at the intersections.
    case 'grid':
      return (
        <G opacity={o(0.28)}>
          <G stroke={to} strokeWidth={0.5}>
            {Array.from({ length: 9 }, (_, i) => (
              <Path key={`h${i}`} d={`M0 ${i * 12.5} L100 ${i * 12.5}`} />
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <Path key={`v${i}`} d={`M${i * 12.5} 0 L${i * 12.5} 100`} />
            ))}
          </G>
          {Array.from({ length: 5 }, (_, i) => (
            <Circle key={i} cx={12.5 + i * 25} cy={12.5 + (i % 3) * 37.5} r={1.6} fill={to} />
          ))}
        </G>
      );

    // Forged / plated — overlapping struck plates.
    case 'plated':
      return (
        <G fill={to} opacity={o(0.14)}>
          <Path d="M0 0 L100 0 L100 22 L0 30 Z" />
          <Path d="M0 46 L100 38 L100 60 L0 68 Z" />
          <Path d="M0 84 L100 76 L100 100 L0 100 Z" />
        </G>
      );

    // The base Hearth card: the gradient alone, with a soft warm bloom so it still reads as art.
    case 'plain':
    default:
      return <Circle cx="18" cy="86" r="46" fill={to} opacity={o(0.1)} />;
  }
}

// ───────────────────────────── HALO ─────────────────────────────

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
  children,
}: {
  haloId?: string;
  size: number;
  auraTier?: AuraTier;
  children: ReactNode;
}) {
  const item = resolveOr(haloId, 'halo-base-ring');
  const from = item?.art.from ?? Colors.ember;
  const to = item?.art.to ?? Colors.amber;
  const style = HALO_STYLE[item?.id ?? ''] ?? 'ring';
  const boost = auraBoost(auraTier);

  // The ring needs room to sit outside the avatar; the box is 34% larger, plus whatever the aura
  // tier adds. A mythic aura mid-session is the widest this ever gets.
  const pad = size * 0.17 + boost.spread * 2;
  const box = size + pad * 2;

  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <HaloRing style={style} from={from} to={to} boost={boost.opacity} />
      </Svg>
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

function HaloRing({ style, from, to, boost }: { style: HaloStyle; from: string; to: string; boost: number }) {
  const o = (base: number) => Math.min(1, base + boost);
  // 42 leaves the avatar (radius ~36 in this box) clear with the ring just outside it.
  const R = 42;

  switch (style) {
    case 'double':
      return (
        <>
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={4} opacity={o(0.9)} />
          <Circle cx="50" cy="50" r={R - 5} fill="none" stroke={to} strokeWidth={2} opacity={o(0.75)} />
        </>
      );

    case 'glow':
      return (
        <>
          <Circle cx="50" cy="50" r={R + 4} fill="none" stroke={to} strokeWidth={7} opacity={o(0.16)} />
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={4} opacity={o(0.95)} />
          <Circle cx="50" cy="50" r={R - 3} fill="none" stroke={to} strokeWidth={1.5} opacity={o(0.6)} />
        </>
      );

    // Diamond Prism — faceted segments rather than a continuous ring.
    case 'prism':
      return (
        <>
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={3} opacity={o(0.6)} />
          <G stroke={to} strokeWidth={4} strokeLinecap="round" opacity={o(0.95)}>
            {Array.from({ length: 8 }, (_, i) => {
              const a0 = (i * Math.PI * 2) / 8 + 0.12;
              const a1 = a0 + 0.52;
              return (
                <Path
                  key={i}
                  d={`M${50 + R * Math.cos(a0)} ${50 + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${50 + R * Math.cos(a1)} ${50 + R * Math.sin(a1)}`}
                  fill="none"
                />
              );
            })}
          </G>
        </>
      );

    // Inferno Flare — the spec's named example: a ring of fire, tongues licking outward.
    case 'flare':
      return (
        <>
          <Circle cx="50" cy="50" r={R + 5} fill="none" stroke={to} strokeWidth={8} opacity={o(0.14)} />
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={4} opacity={o(0.95)} />
          <G fill={to} opacity={o(0.85)}>
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i * Math.PI * 2) / 12;
              const inner = R + 1;
              const outer = R + (i % 2 === 0 ? 8 : 5);
              const spread = 0.11;
              return (
                <Path
                  key={i}
                  d={`M${50 + inner * Math.cos(a - spread)} ${50 + inner * Math.sin(a - spread)}
                      L${50 + outer * Math.cos(a)} ${50 + outer * Math.sin(a)}
                      L${50 + inner * Math.cos(a + spread)} ${50 + inner * Math.sin(a + spread)} Z`}
                />
              );
            })}
          </G>
        </>
      );

    // Hades Halo — the mythic: a wide chaotic aura rather than a defined ring.
    case 'aura':
      return (
        <>
          <Circle cx="50" cy="50" r={R + 7} fill={to} opacity={o(0.1)} />
          <Circle cx="50" cy="50" r={R + 3} fill="none" stroke={to} strokeWidth={9} opacity={o(0.16)} />
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={4.5} opacity={o(0.95)} />
          <G stroke={to} strokeWidth={2} strokeLinecap="round" opacity={o(0.7)}>
            {Array.from({ length: 6 }, (_, i) => {
              const a = (i * Math.PI * 2) / 6 + 0.3;
              return (
                <Path
                  key={i}
                  d={`M${50 + (R - 2) * Math.cos(a)} ${50 + (R - 2) * Math.sin(a)} L${50 + (R + 9) * Math.cos(a + 0.22)} ${50 + (R + 9) * Math.sin(a + 0.22)}`}
                  fill="none"
                />
              );
            })}
          </G>
        </>
      );

    // Emberfall Crown — points at the top rather than all the way round.
    case 'crown':
      return (
        <>
          <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={4} opacity={o(0.95)} />
          <G fill={to} opacity={o(0.9)}>
            {[-0.9, -0.55, -0.2].map((offset, i) => {
              const a = -Math.PI / 2 + offset;
              return (
                <Path
                  key={i}
                  d={`M${50 + R * Math.cos(a - 0.1)} ${50 + R * Math.sin(a - 0.1)}
                      L${50 + (R + 9) * Math.cos(a)} ${50 + (R + 9) * Math.sin(a)}
                      L${50 + R * Math.cos(a + 0.1)} ${50 + R * Math.sin(a + 0.1)} Z`}
                />
              );
            })}
            {[0.2, 0.55, 0.9].map((offset, i) => {
              const a = -Math.PI / 2 + offset;
              return (
                <Path
                  key={`r${i}`}
                  d={`M${50 + R * Math.cos(a - 0.1)} ${50 + R * Math.sin(a - 0.1)}
                      L${50 + (R + 9) * Math.cos(a)} ${50 + (R + 9) * Math.sin(a)}
                      L${50 + R * Math.cos(a + 0.1)} ${50 + R * Math.sin(a + 0.1)} Z`}
                />
              );
            })}
          </G>
        </>
      );

    case 'ring':
    default:
      return <Circle cx="50" cy="50" r={R} fill="none" stroke={from} strokeWidth={3.5} opacity={o(0.9)} />;
  }
}

const styles = StyleSheet.create({
  cardWrap: {
    overflow: 'hidden',
    borderWidth: 1,
  },
});
