// The Forge (mocks 155/156, migration 0138) — the client's half of the tier-up combine.
//
// The Forge is not a new economy. There is no scrap resource, no ember cost, no yields to balance:
// "scraps" is the word for cosmetics you own and do not want, and forging deletes N of them to grant
// one of the next rarity up. Everything here therefore reads off the catalog that already exists.
//
// Like boxes.ts mirroring economy_config('box_odds'), this file is a DISPLAY copy of the ladder the
// server keeps in economy_config('forge_ratios'). Screens render from here so the recipe tabs draw
// without a round-trip; forge_combine re-derives its own numbers and is the one that wins.

import { boxPoolByRarity, type CatalogItem } from '@/lib/economy/catalog';
import type { Rarity } from '@/lib/economy/rarity';

/** One rung: feed `need` items of `from`, get one of `into`. */
export type ForgeStep = {
  from: Rarity;
  into: Rarity;
  need: number;
};

/**
 * Four for the first step, three for every step after, all the way to Mythic (Noah, confirmed).
 *
 * Rare is a real cosmetic tier and is deliberately NOT skipped — the shorthand the design note was
 * written in ("3 U -> 1 E") collapses two rungs, and collapsing them would make Rares a dead tier
 * with nothing to do. Mythic is the top OUTPUT and never an input; there is no rung above it, which
 * is why the ladder ends at legendary rather than carrying a `mythic` entry with nowhere to go.
 *
 * 🔴 The Common rung is FOUR because of a content fact, not a balance one. The drop pool holds
 * exactly four commons, every other common is starter gear or earned, and cosmetics_owned is unique
 * on (user_id, cosmetic_key) — so no one can own a fifth by owning a duplicate. At five it was
 * unsatisfiable by anyone, ever. At four it costs the complete set of droppable commons: a real
 * price, and a payable one. It also leaves zero margin, which is why isRungReachable exists below
 * and why the migration asserts the same thing on every deploy.
 */
export const FORGE_LADDER: readonly ForgeStep[] = [
  { from: 'common', into: 'uncommon', need: 4 },
  { from: 'uncommon', into: 'rare', need: 3 },
  { from: 'rare', into: 'epic', need: 3 },
  { from: 'epic', into: 'legendary', need: 3 },
  { from: 'legendary', into: 'mythic', need: 3 },
] as const;

export function forgeStepFor(rarity: Rarity | null | undefined): ForgeStep | undefined {
  return FORGE_LADDER.find((s) => s.from === rarity);
}

/** "C → U", the recipe tab label (mock 155's tab strip). */
export function stepTabLabel(step: ForgeStep): string {
  return `${step.from[0].toUpperCase()}→${step.into[0].toUpperCase()}`;
}

/** "3 RARE → 1 EPIC", the recipe card's heading. */
export function stepRecipeLabel(step: ForgeStep): string {
  return `${step.need} ${step.from.toUpperCase()} → 1 ${step.into.toUpperCase()}`;
}

/**
 * Everything the box drop pool holds at one rarity — and therefore, for the Forge, two things at
 * once: what a rung can PRODUCE at its target rarity, and the entire universe of what can be FED to
 * it at its source rarity. Deliberately one function, because it is genuinely one set. Two functions
 * would invite the two halves to drift apart, and the drift is the bug.
 *
 * 🔴 This is the season guarantee, and it is a guarantee because of what it does NOT contain. Season
 * and Flame Pass items (flare-emberfall-ascendant, card-emberfall-sovereign, the Emberfall medals)
 * carry acquisition 'earned' or 'forge-pass-S1', so boxPoolByRarity never returns one — the Forge
 * can neither mint a season-exclusive mythic nor be handed one as fuel, no matter what the ladder
 * says. Relics are excluded by the same single mechanism rather than by a second rule.
 *
 * The server does not trust this. forge_combine rolls its output from box_droppable_items and checks
 * its inputs against the same table — where 0090 put this fact server-side. This copy exists so the
 * "what you'll get" card can name the pool honestly, not to decide anything.
 */
export function dropPoolAt(rarity: Rarity): CatalogItem[] {
  return boxPoolByRarity(rarity);
}

/**
 * The shape the picker needs of an owned item. Deliberately structural rather than importing
 * OwnedItem from use-inventory: this module is the rule, and the hook is one of its callers.
 */
export type ForgeCandidate = {
  id: string;
  rarity: Rarity;
  acquisition: CatalogItem['acquisition'];
  source: 'earned' | 'paid' | 'box' | 'forge_pass';
};

/**
 * Is this owned item legal fuel?
 *
 * A MIRROR of forge_combine's gate, not the gate itself. The screen must not offer a season item or
 * a relic as selectable fuel — showing it and then failing the call is a worse experience than never
 * showing it — but the refusal that matters is the server's, which re-checks all of this against
 * box_droppable_items and cosmetics_owned.source regardless of what the client sends. A crafted call
 * must not be able to strip someone's Emberfall mythic, and this function is not what stops it.
 *
 * Two conditions, for the two ways an item can be outside the drop pool:
 *
 *   acquisition === 'box'   the CATALOG's answer. 0090's box_droppable_items seed was generated from
 *                           exactly this predicate, so it is the same set the server holds. Excludes
 *                           relics ('earned'), the season set ('forge-pass-S1'), and the starter
 *                           loadout ('default') — the last of which matters: 0064's note on the
 *                           default set is that salvaging one leaves a slot that can never be filled
 *                           again, and feeding one to the Forge is that same deletion by another name.
 *
 *   source is box | paid    the OWNERSHIP row's answer. A box-pool key can still have arrived by a
 *                           season grant (economy_grant_cosmetic(..., 'earned'|'forge_pass', ...)),
 *                           and provenance is what makes that item un-re-earnable. Items bought
 *                           outright with embers ('paid') are drop-pool items and stay eligible —
 *                           buying commons to forge is a legitimate ember sink, not an exploit,
 *                           since direct-buy costs multiples of salvage.
 *
 * A forged item comes back with source 'box', so it can be fed onward — which is the loop.
 */
export function isForgeFuel(item: ForgeCandidate): boolean {
  return item.acquisition === 'box' && (item.source === 'box' || item.source === 'paid');
}

/**
 * Can this rung be filled at all — are there even `need` distinct items of that rarity in the world?
 *
 * A live guard, not a formality. cosmetics_owned is unique on (user_id, cosmetic_key), so the most
 * anyone can hold at a rarity is the size of its drop pool; a recipe asking for more than that is a
 * tab nobody can ever fill, and it doesn't look broken — it looks like an empty inventory.
 *
 * Every rung passes today, but Common passes with ZERO margin: it needs four and the pool holds
 * exactly four. Retire one droppable common and the recipe silently dies. So the screen asks this
 * question every render rather than trusting a number, the migration asserts the same thing on every
 * deploy, and if it ever goes false the Forge says so in words instead of showing nothing.
 */
export function isRungReachable(step: ForgeStep): boolean {
  return dropPoolAt(step.from).length >= step.need;
}

/**
 * Does the caller already own every droppable item at this rarity?
 *
 * The Forge outputs an item you do not own or it outputs nothing (migration 0139) — there is no
 * dupe, and no embers in place of an item. So a rung whose TARGET tier is complete has nothing to
 * forge toward, and the server rejects it with `tier_complete` before consuming anything.
 *
 * This is the client's mirror of that check, and its only job is to say so BEFORE the user spends
 * the effort of filling a recipe. It is not the guard: the guard is server-side, and it holds
 * whatever this returns.
 *
 * Note which rarity gets passed in — the rung's `into`, not its `from`. Owning every Epic is what
 * closes the Rare→Epic rung; owning every Rare is just a lot of fuel.
 */
export function isTierComplete(rarity: Rarity, ownedKeys: ReadonlySet<string>): boolean {
  const pool = dropPoolAt(rarity);
  return pool.length > 0 && pool.every((i) => ownedKeys.has(i.id));
}
