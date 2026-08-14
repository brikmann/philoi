// Rarity is the spine of the whole reward economy: it picks the colour, the salvage payout, the
// direct-buy price, and the aura tint on every piece of item art. Source: ITEM_CATALOG.md
// ("Rarity colours") + REWARD_ECONOMY.md §8.1/§8.3/§8.4.
//
// These are DISPLAY values only. Every ember amount the user actually gains or spends is decided
// server-side (economy_config, migration 0064) — REWARD_ECONOMY §0.4 forbids client reward math.
// What's here is what the screens render so prices/odds can be shown without a round-trip; the
// server re-derives its own numbers and is the one that wins.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

// §8.1's table gives Mythic as #FF4D4D, but ITEM_CATALOG.md's "Rarity colours" line and every
// mock (56/57/58/59/60/67) use #FF6B6B. ITEM_CATALOG is the declared single source of truth for
// items, and matching the mocks is what keeps the art from drifting, so #FF6B6B wins.
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a7fa6',
  uncommon: '#3DA85C',
  rare: '#4FB0E5',
  epic: '#a06cd5',
  legendary: '#F5C542',
  mythic: '#FF6B6B',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
  mythic: 'MYTHIC',
};

export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

// §8.3 — salvage descends 50% (Common) → 25% (Mythic), 5% per tier, taken against the price of
// the box that yields that rarity. The descent is deliberate: a Mythic returning only 25% is what
// stops big pulls from flooding embers and undercutting paid packs (§5 / 21e guardrail).
export const SALVAGE_PCT: Record<Rarity, number> = {
  common: 50,
  uncommon: 45,
  rare: 40,
  epic: 35,
  legendary: 30,
  mythic: 25,
};

export const SALVAGE_EMBERS: Record<Rarity, number> = {
  common: 40,
  uncommon: 90,
  rare: 200,
  epic: 420,
  legendary: 900,
  mythic: 2000,
};

// §8.4 — a guaranteed item must cost MORE than the box that gambles for it, and must sit well
// above its own salvage value or you could buy→sell for profit. The spec names Uncommon 300 ·
// Rare 600 · Epic 1,500 · Legendary 4,000; Common and Mythic aren't given, so they're
// extrapolated on the same curve (~1.2-2.5x the source box, always > salvage). Server config is
// authoritative — see economy_config('direct_buy_price') in migration 0064.
export const DIRECT_BUY_PRICE: Record<Rarity, number> = {
  common: 150,
  uncommon: 300,
  rare: 600,
  epic: 1500,
  legendary: 4000,
  mythic: 10000,
};

/** Rarity aura fill for item art + hero glows — the "aura = rarity" construct from mocks 58/61. */
export function rarityGlow(rarity: Rarity, opacity = 0.6): string {
  const hex = RARITY_COLOR[rarity];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/** "a 7.2% pull" — the odds-as-a-flex line on the share card (§8.5 / mock 60). */
export function formatOddsFlex(pct: number): string {
  const trimmed = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return `a ${trimmed}% pull`;
}
