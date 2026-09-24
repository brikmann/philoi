import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { getItem, type CatalogItem, type EquipSlot } from '@/lib/economy/catalog';
import { useLoadout } from '@/lib/economy/loadout';
import type { Rarity } from '@/lib/economy/rarity';
import { supabase } from '@/lib/supabase';

// "How others see you" only means something if other people's screens actually render it. This is
// the read that makes that true — feeds, leaderboard rows and challenge headers all show a set of
// OTHER users, so they batch their ids through one call rather than one per row.
//
// get_public_loadouts exposes equipped keys and nothing else: no balances, no unopened boxes, no
// ownership you could sell. Deliberately separate from get_inventory, which stays own-rows-only.

export type PublicItem = CatalogItem & { seasonStamp: string | null };
export type PublicLoadout = Partial<Record<EquipSlot, PublicItem>>;

// Module-level cache keyed by user id. Feed rows mount and unmount constantly while scrolling, and
// without this every recycle would refire the query for someone already resolved.
const cache = new Map<string, PublicLoadout>();

// ── INVALIDATION ──
//
// 🐛 STALE COSMETICS ON LISTS (device smoke 2026-09-23). The cache above had no expiry and no
// invalidation: once a row resolved, it held that snapshot for the life of the process. For
// SOMEONE ELSE that means an equip they did five minutes ago never reaches your screen.
//
// `generation` is the wake-up. Marking ids stale is not enough on its own — the hooks that would
// refetch them are already mounted and their effect has no reason to re-run — so a counter every
// instance subscribes to is what turns a mark into a refetch. Surfaces whose own ids were not
// marked re-run too and find nothing wanted, which costs one array scan and no request.
let generation = 0;
const genListeners = new Set<() => void>();

// Users whose cached entry is to be re-read. MARKED, never deleted: a delete would drop every row
// on the board back to the bare look for the ~200ms the refetch takes, so focusing the Leaderboard
// tab would visibly strip everyone's gear and put it back. The old snapshot stays on screen until
// the new one is in hand, which is what makes the refresh invisible when nothing changed.
const stale = new Set<string>();

function subscribeGeneration(listener: () => void): () => void {
  genListeners.add(listener);
  return () => genListeners.delete(listener);
}

function readGeneration(): number {
  return generation;
}

/** Mark these users for a re-read and wake every mounted reader. */
export function invalidatePublicLoadouts(userIds: Iterable<string>): void {
  let any = false;
  for (const id of userIds) {
    stale.add(id);
    any = true;
  }
  // Bumps whenever there was anything to mark, INCLUDING when every id was already stale. Skipping
  // the bump in that case looks like a free optimisation and is a trap: a failed read leaves its
  // marks in place on purpose, so "already stale" is exactly the state a retry has to get out of,
  // and a focus that declined to wake anyone would strand the board there.
  if (!any) return;
  generation += 1;
  for (const l of genListeners) l();
}

/**
 * Re-read these users' gear every time the screen is focused.
 *
 * Focus is the right invalidation point for the same reason use-inventory picked it: you come back
 * to a board after doing something else, which is exactly when a stale board is noticeable.
 *
 * A SEPARATE hook rather than an option on `usePublicLoadouts`, because that one is called from
 * components mounted outside any navigator (the root layout's watchers reach public-identity), and
 * `useFocusEffect` needs a navigation context or it throws. Screens have one; shared leaf
 * components may not. So the three long-lived surfaces that carry other people's gear — the
 * Leaderboard tab, the Agora, the friends list — opt in from the screen itself.
 */
export function useRefreshPublicLoadoutsOnFocus(userIds: (string | null | undefined)[]): void {
  const key = useMemo(() => Array.from(new Set(userIds.filter(Boolean) as string[])).sort().join(','), [userIds]);

  // Read through a ref so the focus callback's identity never changes. Depending on `key` directly
  // would re-arm the effect whenever the visible set did — and on the Leaderboard tab that set
  // changes every time you tap a scope, which would turn "refresh when you come back" into a
  // refetch per tap and throw away exactly the cache reuse that switching scopes relies on.
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      if (latest.current) invalidatePublicLoadouts(latest.current.split(','));
      // Nothing to undo on blur — the refetch this triggers is what leaving and coming back means.
    }, [])
  );
}

export function usePublicLoadouts(userIds: (string | null | undefined)[]): Record<string, PublicLoadout> {
  // Stable key so the effect doesn't refire on a new array with identical contents.
  const key = useMemo(() => Array.from(new Set(userIds.filter(Boolean) as string[])).sort().join(','), [userIds]);
  // The VALUE, not just the setter. Depending on `bump` (a stable setState identity) meant the
  // memo below never recomputed after a fetch landed, so every surface handed back the empty
  // objects built on first render and cosmetics appeared only once the screen remounted — which
  // is exactly the "titles only show after you visit another tab" report.
  const [tick, bump] = useState(0);

  // ── YOUR OWN ROW COMES FROM THE LIVE STORE, NEVER FROM THE CACHE ──
  //
  // The other half of the same bug, and the half a focus refresh cannot fix: you equip a title,
  // return to the Leaderboard, and your own row still says "Ash Walker". Nothing was going to
  // correct it, because the row was drawn from a server snapshot taken before the equip.
  //
  // Rather than teach each of the fifteen call sites to special-case `row.id === session.user.id`,
  // the substitution happens HERE — one place, every surface, instantly, and with no round trip.
  // <LoadoutSync/> and useInventory both push into that store, so it is already the freshest thing
  // the client has about you.
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const mine = useLoadout();

  const gen = useSyncExternalStore(subscribeGeneration, readGeneration, readGeneration);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const wanted = ids.filter((id) => !cache.has(id) || stale.has(id));
    // Terminates: the fetch below seeds every id it asked for and clears its stale mark before it
    // bumps, so the re-run those deps cause finds nothing wanted and returns here.
    if (wanted.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_public_loadouts', { p_user_ids: wanted });
      // A failed read leaves both the cache and the stale marks alone: the board keeps showing the
      // gear it already had, and the next focus tries again. Cosmetics are decoration — a dropped
      // request must never blank them.
      if (error || cancelled) return;

      // Reset every requested id HERE, once the replacement rows are in hand — including ones with
      // nothing equipped, which otherwise stay "missing" forever and refetch on every scroll. On a
      // re-read this is also what retires a slot the person has since UNEQUIPPED; merging onto the
      // old entry would leave the removed halo on their row until the app restarted.
      for (const id of wanted) {
        cache.set(id, {});
        stale.delete(id);
      }
      for (const row of data ?? []) {
        const item = getItem(row.cosmetic_key);
        const slot = row.slot as EquipSlot;
        if (!item || !slot) continue;
        const existing = cache.get(row.user_id) ?? {};
        existing[slot] = {
          ...item,
          rarity: (row.rarity_override as Rarity) ?? item.rarity,
          seasonStamp: row.season_stamp,
        };
        cache.set(row.user_id, existing);
      }
      bump((n) => n + 1);
    })();

    return () => {
      cancelled = true;
    };
    // `gen` is a dep so an invalidation — which marks ids stale — actually refetches them here.
  }, [key, tick, gen]);

  return useMemo(() => {
    const out: Record<string, PublicLoadout> = {};
    for (const id of key ? key.split(',') : []) out[id] = cache.get(id) ?? {};
    // Last write wins on purpose: whatever the RPC said about you is overwritten by what you are
    // wearing right now. `mine` is a LoadoutItem map, which carries the rarity override and the
    // season stamp, so your own placement title keeps its colour and its "· S1" here.
    //
    // Guarded on the store being FED, not merely defined. It is `{}` from boot until the first
    // get_inventory lands, and substituting that would strip your own row back to the bare look for
    // the first second of every cold start — a new flicker traded for the stale one. An account
    // genuinely wearing nothing reads the same either way, since the RPC has nothing to say about
    // it either.
    if (me && me in out && Object.keys(mine).length > 0) out[me] = mine;
    return out;
    // `cache` is mutable module state; `tick` and `gen` are what re-run this after a fetch lands
    // and after an invalidation marked an entry stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, gen, me, mine]);
}

/** Single-user convenience for headers (1v1, challenge, profile-of-someone-else). */
export function usePublicLoadout(userId: string | null | undefined): PublicLoadout {
  const map = usePublicLoadouts([userId]);
  return userId ? (map[userId] ?? {}) : {};
}
