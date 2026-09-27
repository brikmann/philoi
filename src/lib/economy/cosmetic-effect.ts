import type { CatalogItem, ItemType } from '@/lib/economy/catalog';
import { SEAL_COSMETIC_KEY } from '@/lib/economy/seal-owners';

// What a cosmetic DOES once you own it: the one line a detail sheet shows under the lore.
//
// Keyed by TYPE, never by item, so a new flare or banner explains itself the day it lands in
// catalog.ts. Each line describes where the app actually draws that slot (ITEM_CATALOG's section
// blurbs, FLARES_SPEC): a flare is the aura on your avatar and the frame of a lock-in, not a
// screen-wide overlay, and promising more than the renderer paints is a refund request.
const EFFECT_BY_TYPE: Record<ItemType, string> = {
  FLAME: 'Recolours the flame that burns while you’re locked in.',
  PARTICLE: 'Sparks thrown off your flame for the whole lock-in.',
  FLARE: 'An aura around your profile wherever it shows — and a glowing frame on every lock-in.',
  CARD: 'The backdrop of your profile card, wherever your card is seen.',
  HALO: 'A ring of light around your avatar, on every board you’re on.',
  TITLE: 'Sits under your name on the leaderboards and your profile.',
  BANNER: 'Flies behind your name — the header art over the campfires you run.',
  AUDIO: 'An ambient loop that plays under your lock-ins.',
  SFX: 'A sound you equip on a lock-in — the sting it starts or ends on.',
  RELIC: 'A showcase piece for your vault. Shown, never worn.',
  MEDAL: 'A season-stamped medal for your vault, never re-issued.',
};

/**
 * The effect line for one item. The Seal is the one MEDAL that leaves the vault — <SealBadge>
 * pins it after its owner's name app-wide — so it reads off the same key the badge gates on
 * rather than off a name.
 */
export function cosmeticEffect(item: Pick<CatalogItem, 'id' | 'type'>): string {
  if (item.id === SEAL_COSMETIC_KEY) return 'Burns beside your name forever — everywhere your name appears.';
  return EFFECT_BY_TYPE[item.type];
}
