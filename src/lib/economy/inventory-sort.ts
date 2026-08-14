import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OwnedItem } from '@/hooks/use-inventory';
import { RARITY_ORDER } from '@/lib/economy/rarity';

const SORT_KEY = 'philoi_inventory_sort';

/**
 * 'recent' is what the grid has always done — get_inventory orders by acquired_at desc, so the
 * newest pull is top-left. That stays the default: the thing you just opened should be where you
 * look for it. 'rarity' is for the other mode of use, browsing a collection you already know
 * (punchlist 9 §3).
 */
export const SORT_MODES = ['recent', 'rarity'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABEL: Record<SortMode, string> = {
  recent: 'Recent',
  rarity: 'Rarity',
};

function isSortMode(v: string | null): v is SortMode {
  return v !== null && (SORT_MODES as readonly string[]).includes(v);
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
 * Rarity high→low, name as the tie-break.
 *
 * The tie-break is what makes this usable rather than merely correct: without it the ~17 Epics
 * would hold whatever relative order acquisition happened to give them, so the grid would reshuffle
 * within a tier every time a new item landed. Sorts a COPY — `owned` is memoized upstream and
 * sorting in place would mutate a value React is holding onto.
 */
export function sortOwned(items: OwnedItem[], mode: SortMode): OwnedItem[] {
  if (mode === 'recent') return items;
  return [...items].sort(
    (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.name.localeCompare(b.name)
  );
}
