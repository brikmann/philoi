// "Something just paid the user — every visible balance is now wrong."
//
// 🐛 WHAT THIS FIXES. `EmberPill` is prop-fed: it renders whatever number its parent happened to
// fetch. Every parent gets that number from `useInventory`, and `useInventory` is a plain per-
// component `useState` refreshed by `useFocusEffect` — one independent copy per mounting screen,
// with nothing connecting them. That is fine for the flows it was built for (buying, opening,
// equipping all navigate, so focus IS the invalidation), and wrong for every grant that happens
// while you are standing still: finish a goal and the server pays you, but the pill on screen keeps
// showing the pre-payout figure until something remounts it. Noah's report was exactly this —
// "the ember balance doesn't update until a reload".
//
// A tiny pub/sub rather than a store, deliberately. The callers that move embers are plain async
// modules (lib/api/challenges.ts, the settlement reveal), not components, so they cannot reach a
// context — the same reason `requestRankRecheck` in lib/rank-watch.ts is shaped this way, and this
// is its counterpart for the wallet. Every mounted `useInventory` subscribes and refetches, so all
// of them — the shop pill, the inventory pill, the Flame Pass pill, the lock-in wallet — land on
// the same new figure at the same time.
//
// 🔒 THIS GRANTS NOTHING AND ADDS NOTHING LOCALLY. It only asks the existing read (get_inventory)
// to run again, so what appears is always the ledger's number. A reveal that incremented a local
// count would eventually disagree with the server, and the server is what actually moved.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Refetch on every ember/box/badge grant. Returns the unsubscribe, for a useEffect cleanup. */
export function subscribeToInventoryRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Call after ANY action that moved the wallet or the inventory server-side — a goal-day payout, a
 * challenge settlement reveal, a box opening.
 *
 * Cheap and safe to over-call: each listener is one `get_inventory` round trip, and a refresh that
 * finds the same number simply re-renders the same digits. Never call it *before* the grant has
 * resolved — the read would race the write and re-show the old balance.
 */
export function requestInventoryRefresh(): void {
  listeners.forEach((listener) => listener());
}
