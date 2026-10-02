import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { CardBackdropArt, cardLookForItem } from '@/components/economy/card-art';
import { HaloFrame } from '@/components/economy/halo-art';
import { Colors, Radius } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { getItem } from '@/lib/economy/catalog';
import type { CatalogItem } from '@/lib/economy/catalog';
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

// The card family lives in card-art.tsx; re-exported so existing importers keep working.
export { CardScene, cardLookFor, cardLookForItem, type CardLook } from '@/components/economy/card-art';

/**
 * Applied cosmetics animate on a single avatar or card, and hold still where the caller says so —
 * a list that already runs one live thing per row, or anything captured to an image. `still`
 * renders the same art frozen, never a reduced version of it.
 */
export type AppliedMotion = 'full' | 'still';

// ───────────────────────────── CARD ─────────────────────────────

/**
 * The profile-card backdrop, drawn as the equipped card's scene (card-art.tsx, mock 241).
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
  // Archetype first (the family), id second (the look within it), Hearth for anything unknown.
  const look = cardLookForItem(item);
  const boost = auraBoost(auraTier);

  // MEASURED width/height, never a style-only <Svg>. An <Svg> with no numeric size inside an
  // absolutely-positioned parent measures as ZERO on Android, so every equipped card used to paint
  // nothing but its 1px border; campfire-banner-art.tsx carries a comment about the identical trap.
  //
  // One layout pass is the cost. `backgroundColor: from` covers that first frame (and any device
  // where the Svg still fails), so the card is a colour for a moment rather than a hole.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  return (
    <View
      style={[styles.cardWrap, { borderRadius: radius, borderColor: to, backgroundColor: from }]}
      onLayout={onLayout}>
      {size.w > 0 && size.h > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <CardBackdropArt
            look={look}
            from={from}
            to={to}
            width={size.w}
            height={size.h}
            boost={boost.opacity}
            motion={motion}
            uid={uid}
          />
        </View>
      )}
      {children}
    </View>
  );
}

// ───────────────────────────── HALO ─────────────────────────────
//
// The halo renderers live in halo-art.tsx (mock 242: motion per archetype). This region keeps the
// worn entry point, because it is the one that knows about aura tiers and the default loadout.

export { HALO_REACH, HaloRing, haloStyleFor, haloStyleForItem, type HaloPart, type HaloStyle } from '@/components/economy/halo-art';

/**
 * The ring around an avatar, drawn from the equipped halo's art.
 *
 * `children` is the avatar itself, centred inside. The ring is drawn OUTSIDE the avatar's bounds
 * (the box is larger than `size`), so a halo never crops the face it surrounds.
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
  /** `still` freezes the halo — list surfaces that already run their own motion per row. */
  motion?: AppliedMotion;
  children: ReactNode;
}) {
  const item = resolveOr(haloId, 'halo-base-ring');
  const boost = auraBoost(auraTier);
  return (
    <HaloFrame item={item} size={size} boost={boost.opacity} spread={boost.spread} motion={motion}>
      {children}
    </HaloFrame>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    overflow: 'hidden',
    borderWidth: 1,
  },
});
