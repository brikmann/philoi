// THE cosmetic catalog (21f). ITEM_CATALOG.md is the declared single source of truth for every
// name, rarity, and line of lore — this file is that document transcribed into data, nothing more.
// Screens never hardcode an item; they read from here. When ITEM_CATALOG.md changes, change this.
//
// Fair-play Rule 0: cosmetics + prestige ONLY. Nothing in this catalog touches XP, rank, streaks,
// or standing. The `acquisition` field is what enforces §8.4's "prestige must be earned" line —
// only `box` items are ever direct-buyable.

import type { Rarity } from '@/lib/economy/rarity';

/** The 11 type tags shown as `RARITY · TYPE` in menus and on cards (ITEM_CATALOG "Type tags"). */
export const ITEM_TYPES = [
  'FLAME',
  'PARTICLE',
  'FLARE',
  'CARD',
  'HALO',
  'TITLE',
  'BANNER',
  'AUDIO',
  'SFX',
  'RELIC',
  'MEDAL',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * One active per slot (21f). Relics + Medals have no slot — they're showcase-only.
 *
 * SFX has TWO slots (PUNCHLIST_13): the sting a lock-in starts on and the one it ends on. The same
 * item is allowed in both — "play the same thing twice" is a legitimate choice, and it's what the
 * single old `sfx` slot backfills into.
 */
export type EquipSlot =
  | 'flame'
  | 'particle'
  | 'flare'
  | 'card'
  | 'halo'
  | 'title'
  | 'banner'
  | 'audio'
  | 'sfx_start'
  | 'sfx_stop';

/** The two slots an SFX cosmetic can occupy — the pair the equip UI offers as Start / End / Both. */
export const SFX_SLOTS = ['sfx_start', 'sfx_stop'] as const;
export type SfxSlot = (typeof SFX_SLOTS)[number];

export function isSfxSlot(slot: EquipSlot | null | undefined): slot is SfxSlot {
  return slot === 'sfx_start' || slot === 'sfx_stop';
}

/**
 * The slot an item type auto-assigns to. SFX is deliberately `null` (PUNCHLIST_13): with two
 * slots to choose between there is no single right answer, so an SFX item carries no slot of its
 * own and the user picks on equip. Every screen therefore has to treat `type === 'SFX'` as
 * equippable-without-a-slot rather than as showcase-only — `showcaseOnly` is the flag for that,
 * not a null slot.
 */
export const SLOT_FOR_TYPE: Record<ItemType, EquipSlot | null> = {
  FLAME: 'flame',
  PARTICLE: 'particle',
  FLARE: 'flare',
  CARD: 'card',
  HALO: 'halo',
  TITLE: 'title',
  BANNER: 'banner',
  AUDIO: 'audio',
  SFX: null,
  RELIC: null,
  MEDAL: null,
};

/**
 * How an item can enter your inventory.
 * - `box` — in the loot-box drop pool, and therefore also direct-buyable (§8.4).
 * - `earned` — season/placement titles, medals, relics. NEVER in a box, NEVER purchasable.
 * - `forge-pass-S1` — the Emberfall set. Premium-track only, never re-issued (FORGE_PASS.md).
 * - `default` — the starter loadout every account is seeded with (#88). Never in a box, never
 *   purchasable, and never sellable: they are the floor a slot falls back to, so letting one be
 *   salvaged would leave a slot that can never be filled again without a support ticket.
 */
export type Acquisition = 'box' | 'earned' | 'forge-pass-S1' | 'default';

/** Which vector family draws this item — see components/economy/item-art.tsx. */
export type ArtKind = 'flame' | 'particle' | 'flare' | 'card' | 'halo' | 'title' | 'banner' | 'audio' | 'sfx' | 'relic' | 'medal';

/**
 * A flare's signature perimeter effect (FLARES_SPEC.md). One of seven motion layers that
 * FlarePerimeter selects between — the whole visual vocabulary of the aura system.
 *
 * `emberfall` is the only bespoke one: lava pooling on the bottom edge WITH embers raining from
 * the top. It exists for exactly one item (the season's Forge Pass capstone), which is the point —
 * the capstone should not share a motion layer with a box drop.
 */
/**
 * `hammer` is Asgardian Valor's, and it had to be split off `zaps` rather than reusing it with a
 * blue colour. Mock 167 gives the two lightning flares opposite motion, not one motion in two
 * palettes: Zeus strikes at RANDOM points across the screen out of a storm-cloud bank, while
 * Asgard's bolts fall the full height top-to-bottom — fewer, thicker — and each one lands with a
 * ragged shrapnel burst at the floor. Sharing an effect meant the two mythics were the same
 * animation, which is the one thing a distinct drop must never be.
 */
export type FlareEffect =
  | 'smoke'
  | 'zaps'
  | 'hammer'
  | 'falling'
  | 'flames'
  | 'plasma'
  | 'glow'
  | 'emberfall';

export type CatalogItem = {
  id: string;
  name: string;
  type: ItemType;
  rarity: Rarity;
  lore: string;
  acquisition: Acquisition;
  slot: EquipSlot | null;
  art: { kind: ArtKind; from: string; to: string };
  /**
   * FLARE items only — the perimeter colour and signature effect the app-wide overlay is driven
   * by. Separate from `art`, which is the inventory-tile vector: the tile needs a two-stop gradient
   * to read at 44px, the perimeter needs ONE colour it can glow the whole screen edge with, and
   * collapsing them made the aura either muddy or invisible.
   */
  flare?: { colour: string; effect: FlareEffect };
  /** Season-stamped earn-only titles render as `Last Flame Standing · S1` (ITEM_CATALOG §2c). */
  seasonStamped?: boolean;
  /** Global #1's "Ascended · Global" — the only animated title, one person per season (21j). */
  oneOfOne?: boolean;
  /** Shown instead of an Equip button on showcase-only items. */
  showcaseOnly?: boolean;
};

/** Types with nowhere to be worn — they live in the vault and are shown, not equipped. */
const SHOWCASE_TYPES: ReadonlySet<ItemType> = new Set<ItemType>(['RELIC', 'MEDAL']);

function item(i: Omit<CatalogItem, 'slot' | 'showcaseOnly'>): CatalogItem {
  // showcaseOnly is keyed off the TYPE, not off `slot === null`. Since PUNCHLIST_13 those two came
  // apart: an SFX has no fixed slot (the user picks Start, End or both on equip) but is very much
  // equippable, and deriving the flag from a null slot would have quietly turned all four stings
  // into un-equippable display pieces.
  return { ...i, slot: SLOT_FOR_TYPE[i.type], showcaseOnly: SHOWCASE_TYPES.has(i.type) };
}

// ───────────────────────────── 1 · Goal-typed flame styles ─────────────────────────────
// §4 HARD CONSTRAINT: a flame cosmetic recolours the COLOUR RAMP ONLY — never size, intensity, or
// animation, which are the signals that carry real activity. The two-stop palette below IS the
// whole item; the flame's state logic is untouched by which one is equipped.

const FLAMES: CatalogItem[] = [
  item({ id: 'flame-molten-copper', name: 'Molten Copper', type: 'FLAME', rarity: 'rare', acquisition: 'box',
    lore: 'The first colour ever pulled from the forge — warm, patient, unhurried.',
    art: { kind: 'flame', from: '#B8651F', to: '#F2A33C' } }),
  item({ id: 'flame-lime-volt', name: 'Lime Volt', type: 'FLAME', rarity: 'rare', acquisition: 'box',
    lore: 'A flame that hums. Stare too long and your teeth start to buzz.',
    art: { kind: 'flame', from: '#5A8A00', to: '#D4FF4D' } }),
  item({ id: 'flame-electric-cyan', name: 'Electric Cyan', type: 'FLAME', rarity: 'rare', acquisition: 'box',
    lore: 'Cold at the edges, colder at the core. It burns like deep water.',
    art: { kind: 'flame', from: '#0E7490', to: '#7BE0FF' } }),
  item({ id: 'flame-toxic-green', name: 'Toxic Green', type: 'FLAME', rarity: 'epic', acquisition: 'box',
    lore: 'Something died to make this colour. It has not finished dying.',
    art: { kind: 'flame', from: '#2E7D32', to: '#9DFF5A' } }),
  item({ id: 'flame-solar-flare', name: 'Solar Flare', type: 'FLAME', rarity: 'epic', acquisition: 'box',
    lore: "A sliver of the sun's surface, kept barely leashed inside your screen.",
    art: { kind: 'flame', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'flame-cosmic-purple', name: 'Cosmic Purple', type: 'FLAME', rarity: 'legendary', acquisition: 'box',
    lore: 'Lit once at the birth of a star and never allowed to go out.',
    art: { kind: 'flame', from: '#6A2AB8', to: '#C77BFF' } }),
  item({ id: 'flame-neutron-starfire', name: 'Neutron Starfire', type: 'FLAME', rarity: 'legendary', acquisition: 'box',
    lore: 'Pure energy in the palm of your hand.',
    art: { kind: 'flame', from: '#BFD0FF', to: '#FFFFFF' } }),
  item({ id: 'flame-stormforge', name: 'Stormforge', type: 'FLAME', rarity: 'mythic', acquisition: 'box',
    lore: 'The heat of this flame forged Stormbuster.',
    art: { kind: 'flame', from: '#2A5AE0', to: '#BFD6FF' } }),
];

const PARTICLES: CatalogItem[] = [
  item({ id: 'particle-floating-sparks', name: 'Floating Sparks', type: 'PARTICLE', rarity: 'epic', acquisition: 'box',
    lore: 'Embers that refuse to fall. They rise, looking for more to burn.',
    art: { kind: 'particle', from: '#E0612C', to: '#FFD27A' } }),
  item({ id: 'particle-falling-ash', name: 'Falling Ash', type: 'PARTICLE', rarity: 'epic', acquisition: 'box',
    lore: 'The quiet snow of everything the fire has already eaten.',
    art: { kind: 'particle', from: '#6a6480', to: '#d8cae8' } }),
  item({ id: 'particle-ember-swarm', name: 'Ember Swarm', type: 'PARTICLE', rarity: 'epic', acquisition: 'box',
    lore: "Not sparks. A swarm — and it hunts in the direction you're working.",
    art: { kind: 'particle', from: '#8A2B00', to: '#FF9A3C' } }),
  item({ id: 'particle-solar-flares', name: 'Solar Flares', type: 'PARTICLE', rarity: 'legendary', acquisition: 'box',
    lore: 'Arcs of starfire loop off the flame and snap back, screaming.',
    art: { kind: 'particle', from: '#F5C542', to: '#FFF0B8' } }),
  item({ id: 'particle-lightning-tendrils', name: 'Lightning Tendrils', type: 'PARTICLE', rarity: 'legendary', acquisition: 'box',
    lore: 'The fire grew fingers of white electricity. They reach for the edges.',
    art: { kind: 'particle', from: '#7BE0FF', to: '#FFFFFF' } }),
  item({ id: 'particle-void-smoke', name: 'Void Smoke', type: 'PARTICLE', rarity: 'mythic', acquisition: 'box',
    lore: 'A funeral veil of smoke coils upward, heavy with the silence of the tomb.',
    art: { kind: 'particle', from: '#1a1626', to: '#6A2AB8' } }),
];

// Flares — the lock-in perimeter aura (FLARES_SPEC.md, mock 88).
//
// A flare is the ONLY thing that paints the perimeter, and there is deliberately no free or base
// one: the aura IS the flex, and a starter version would spend the whole reward on day one. That
// rule is why `flare-base-glow` is absent from the starter set in DEFAULTS below.
//
// SCOPE (punchlist 15.2, reversing #86): it paints the LOCK-IN SCREEN while a session runs, not
// every screen in the app. App-wide was shipped and read as a permanent tint over the product
// rather than as a cosmetic. The flex still travels off-screen with the session — the iOS Live
// Activity / Dynamic Island frame and the Android notification accent take the flare colour.
//
// Rarity here is by PIZZAZZ, which is what a cosmetic tier actually means: a glow is epic,
// particles are legendary, and the brand-signature auras (lightning, inferno, the season capstone)
// are mythic.
//
// `flare: { colour, effect }` is the item's identity, not decoration: FlarePerimeter is one
// parameterized overlay and these two fields are its entire input.
const FLARES: CatalogItem[] = [
  item({ id: 'flare-zeus-wrath', name: "Zeus' Wrath", type: 'FLARE', rarity: 'mythic', acquisition: 'box',
    lore: 'The heavens split and the fury of Olympus answers to you now.',
    art: { kind: 'flare', from: '#2A5AE0', to: '#FFE87A' },
    // Cream-gold rather than white (punchlist 15.3): a white zap on a dark screen reads as a
    // rendering glitch, the same strike in gold reads as lightning.
    flare: { colour: '#FFE87A', effect: 'zaps' } }),
  item({ id: 'flare-void-purple-aura', name: 'Void Smoke', type: 'FLARE', rarity: 'legendary', acquisition: 'box',
    lore: 'The edges of the world go soft and violet, as if reality is deciding whether to hold.',
    art: { kind: 'flare', from: '#4a2a6e', to: '#C77BFF' },
    flare: { colour: '#7B3FBF', effect: 'smoke' } }),
  item({ id: 'flare-void-plasma', name: 'Void Plasma Flare', type: 'FLARE', rarity: 'legendary', acquisition: 'box',
    lore: 'Pulsing with unholy energy, each spark burns with the power of a thousand suns.',
    art: { kind: 'flare', from: '#A200FF', to: '#FF6B6B' },
    flare: { colour: '#A200FF', effect: 'plasma' } }),
  item({ id: 'flare-white-incandescence', name: 'White Incandescence', type: 'FLARE', rarity: 'epic', acquisition: 'box',
    lore: 'No colour left. Only the pure, blinding fact of the burn.',
    art: { kind: 'flare', from: '#E7DDF5', to: '#FFFFFF' },
    flare: { colour: '#F4EEFF', effect: 'glow' } }),
  // The four FLARES_SPEC names the table but the catalog never carried.
  //
  // Two of them were RENAMED in punchlist 15.3 because they collided with FLAME cosmetic names and
  // one cosmetic family should never borrow another's word: 'flare-stormforge' ("Stormforge") is
  // now Asgardian Valor, and 'flare-toxic' ("Toxic") is now the Acid Rain Flare. The IDS changed
  // with the names — see the migration note in FLARES_SPEC.md before shipping this to a build where
  // anyone already owns one.
  item({ id: 'flare-asgardian-valor', name: 'Asgardian Valor', type: 'FLARE', rarity: 'legendary', acquisition: 'box',
    lore: 'Every strike of the hammer answers a strike from the sky.',
    art: { kind: 'flare', from: '#1B4FD8', to: '#8FD4FF' },
    flare: { colour: '#2E7BFF', effect: 'hammer' } }),
  item({ id: 'flare-acid-rain', name: 'Acid Rain Flare', type: 'FLARE', rarity: 'legendary', acquisition: 'box',
    lore: 'It drips. Whatever it lands on stops being a problem.',
    art: { kind: 'flare', from: '#2E7D32', to: '#9DFF5A' },
    flare: { colour: '#6FE22A', effect: 'falling' } }),
  item({ id: 'flare-inferno', name: 'Inferno Flare', type: 'FLARE', rarity: 'mythic', acquisition: 'box',
    lore: 'The edges of your screen catch, and nothing puts them out.',
    art: { kind: 'flare', from: '#B01A0E', to: '#FF7A3C' },
    flare: { colour: '#FF3D1F', effect: 'flames' } }),
  item({ id: 'flare-solar', name: 'Solar Flare', type: 'FLARE', rarity: 'epic', acquisition: 'box',
    lore: 'A loop of the sun tears free and hangs there, deciding.',
    art: { kind: 'flare', from: '#E0952C', to: '#FFF0B0' },
    flare: { colour: '#FFC02E', effect: 'glow' } }),
];

// ───────────────────────────── 2 · Profile cards & UI identity ─────────────────────────────

const CARDS: CatalogItem[] = [
  item({ id: 'card-forged-bronze', name: 'Forged Bronze', type: 'CARD', rarity: 'uncommon', acquisition: 'box',
    lore: 'Beaten flat by a hundred honest mornings.',
    art: { kind: 'card', from: '#7a5636', to: '#c9a06a' } }),
  item({ id: 'card-brushed-steel', name: 'Brushed Steel', type: 'CARD', rarity: 'uncommon', acquisition: 'box',
    lore: 'Cold, plain, and completely unbothered by your excuses.',
    art: { kind: 'card', from: '#4a4460', to: '#c2dcea' } }),
  item({ id: 'card-carbon-fiber', name: 'Carbon Fiber', type: 'CARD', rarity: 'rare', acquisition: 'box',
    lore: 'Light as a promise, twice as hard to break.',
    art: { kind: 'card', from: '#14121A', to: '#4a4460' } }),
  item({ id: 'card-obsidian-mesh', name: 'Obsidian Mesh', type: 'CARD', rarity: 'rare', acquisition: 'box',
    lore: 'Volcanic glass, woven by someone with far too much patience.',
    art: { kind: 'card', from: '#0F0D14', to: '#3a3550' } }),
  item({ id: 'card-cracked-magma', name: 'Cracked Magma', type: 'CARD', rarity: 'epic', acquisition: 'box',
    lore: "Cooled on the surface. Move it wrong and you'll see it's still molten underneath.",
    art: { kind: 'card', from: '#1a1010', to: '#E0612C' } }),
  item({ id: 'card-plasma-grid', name: 'Plasma Grid', type: 'CARD', rarity: 'epic', acquisition: 'box',
    lore: 'A lattice of contained lightning, humming just below the picture.',
    art: { kind: 'card', from: '#20182f', to: '#7BE0FF' } }),
  item({ id: 'card-golden-anvil', name: 'Golden Anvil', type: 'CARD', rarity: 'legendary', acquisition: 'box',
    lore: 'Struck ten thousand times and never once dented. Neither were you.',
    art: { kind: 'card', from: '#7a5300', to: '#F5C542' } }),
];

const HALOS: CatalogItem[] = [
  item({ id: 'halo-copper-ring', name: 'Copper Ring', type: 'HALO', rarity: 'uncommon', acquisition: 'box',
    lore: 'A thin band of warmth. The first mark that you showed up.',
    art: { kind: 'halo', from: '#B8651F', to: '#F2A33C' } }),
  item({ id: 'halo-ember-halo', name: 'Ember Halo', type: 'HALO', rarity: 'uncommon', acquisition: 'box',
    lore: 'A slow orbit of coals that never quite goes cold.',
    art: { kind: 'halo', from: '#E0612C', to: '#FFD27A' } }),
  item({ id: 'halo-glowing-amber', name: 'Glowing Amber Halo', type: 'HALO', rarity: 'rare', acquisition: 'box',
    lore: 'Frozen honey-light, still holding the heat of the day it was earned.',
    art: { kind: 'halo', from: '#F2A33C', to: '#FFE9B8' } }),
  item({ id: 'halo-diamond-prism', name: 'Diamond Prism Border', type: 'HALO', rarity: 'epic', acquisition: 'box',
    lore: 'Bends every colour it’s given and returns none of them.',
    art: { kind: 'halo', from: '#7be0ff', to: '#ff9ad2' } }),
  item({ id: 'halo-inferno-flare', name: 'Inferno Flare', type: 'HALO', rarity: 'legendary', acquisition: 'box',
    lore: 'Nothing says you did it like a ring of fire around you.',
    art: { kind: 'halo', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'halo-hades', name: 'Hades Halo', type: 'HALO', rarity: 'mythic', acquisition: 'box',
    lore: 'Pure, chaotic energy pulses through his aura. The souls he collected are still screaming for mercy.',
    art: { kind: 'halo', from: '#1a0c0e', to: '#FF2A2A' } }),
];

// Titles that drop from boxes (the wry/grounded set + the pop-culture set).
const TITLES_BOX: CatalogItem[] = [
  item({ id: 'title-kindled', name: '"Kindled"', type: 'TITLE', rarity: 'common', acquisition: 'box',
    lore: "The spark caught. That's all it takes to start.", art: { kind: 'title', from: '#8a7fa6', to: '#d8cae8' } }),
  item({ id: 'title-ember-stoker', name: '"Ember Stoker"', type: 'TITLE', rarity: 'common', acquisition: 'box',
    lore: "Keeps the small fire alive on the nights no one's looking.", art: { kind: 'title', from: '#8a7fa6', to: '#FFD27A' } }),
  item({ id: 'title-night-owl', name: '"Night Owl"', type: 'TITLE', rarity: 'common', acquisition: 'box',
    lore: 'Does the work in the hours the world forgot to guard.', art: { kind: 'title', from: '#3A2E5C', to: '#A99CBD' } }),
  item({ id: 'title-locked-in', name: '"Locked In"', type: 'TITLE', rarity: 'common', acquisition: 'box',
    lore: "Phone face-down, door shut. Don't bother knocking.", art: { kind: 'title', from: '#8a7fa6', to: '#FFF6EC' } }),
  item({ id: 'title-pacesetter', name: '"Pacesetter"', type: 'TITLE', rarity: 'uncommon', acquisition: 'box',
    lore: 'The one everyone else is secretly trying to catch.', art: { kind: 'title', from: '#3DA85C', to: '#9DFF5A' } }),
  item({ id: 'title-built-different', name: '"Built Different"', type: 'TITLE', rarity: 'uncommon', acquisition: 'box',
    lore: 'Same 24 hours as everyone else. Uses them like nobody else.', art: { kind: 'title', from: '#3DA85C', to: '#D4FF4D' } }),
  item({ id: 'title-ash-walker', name: '"Ash-Walker"', type: 'TITLE', rarity: 'rare', acquisition: 'box',
    lore: "Has burned down and rebuilt more times than they'll admit.", art: { kind: 'title', from: '#4FB0E5', to: '#d8cae8' } }),
  item({ id: 'title-iron-forged', name: '"Iron-Forged"', type: 'TITLE', rarity: 'rare', acquisition: 'box',
    lore: 'Shaped by heat and hammer. Cannot be talked out of it now.', art: { kind: 'title', from: '#4FB0E5', to: '#c2dcea' } }),
  item({ id: 'title-main-character', name: '"Main Character"', type: 'TITLE', rarity: 'rare', acquisition: 'box',
    lore: "The story's about them now. Everyone else is just in it.", art: { kind: 'title', from: '#4FB0E5', to: '#FFE9B8' } }),
  item({ id: 'title-cracked', name: '"Cracked"', type: 'TITLE', rarity: 'rare', acquisition: 'box',
    lore: "Unreasonably good at this. It's almost rude.", art: { kind: 'title', from: '#4FB0E5', to: '#7BE0FF' } }),
  item({ id: 'title-villain-arc', name: '"Villain Arc"', type: 'TITLE', rarity: 'rare', acquisition: 'box',
    lore: "Got tired of losing quietly. Now everyone's about to find out.", art: { kind: 'title', from: '#4a2a6e', to: '#C77BFF' } }),
  item({ id: 'title-unbroken', name: '"Unbroken"', type: 'TITLE', rarity: 'epic', acquisition: 'box',
    lore: 'The streak that outlived every reason to quit.', art: { kind: 'title', from: '#a06cd5', to: '#e7ddf5' } }),
  item({ id: 'title-the-relentless', name: '"The Relentless"', type: 'TITLE', rarity: 'epic', acquisition: 'box',
    lore: "Rest is a rumour they've chosen not to believe.", art: { kind: 'title', from: '#a06cd5', to: '#FF9A3C' } }),
  item({ id: 'title-final-boss', name: '"Final Boss"', type: 'TITLE', rarity: 'epic', acquisition: 'box',
    lore: 'The name at the top of the ladder that nobody wants to fight.', art: { kind: 'title', from: '#a06cd5', to: '#FF6B6B' } }),
  item({ id: 'title-the-goat', name: '"The GOAT"', type: 'TITLE', rarity: 'epic', acquisition: 'box',
    lore: 'Greatest of all time, and unbearably aware of it.', art: { kind: 'title', from: '#a06cd5', to: '#F5C542' } }),
];

// End-of-season + placement titles — EARN-ONLY (21j). Never in a box, never purchasable, and
// season-stamped so `Ascended · S1` can never be confused with next season's.
const TITLES_EARNED: CatalogItem[] = [
  item({ id: 'title-last-flame-standing', name: '"Last Flame Standing"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: "When every other fire went out, yours didn't.", art: { kind: 'title', from: '#a06cd5', to: '#FFD24D' } }),
  item({ id: 'title-season-mvp', name: '"Season MVP"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Carried the whole arena on your back for ninety days.', art: { kind: 'title', from: '#a06cd5', to: '#F5C542' } }),
  item({ id: 'title-the-undefeated', name: '"The Undefeated"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'A whole season of challenges, and not one beat you.', art: { kind: 'title', from: '#a06cd5', to: '#7BE0FF' } }),
  item({ id: 'title-forged-in-emberfall', name: '"Forged in Emberfall"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: "You didn't survive the season. The season made you.", art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'title-ninety-day-siege', name: '"Ninety-Day Siege"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Ninety days. No surrender, no dead mornings.', art: { kind: 'title', from: '#a06cd5', to: '#c2dcea' } }),
  item({ id: 'title-ash-sovereign', name: '"Ash Sovereign"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Ruled the arena as the season burned down to ash.', art: { kind: 'title', from: '#4a2a6e', to: '#d8cae8' } }),

  // By final placement (ITEM_CATALOG §2c "By final placement"). Rarity escalates with the pool —
  // a 6-person campfire #1 is not a god, so the god-tier names start at My Uni (21j).
  item({ id: 'title-ascended', name: '"Ascended"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true,
    lore: 'You didn’t win the season — you transcended it. The arena has a new god.', art: { kind: 'title', from: '#FF6B6B', to: '#FFF0B8' } }),
  item({ id: 'title-ascended-global', name: '"Ascended · Global"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true, oneOfOne: true,
    lore: 'One person per season breathes this air. This season, it was you.', art: { kind: 'title', from: '#F5C542', to: '#FF2A2A' } }),
  item({ id: 'title-titan', name: '"Titan"', type: 'TITLE', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'A titan at the gates of Olympus, one single breath from godhood.', art: { kind: 'title', from: '#F5C542', to: '#FFF0B8' } }),
  item({ id: 'title-demigod', name: '"Demigod"', type: 'TITLE', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'Half-mortal, half-myth. The podium bows all the same.', art: { kind: 'title', from: '#F5C542', to: '#e7ddf5' } }),
  item({ id: 'title-campfire-champion', name: '"Campfire Champion"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Your fire, your crown. Everyone here knows who kept it burning hottest.', art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'title-the-untouchable', name: '"The Untouchable"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'The rarest air of the season. Ninety-nine in a hundred never breathe it.', art: { kind: 'title', from: '#a06cd5', to: '#FFFFFF' } }),
  item({ id: 'title-elite-ember', name: '"Elite Ember"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: "The season's sharpest few — and you were one of them.", art: { kind: 'title', from: '#a06cd5', to: '#FFD27A' } }),
  item({ id: 'title-ashborne', name: '"Ashborne"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'You closed the season in the highest tier the arena has.', art: { kind: 'title', from: '#a06cd5', to: '#A99CBD' } }),
  item({ id: 'title-kept-the-fire', name: '"Kept the Fire"', type: 'TITLE', rarity: 'rare', acquisition: 'earned', seasonStamped: true,
    lore: 'Not the top, but you never let the fire go out. That counts.', art: { kind: 'title', from: '#4FB0E5', to: '#FFD27A' } }),

  // ── Season 1 "Emberfall" placement ladder (SEASON_TITLES_SPEC.md) ──
  // Season-EXCLUSIVE and never re-earnable: S2 ships its own seven, and these retire into the
  // trophy case. Two classes on purpose — the podium are mythological flame deities, the
  // percentiles are Gen-Z flexes. The authoritative copy (and each god's significance blurb) lives
  // in the `season_titles` TABLE so a new season needs no app release; these rows exist so
  // inventory and profile can draw the tile for a key the server granted.
  item({ id: 'title-s1-surtur', name: '"Surtur"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true, oneOfOne: true,
    lore: 'The fire-giant of Ragnarök, whose flaming sword outshines the sun. There is only ever one.', art: { kind: 'title', from: '#F5C542', to: '#FF2A2A' } }),
  item({ id: 'title-s1-agni', name: '"Agni"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true,
    lore: 'The divine fire the gods themselves speak through. Second to none but the world-ender.', art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'title-s1-helios', name: '"Helios"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true,
    lore: 'The Titan who hauls the sun across the sky. Third of three — and still a god.', art: { kind: 'title', from: '#F2A33C', to: '#FFF0B8' } }),
  item({ id: 'title-s1-built-different', name: '"Built Different"', type: 'TITLE', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'Top 1% of the whole board. Same twenty-four hours as everyone else, used like nobody else.', art: { kind: 'title', from: '#F5C542', to: '#D4FF4D' } }),
  item({ id: 'title-s1-firebreather', name: '"Firebreather"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Top 10%. Ran hot for ninety days straight and never needed to be talked into it.', art: { kind: 'title', from: '#a06cd5', to: '#FF9A3C' } }),
  item({ id: 'title-s1-certified-firestarter', name: '"Certified Firestarter"', type: 'TITLE', rarity: 'rare', acquisition: 'earned', seasonStamped: true,
    lore: 'Top 25%. Lit something in the people around you, then kept it burning.', art: { kind: 'title', from: '#4FB0E5', to: '#FFD27A' } }),
  item({ id: 'title-s1-warming-up', name: '"Warming Up"', type: 'TITLE', rarity: 'uncommon', acquisition: 'earned', seasonStamped: true,
    lore: "Top half of the season. Kept a flame all the way through — that's where every fire starts.", art: { kind: 'title', from: '#3DA85C', to: '#FFD27A' } }),

  // Vs-Unis is COLLECTIVE — the school places, not the person, so every contributing member of a
  // top-3 uni shares the campus title. No individual "Ascended" ever comes off this board (21j).
  item({ id: 'title-prometheus-disciples', name: '"Prometheus’ Disciples"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'The flame-bringers. Your campus lit more than anyone else alive.', art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'title-keepers-of-the-flame', name: '"Keepers of the Flame"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Second on the whole board, and the fire never once dipped.', art: { kind: 'title', from: '#a06cd5', to: '#F2A33C' } }),
  item({ id: 'title-champions-of-academia', name: '"Champions of Academia"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Third among every school that showed up. Your campus earned this together.', art: { kind: 'title', from: '#a06cd5', to: '#4FB0E5' } }),
];

const BANNERS: CatalogItem[] = [
  item({ id: 'banner-emberfall-night', name: 'Emberfall Night', type: 'BANNER', rarity: 'epic', acquisition: 'box',
    lore: 'The sky over the arena, raining slow orange light.',
    art: { kind: 'banner', from: '#2a1533', to: '#E0612C' } }),
  item({ id: 'banner-ashfall-ridge', name: 'Ashfall Ridge', type: 'BANNER', rarity: 'epic', acquisition: 'box',
    lore: 'A grey ridgeline under falling ash, where the serious ones train.',
    art: { kind: 'banner', from: '#20182f', to: '#A99CBD' } }),
  item({ id: 'banner-obsidian-colosseum', name: 'Obsidian Colosseum', type: 'BANNER', rarity: 'legendary', acquisition: 'box',
    lore: 'Black stone tiers rising into the dark. Every seat is watching.',
    art: { kind: 'banner', from: '#0F0D14', to: '#F5C542' } }),
  item({ id: 'banner-the-great-forge', name: 'The Great Forge', type: 'BANNER', rarity: 'legendary', acquisition: 'box',
    lore: 'The hall where ranks are hammered out of raw resolve.',
    art: { kind: 'banner', from: '#5a3a12', to: '#FFB800' } }),
];

// ───────────────────────────── 3 · Audio & haptic packs ─────────────────────────────

const AUDIO: CatalogItem[] = [
  item({ id: 'audio-heavy-bonfire-crackle', name: 'Heavy Bonfire Crackle', type: 'AUDIO', rarity: 'uncommon', acquisition: 'box',
    lore: 'Now you can REALLY gather ’round the campfire.', art: { kind: 'audio', from: '#3DA85C', to: '#FFD27A' } }),
  item({ id: 'audio-edm-pulse', name: 'EDM Pulse', type: 'AUDIO', rarity: 'rare', acquisition: 'box',
    lore: 'For the techno lovers.', art: { kind: 'audio', from: '#4FB0E5', to: '#ff9ad2' } }),
  item({ id: 'audio-midnight-thunder', name: 'Midnight Thunder', type: 'AUDIO', rarity: 'rare', acquisition: 'box',
    lore: "Storms that stay on the horizon so you don't have to look up.", art: { kind: 'audio', from: '#2A5AE0', to: '#BFD6FF' } }),
  item({ id: 'audio-monastery-drone', name: 'Monastery Drone', type: 'AUDIO', rarity: 'epic', acquisition: 'box',
    lore: 'A single held note from people who gave their lives to focus.', art: { kind: 'audio', from: '#a06cd5', to: '#e7ddf5' } }),
  item({ id: 'audio-lofi-lullaby', name: 'Lofi Lullaby', type: 'AUDIO', rarity: 'epic', acquisition: 'box',
    lore: '"I heard Lofee Girl was ranked Diamond II in Philoi."', art: { kind: 'audio', from: '#a06cd5', to: '#FFD27A' } }),
  item({ id: 'audio-deep-space-sub-bass', name: 'Deep Space Sub-Bass', type: 'AUDIO', rarity: 'legendary', acquisition: 'box',
    lore: "The sound the void makes when it's thinking. Felt more than heard.", art: { kind: 'audio', from: '#14111C', to: '#F5C542' } }),
];

// Stop / Start Lock-In SFX (ITEM_CATALOG §3b, rescoped by PUNCHLIST_12). These are the sounds a
// session BEGINS and ENDS on — not rank-up sounds. The rank-up moment has its own layered per-tier
// arrangement (RANKUP_SPEC) that no cosmetic overrides.
//
// Victory Anthem was removed here: at 83 seconds it can't punctuate anything, and it was already
// serving as Hero's Champions Anthem on the band crossing. Owning it twice under two names made
// the anthem feel like a purchasable rather than the rarest audio moment in the app.
const SFX: CatalogItem[] = [
  item({ id: 'sfx-heavy-anvil-slam', name: 'Heavy Anvil Slam', type: 'SFX', rarity: 'rare', acquisition: 'box',
    lore: 'One strike. It means the thing is finished and it is not coming apart.', art: { kind: 'sfx', from: '#4FB0E5', to: '#c2dcea' } }),
  item({ id: 'sfx-sub-bass-drop', name: 'Sub-Bass Drop', type: 'SFX', rarity: 'rare', acquisition: 'box',
    lore: 'The floor falls out from under the moment. On purpose.', art: { kind: 'sfx', from: '#4FB0E5', to: '#7BE0FF' } }),
  item({ id: 'sfx-jet-engine-ignition', name: 'Jet Engine Ignition', type: 'SFX', rarity: 'epic', acquisition: 'box',
    lore: 'Zero to gone.', art: { kind: 'sfx', from: '#a06cd5', to: '#FF9A3C' } }),
  item({ id: 'sfx-olympian-foghorn', name: 'Olympian Foghorn', type: 'SFX', rarity: 'legendary', acquisition: 'box',
    lore: 'Echoes of this can be heard from Olympus. The gods are watching you.', art: { kind: 'sfx', from: '#F5C542', to: '#FFF0B8' } }),
];

// ───────────────────────────── 4 · Collection badges & trophies ─────────────────────────────
// Showcase-only (no equip slot) and EARN-ONLY — these are the prestige shelf, so §8.4 keeps them
// out of the direct-buy row entirely. They remain sellable from the Inventory (21i).

const RELICS: CatalogItem[] = [
  item({ id: 'relic-hestias-hearthstone', name: "Hestia's Hearthstone", type: 'RELIC', rarity: 'epic', acquisition: 'earned',
    lore: "A coal from the first hearth infused with an undying flame, passed down as a family heirloom. It's now yours.",
    art: { kind: 'relic', from: '#E0612C', to: '#FFD27A' } }),
  item({ id: 'relic-athenas-aegis', name: "Athena's Aegis", type: 'RELIC', rarity: 'epic', acquisition: 'earned',
    lore: "The shield that has never once been broken. Now it's yours to stand behind.",
    art: { kind: 'relic', from: '#a06cd5', to: '#F5C542' } }),
  item({ id: 'relic-icarus-feather', name: "Icarus' Feather", type: 'RELIC', rarity: 'legendary', acquisition: 'earned',
    lore: 'Scorched at the tip. Proof that someone flew high enough to burn.',
    art: { kind: 'relic', from: '#F5C542', to: '#FFF6EC' } }),
  item({ id: 'relic-anvil-of-hephaestus', name: 'Anvil of Hephaestus', type: 'RELIC', rarity: 'legendary', acquisition: 'earned',
    lore: "Zeus' bolt was forged on this thing. It's that strong.",
    art: { kind: 'relic', from: '#4a4460', to: '#F5C542' } }),
  item({ id: 'relic-prometheus-shard', name: "Prometheus' Shard", type: 'RELIC', rarity: 'mythic', acquisition: 'earned',
    lore: 'You are now one of us. Spread your fire to all of humanity to rise and ascend.',
    art: { kind: 'relic', from: '#FF2A2A', to: '#FFD27A' } }),
  // ── added with migration 0119 (ITEM_CATALOG §4a / §4a-3) ──
  // Zeus' Bolt and Atlas' Burden were in the catalog document but had no entry here and no
  // evaluation logic at all — they could not be granted, and would have rendered as an unknown
  // key if they somehow had been.
  item({ id: 'relic-zeus-bolt', name: "Zeus' Bolt", type: 'RELIC', rarity: 'mythic', acquisition: 'earned',
    lore: 'The king himself bows toward your greatness.',
    art: { kind: 'relic', from: '#F5C542', to: '#FFF6EC' } }),
  item({ id: 'relic-atlas-burden', name: "Atlas' Burden", type: 'RELIC', rarity: 'mythic', acquisition: 'earned',
    lore: 'A thousand pounds carried across the three great lifts. Atlas nods in approval.',
    art: { kind: 'relic', from: '#4a4460', to: '#FF2A2A' } }),
];

/**
 * §4a-2 — the discipline relics. ONE item each, not one per rung.
 *
 * The `rarity` below is the FIRST rung's, because that is what the relic is worth the moment it is
 * granted. Every rung after that raises `cosmetics_owned.rarity_override`, which collection.tsx
 * and use-inventory.ts already prefer over this value — so a maxed Hercules' Might reads mythic
 * without a second catalog entry existing. `relic-ladders.ts` holds the thresholds for display;
 * the server's `relic_ladders` table (0119) is the authority, and the two are retuned together.
 *
 * Deliberately NOT one item per rung: §4a-2 specifies "one showcase item that upgrades its
 * rarity/tier", and twenty-two inventory rows for five achievements is the shape that rules out.
 */
const DISCIPLINE_RELICS: CatalogItem[] = [
  item({ id: 'relic-hercules-might', name: "Hercules' Might", type: 'RELIC', rarity: 'uncommon', acquisition: 'earned',
    lore: "Twelve labours. You're somewhere past the seventh — and it shows.",
    art: { kind: 'relic', from: '#8B3A1F', to: '#FF9A3C' } }),
  item({ id: 'relic-pheidippides-sandals', name: "Pheidippides' Sandals", type: 'RELIC', rarity: 'rare', acquisition: 'earned',
    lore: 'He crossed 414 km on foot to call for help. You have matched every step.',
    art: { kind: 'relic', from: '#4FB0E5', to: '#FFF0B8' } }),
  item({ id: 'relic-socrates-scroll', name: "Socrates' Scroll", type: 'RELIC', rarity: 'uncommon', acquisition: 'earned',
    lore: "The unexamined hour isn't worth logging. You examined a hundred.",
    art: { kind: 'relic', from: '#6B5B95', to: '#FFD27A' } }),
  item({ id: 'relic-daedalus-blueprint', name: "Daedalus' Blueprint", type: 'RELIC', rarity: 'uncommon', acquisition: 'earned',
    lore: "The labyrinth wasn't built in a day. Neither is whatever you're making.",
    art: { kind: 'relic', from: '#2E5E4E', to: '#7BE0FF' } }),
  item({ id: 'relic-oracles-stillness', name: "Oracle's Stillness", type: 'RELIC', rarity: 'uncommon', acquisition: 'earned',
    lore: 'The Oracle spoke only in the quiet. You have kept a great deal of it.',
    art: { kind: 'relic', from: '#1F3A5F', to: '#C9B6FF' } }),
  // The set-completion capstone: the top rung of all five ladders (§4a-2).
  item({ id: 'relic-crown-of-olympus', name: 'Crown of Olympus', type: 'RELIC', rarity: 'mythic', acquisition: 'earned',
    lore: 'Master of no single art, but of the discipline beneath all of them. Olympus has a seat for that.',
    art: { kind: 'relic', from: '#F5C542', to: '#FF2A2A' } }),
];

const MEDALS: CatalogItem[] = [
  item({ id: 'medal-emberfall-champion', name: 'Emberfall Champion', type: 'MEDAL', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'A whole season burned down to ash around one flame that never went out. Yours.',
    art: { kind: 'medal', from: '#E0612C', to: '#F5C542' } }),
  item({ id: 'medal-campus-sovereign', name: 'Campus Sovereign', type: 'MEDAL', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'There is no higher spot. You are the one they look up to, now.',
    art: { kind: 'medal', from: '#F5C542', to: '#FFF0B8' } }),
  item({ id: 'medal-unbroken-season', name: 'Unbroken Season', type: 'MEDAL', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'A full season without a single dead day. Almost no one earns this twice.',
    art: { kind: 'medal', from: '#3DA85C', to: '#F5C542' } }),
];

// ───────────────────────────── Forge Pass S1 · the Emberfall set ─────────────────────────────
// Premium-track only, never in boxes, never re-issued (FORGE_PASS.md). Tagged `forge-pass-S1` so
// §8.4's direct-buy filter excludes them automatically.

const EMBERFALL_SET: CatalogItem[] = [
  item({ id: 'flame-emberfall', name: 'Emberfall Flame', type: 'FLAME', rarity: 'epic', acquisition: 'forge-pass-S1',
    lore: 'The season’s own colour. When it falls, it falls burning.',
    art: { kind: 'flame', from: '#8A2B00', to: '#FF9A3C' } }),
  item({ id: 'halo-emberfall', name: 'Emberfall Halo', type: 'HALO', rarity: 'epic', acquisition: 'forge-pass-S1',
    lore: 'A ring of falling embers that never reaches the ground.',
    art: { kind: 'halo', from: '#8A2B00', to: '#FFD27A' } }),
  item({ id: 'card-emberfall', name: 'Emberfall Card', type: 'CARD', rarity: 'epic', acquisition: 'forge-pass-S1',
    lore: 'Ash on dark glass, still warm to the touch.',
    art: { kind: 'card', from: '#2a1533', to: '#E0612C' } }),
  item({ id: 'banner-emberfall', name: 'Emberfall Banner', type: 'BANNER', rarity: 'legendary', acquisition: 'forge-pass-S1',
    lore: 'Fly it and the whole arena knows which season you came up in.',
    art: { kind: 'banner', from: '#6a2a18', to: '#FFC24D' } }),
  item({ id: 'title-kindled-by-emberfall', name: '"Kindled by Emberfall"', type: 'TITLE', rarity: 'legendary', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'The season lit you, and you never went out.',
    art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  // The season's one Mythic flare and the entire reason to buy the pass — granted at Level 0, the
  // instant the purchase clears (FORGE_PASS_SEASON1 §"Level 0"). It is NOT a milestone reward: a
  // marquee unlock 25 levels away is a promise, and this one has to be a receipt.
  item({ id: 'flare-emberfall-ascendant', name: 'Emberfall Ascendant', type: 'FLARE', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'The capstone. The whole season, compressed into one unbearable light.',
    art: { kind: 'flare', from: '#FF2A2A', to: '#FFE0B0' },
    // The one bespoke effect in the set (punchlist 15.3) — lava pooling low plus embers raining
    // from above. The capstone doesn't share a motion layer with a box drop.
    flare: { colour: '#FF5A2E', effect: 'emberfall' } }),
  item({ id: 'flame-forge', name: 'Forge Flame', type: 'FLAME', rarity: 'legendary', acquisition: 'forge-pass-S1',
    lore: 'Struck, folded, struck again. The colour a thing turns when it stops being raw.',
    art: { kind: 'flame', from: '#7A2E00', to: '#FFB03C' } }),
  // The two named rewards the level table calls for that the catalog didn't carry yet: L60's
  // Legendary title and L70's Legendary banner.
  item({ id: 'title-dialed-in', name: '"Dialed In"', type: 'TITLE', rarity: 'legendary', acquisition: 'forge-pass-S1',
    lore: 'No wasted motion. Nothing on the screen but the thing you came to do.',
    art: { kind: 'title', from: '#B8651F', to: '#FFE7A0' } }),
  item({ id: 'banner-ashfall', name: 'Ashfall', type: 'BANNER', rarity: 'legendary', acquisition: 'forge-pass-S1',
    lore: 'Grey sky, warm ground. The season settling over everything.',
    art: { kind: 'banner', from: '#2a2018', to: '#D9913C' } }),
  // ── The Mythic milestone set: L25 · L50 · L75 · L90 · L100 ──
  item({ id: 'banner-emberfall-mythic', name: 'Emberfall Standard', type: 'BANNER', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'Carried at the front. Everyone behind it knows what season they are in.',
    art: { kind: 'banner', from: '#4a1508', to: '#FFD24D' } }),
  item({ id: 'halo-emberfall-mythic', name: 'Emberfall Crown Halo', type: 'HALO', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'Falling embers that circle instead of landing. They have nowhere better to be.',
    art: { kind: 'halo', from: '#B01A0E', to: '#FFE0B0' } }),
  item({ id: 'sfx-emberfall-strike', name: 'Emberfall Strike', type: 'SFX', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'Hammer on anvil, once, and the whole season rings with it.',
    art: { kind: 'sfx', from: '#B01A0E', to: '#FFC24D' } }),
  item({ id: 'card-emberfall-mythic', name: 'Emberfall Sovereign Card', type: 'CARD', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'Black glass, one seam of living ember running through it.',
    art: { kind: 'card', from: '#14090c', to: '#FF5A2E' } }),
  item({ id: 'relic-emberfall', name: 'Emberfall Relic', type: 'RELIC', rarity: 'legendary', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'A fragment of the first forge, still too hot to hold. Kept, not worn.',
    art: { kind: 'relic', from: '#3a1608', to: '#FF9A3C' } }),
  item({ id: 'medal-emberfall-crown', name: 'Emberfall Crown', type: 'MEDAL', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'One hundred levels. The season put everything it had in front of you and you took all of it.',
    art: { kind: 'medal', from: '#8A4E18', to: '#FFE7A0' } }),
  // The two completion titles. Same level, different lanes — finishing the free track is its own
  // achievement and gets its own name rather than a dimmed version of the paid one.
  // `title-s1-*`, not `title-the-relentless`: an epic box title already owns that id and that
  // display name. Both are season-stamped, so this one renders as "The Relentless · S1" and reads
  // as the distinct, un-buyable thing it is — reusing the id would have made the pass capstone
  // indistinguishable from a common box pull.
  item({ id: 'title-s1-the-relentless', name: '"The Relentless"', type: 'TITLE', rarity: 'legendary', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'One hundred levels without paying a cent. Nothing about that was convenient.',
    art: { kind: 'title', from: '#C4701F', to: '#FFD24D' } }),
  item({ id: 'title-forged-in-ember', name: '"Forged in Ember"', type: 'TITLE', rarity: 'mythic', acquisition: 'forge-pass-S1', seasonStamped: true,
    lore: 'The full season, both lanes, all the way up. Gold, and earned in gold.',
    art: { kind: 'title', from: '#FFB03C', to: '#FFF3C4' } }),
];

// ── Season 1 placement awards (FORGE_PASS_SEASON1 §"End-of-season placement rewards") ──
//
// Granted ONCE at season close by final standing, then never re-issued — which is the whole source
// of their value. `acquisition: 'earned'` is what enforces that in code rather than in policy:
// boxPool() filters on 'box', so none of these can ever enter a loot box or the direct-buy row, and
// there is no second list to keep in sync.
const EMBERFALL_PLACEMENT: CatalogItem[] = [
  item({ id: 'card-emberfall-sovereign', name: 'Emberfall Sovereign', type: 'CARD', rarity: 'mythic', acquisition: 'earned', seasonStamped: true, oneOfOne: true,
    lore: 'One per campus, per season, forever. There is no second way to get this.',
    art: { kind: 'card', from: '#0b0608', to: '#FFD24D' } }),
  item({ id: 'title-emberfall-champion', name: '"Emberfall Champion"', type: 'TITLE', rarity: 'mythic', acquisition: 'earned', seasonStamped: true, oneOfOne: true,
    lore: 'You finished the season at number one. The season is over; this is not.',
    art: { kind: 'title', from: '#FFB03C', to: '#FFFFFF' } }),
  // NOTE: the Champion's medal is the EXISTING `medal-emberfall-champion` (in MEDALS above, minted
  // by 0066's placement grants). It is deliberately not redefined here — a second entry under the
  // same id would shadow the first depending on array order and silently change its rarity.
  item({ id: 'banner-emberfall-elite', name: 'Emberfall Elite', type: 'BANNER', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'Top ten on your campus. Nine other people know exactly what this took.',
    art: { kind: 'banner', from: '#4a1508', to: '#FFC24D' } }),
  item({ id: 'title-emberfall-elite', name: '"Emberfall Elite"', type: 'TITLE', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'Top ten, all season, no quiet weeks.',
    art: { kind: 'title', from: '#E0612C', to: '#FFD24D' } }),
  item({ id: 'particle-emberfall-ascendant', name: 'Ascendant Ash', type: 'PARTICLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'The top one percent of a whole campus, falling slowly.',
    art: { kind: 'particle', from: '#8A2B00', to: '#FFC46B' } }),
  item({ id: 'title-emberfall-ascendant', name: '"Emberfall Ascendant"', type: 'TITLE', rarity: 'epic', acquisition: 'earned', seasonStamped: true,
    lore: 'Top one percent. The air is thinner up here and you stayed anyway.',
    art: { kind: 'title', from: '#C4701F', to: '#FFC46B' } }),
  item({ id: 'title-emberfall-contender', name: '"Emberfall Contender"', type: 'TITLE', rarity: 'rare', acquisition: 'earned', seasonStamped: true,
    lore: 'Top ten percent. You were never out of it.',
    art: { kind: 'title', from: '#8A4E18', to: '#F2A33C' } }),
  item({ id: 'title-emberfall-initiate', name: '"Emberfall Initiate"', type: 'TITLE', rarity: 'uncommon', acquisition: 'earned', seasonStamped: true,
    lore: 'Top half of your campus for a whole term. Most people never start.',
    art: { kind: 'title', from: '#6a3a12', to: '#D9913C' } }),
  item({ id: 'medal-emberfall-centurion', name: 'Emberfall Centurion', type: 'MEDAL', rarity: 'legendary', acquisition: 'earned', seasonStamped: true,
    lore: 'Level one hundred, whatever place you finished in. The track does not care who else showed up.',
    art: { kind: 'medal', from: '#6a2a18', to: '#FFD24D' } }),
  item({ id: 'medal-emberfall-participant', name: 'Emberfall Ashmark', type: 'MEDAL', rarity: 'common', acquisition: 'earned', seasonStamped: true,
    lore: 'You were here for Emberfall. The first season only happens once.',
    art: { kind: 'medal', from: '#3a2418', to: '#C4701F' } }),
];

// ───────────────────────────── 0 · The starter loadout (#88) ─────────────────────────────
//
// Every account is seeded with these at signup (migration 0073), so a brand-new user's profile is
// already wearing something rather than rendering a row of empty slots. They are the FLOOR, not a
// reward: all common, all in the house orange, and deliberately plain — a starter set that looked
// good enough to keep would undercut the entire reason to open a box.
//
// Permanent and non-sellable. `acquisition: 'default'` keeps them out of boxPool() by construction
// (it filters on 'box'), and salvage_cosmetic refuses them server-side — a user who sold their base
// flame would have an unfillable slot and no way back to it.
const DEFAULTS: CatalogItem[] = [
  item({ id: 'flame-base-ember', name: 'Ember', type: 'FLAME', rarity: 'common', acquisition: 'default',
    lore: 'The first fire anyone builds. Nothing fancy — it just refuses to go out.',
    art: { kind: 'flame', from: '#B8651F', to: '#F2A33C' } }),
  item({ id: 'particle-base-spark', name: 'Sparks', type: 'PARTICLE', rarity: 'common', acquisition: 'default',
    lore: 'What comes off any fire worth sitting near.',
    art: { kind: 'particle', from: '#C4701F', to: '#FFC46B' } }),
  // NOTE: there is deliberately no starter FLARE. FLARES_SPEC.md is explicit that no free or base
  // perimeter aura exists — the aura is the whole point of owning a flare, and shipping a common
  // one with every account would spend the reward before anyone earned it. The flare slot is the
  // one slot a new user sees empty, and that emptiness is the product.
  item({ id: 'card-base-hearth', name: 'Hearth', type: 'CARD', rarity: 'common', acquisition: 'default',
    lore: 'Plain stone, banked coals. Every campfire starts here.',
    art: { kind: 'card', from: '#2A1A12', to: '#B8651F' } }),
  item({ id: 'halo-base-ring', name: 'Emberring', type: 'HALO', rarity: 'common', acquisition: 'default',
    lore: 'A thin ring of heat. Proof there is something burning underneath.',
    art: { kind: 'halo', from: '#B8651F', to: '#F2A33C' } }),
  item({ id: 'title-base-kindling', name: 'Kindling', type: 'TITLE', rarity: 'common', acquisition: 'default',
    lore: 'Everyone is kindling before they are anything else.',
    art: { kind: 'title', from: '#8A4E18', to: '#F2A33C' } }),
  item({ id: 'banner-base-hearth', name: 'Hearthlight', type: 'BANNER', rarity: 'common', acquisition: 'default',
    lore: 'The banner you fly on your first day. Quiet, and entirely yours.',
    art: { kind: 'banner', from: '#2A1A12', to: '#C4701F' } }),
  // The two lock-in stings. Their cue names are their ids (see equipped-audio.ts) and both point at
  // one-shots the app already ships — spark.wav and settle.wav — so the starter set needs no new
  // audio to be audible on day one.
  item({ id: 'sfx-campfire-spark', name: 'Campfire Spark', type: 'SFX', rarity: 'common', acquisition: 'default',
    lore: 'The catch of a struck match. Your session, beginning.',
    art: { kind: 'sfx', from: '#C4701F', to: '#FFC46B' } }),
  item({ id: 'sfx-ember-settle', name: 'Ember Settle', type: 'SFX', rarity: 'common', acquisition: 'default',
    lore: 'Logs shifting as the fire banks down. Your session, finished.',
    art: { kind: 'sfx', from: '#8A4E18', to: '#F2A33C' } }),
  // Owned but NOT equipped by default — see DEFAULT_LOADOUT.
  item({ id: 'audio-base-hearth-hum', name: 'Hearth Hum', type: 'AUDIO', rarity: 'common', acquisition: 'default',
    lore: 'The low sound of a room with a fire in it.',
    art: { kind: 'audio', from: '#B8651F', to: '#F2A33C' } }),
];

/**
 * What the seeded account is actually WEARING (migration 0073 writes exactly this map).
 *
 * Two slots are deliberately absent, for opposite reasons.
 *
 * `audio` — owned but not worn. Every other default is silent, passive decoration, but an Audio
 * cosmetic is a looping ambient bed that starts on its own when a lock-in begins, so equipping one
 * by default would play a loop into a room the user never agreed to make noise in. They own
 * `audio-base-hearth-hum` and can equip it in one tap; the app just doesn't decide that for them.
 *
 * `flare` — not owned at all. There is no free perimeter aura by design (FLARES_SPEC.md); an empty
 * flare slot is what a flare is worth.
 */
export const DEFAULT_LOADOUT: Partial<Record<EquipSlot, string>> = {
  flame: 'flame-base-ember',
  particle: 'particle-base-spark',
  card: 'card-base-hearth',
  halo: 'halo-base-ring',
  title: 'title-base-kindling',
  banner: 'banner-base-hearth',
  sfx_start: 'sfx-campfire-spark',
  sfx_stop: 'sfx-ember-settle',
};

const DEFAULT_IDS: ReadonlySet<string> = new Set(DEFAULTS.map((i) => i.id));

/**
 * True for a starter item. Call sites use this to hide Sell — the server refuses the salvage
 * anyway, but an enabled button that always errors is a worse answer than no button.
 */
export function isDefaultItem(id: string): boolean {
  return DEFAULT_IDS.has(id);
}

export const CATALOG: CatalogItem[] = [
  ...DEFAULTS,
  ...FLAMES,
  ...PARTICLES,
  ...FLARES,
  ...CARDS,
  ...HALOS,
  ...TITLES_BOX,
  ...TITLES_EARNED,
  ...BANNERS,
  ...AUDIO,
  ...SFX,
  ...RELICS,
  ...DISCIPLINE_RELICS,
  ...MEDALS,
  ...EMBERFALL_SET,
  ...EMBERFALL_PLACEMENT,
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

/**
 * Retired item ids → the id that replaced them.
 *
 * An owned item is a row in the database holding an id STRING, so renaming a catalog id doesn't
 * rename anything anyone owns — it orphans it. Without this map, a user who pulled Stormforge
 * before punchlist 15.3 opens their inventory and the item is simply gone: `getItem` returns
 * undefined and every consumer skips the row. That's a paid cosmetic silently deleted, which is
 * the one failure this system can't have.
 *
 * Redirecting in the lookup rather than migrating the rows is deliberate — the equipped-loadout
 * table, the box-open history and any queued grant all carry the old string too, so a data
 * migration would have to find every one of them, while this catches all of them at the single
 * point they're resolved.
 */
const RENAMED_IDS: Record<string, string> = {
  // punchlist 15.3 — freed up for the FLAME cosmetics of the same names.
  'flare-stormforge': 'flare-asgardian-valor',
  'flare-toxic': 'flare-acid-rain',
};

export function getItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id) ?? BY_ID.get(RENAMED_IDS[id] ?? '');
}

export function itemsOfType(type: ItemType): CatalogItem[] {
  return CATALOG.filter((i) => i.type === type);
}

/**
 * The loot-box drop pool AND the direct-buy pool (§8.4 — "only box-pool cosmetics are
 * direct-buyable"). Earned and Pass-exclusive items are excluded by construction, which is what
 * keeps prestige un-purchasable without a second list to keep in sync.
 */
export function boxPool(): CatalogItem[] {
  return CATALOG.filter((i) => i.acquisition === 'box');
}

export function boxPoolByRarity(rarity: Rarity): CatalogItem[] {
  return CATALOG.filter((i) => i.acquisition === 'box' && i.rarity === rarity);
}

/** The chip filter across the top of the Inventory (mock 67) — "All" plus the 11 types. */
export const TYPE_FILTERS: { key: ItemType | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'FLAME', label: 'Flames' },
  { key: 'PARTICLE', label: 'Particles' },
  { key: 'FLARE', label: 'Flares' },
  { key: 'CARD', label: 'Cards' },
  { key: 'HALO', label: 'Halos' },
  { key: 'TITLE', label: 'Titles' },
  { key: 'BANNER', label: 'Banners' },
  { key: 'AUDIO', label: 'Audio' },
  { key: 'SFX', label: 'SFX' },
  { key: 'RELIC', label: 'Relics' },
  { key: 'MEDAL', label: 'Medals' },
];

export const SLOT_LABEL: Record<EquipSlot, string> = {
  flame: 'flame',
  particle: 'particle effect',
  flare: 'God-Mode flare',
  card: 'card texture',
  halo: 'halo',
  title: 'title',
  banner: 'campfire banner',
  audio: 'focus audio',
  // Renamed off "rank-up SFX" (PUNCHLIST_12): the rank-up moment keeps its own layered per-tier
  // system and is never overridden by a cosmetic. These are the sounds a session begins and ends on.
  sfx_start: 'start sting',
  sfx_stop: 'end sting',
};
