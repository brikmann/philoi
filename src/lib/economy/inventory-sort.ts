import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OwnedItem } from '@/hooks/use-inventory';
import { RARITIES, RARITY_LABEL, RARITY_ORDER, type Rarity } from '@/lib/economy/rarity';

const SORT_KEY = 'philoi_inventory_sort';

/**
 * The two positions of the segmented control.
 *
 * 'recent' is what the grid has always done — get_inventory orders by acquired_at desc, so the
 * newest pull is top-left. That stays the default: the thing you just opened should be where you
 * look for it. 'rarity' is for the other mode of use, browsing a collection you already know
 * (punchlist 9 §3).
 */
export const SORT_MODES = ['recent', 'rarity'] as const;
export type BaseSortMode = (typeof SORT_MODES)[number];

/**
 * ...and the rarity mode carries an optional tier with it: `rarity:epic` narrows the grid to the
 * Epics alone.
 *
 * Modelled as a SUFFIX on 'rarity' rather than as a second piece of state because the two are one
 * question — "show me the collection by tier, and maybe only this tier". Keeping them separate
 * would let the screen hold a live rarity pick while sorted by 'recent', which is a state with no
 * meaning and one more thing to reconcile when the stored preference loads a tick after mount.
 *
 * Bare 'rarity' is still mythic→down over everything, so nothing about the old two-position
 * control changes for someone who never opens the tier row.
 */
export type SortMode = BaseSortMode | `rarity:${Rarity}`;

export const SORT_LABEL: Record<BaseSortMode, string> = {
  recent: 'Recent',
  rarity: 'Rarity',
};

/** The tier this mode is pinned to, or null for "all tiers" (including 'recent'). */
export function rarityFilterOf(mode: SortMode): Rarity | null {
  const tier = mode.startsWith('rarity:') ? mode.slice('rarity:'.length) : null;
  return tier !== null && (RARITIES as readonly string[]).includes(tier) ? (tier as Rarity) : null;
}

/** Whether the tier row should be showing — i.e. the segment is on Rarity, pinned or not. */
export function isRaritySort(mode: SortMode): boolean {
  return mode === 'rarity' || rarityFilterOf(mode) !== null;
}

/** Build the mode for a tier chip. `null` is the "All" chip. */
export function withRarityFilter(rarity: Rarity | null): SortMode {
  return rarity === null ? 'rarity' : `rarity:${rarity}`;
}

/** What the grid is showing, for the empty state and the footer count. */
export function rarityFilterLabel(rarity: Rarity): string {
  return RARITY_LABEL[rarity].toLowerCase();
}

function isSortMode(v: string | null): v is SortMode {
  if (v === null) return false;
  if ((SORT_MODES as readonly string[]).includes(v)) return true;
  // A pinned tier is only valid if this build still knows the rarity — a stored `rarity:relic`
  // from some future tier must fall back rather than filtering the grid down to nothing.
  return v.startsWith('rarity:') && rarityFilterOf(v as SortMode) !== null;
}

export async function loadSortMode(): Promise<SortMode> {
  try {
    const raw = await AsyncStorage.getItem(SORT_KEY);
    return isSortMode(raw) ? raw : 'recent';
  } catch {
    // A sort preference is never worth failing a screen over — fall back to the default order.
    return 'recent';
  }
}

export async function saveSortMode(mode: SortMode): Promise<void> {
  try {
    await AsyncStorage.setItem(SORT_KEY, mode);
  } catch {
    // Same reasoning: the choice still applies for this session, it just won't survive a relaunch.
  }
}

/**
 * Rarity high→low, name as the tie-break — and, when a tier is pinned, only that tier.
 *
 * The tie-break is what makes this usable rather than merely correct: without it the ~17 Epics
 * would hold whatever relative order acquisition happened to give them, so the grid would reshuffle
 * within a tier every time a new item landed. Sorts a COPY — `owned` is memoized upstream and
 * sorting in place would mutate a value React is holding onto.
 *
 * A pinned tier sorts by name alone. Ordering by rarity inside a single rarity is a no-op that
 * would only make the comparator harder to read.
 */
export function sortOwned(items: OwnedItem[], mode: SortMode): OwnedItem[] {
  if (mode === 'recent') return items;

  const pinned = rarityFilterOf(mode);
  if (pinned !== null) {
    return items.filter((i) => i.rarity === pinned).sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...items].sort(
    (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.name.localeCompare(b.name)
  );
}
