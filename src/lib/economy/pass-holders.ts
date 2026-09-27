import { useEffect, useSyncExternalStore } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase';

// ── WHO OWNS THE FLAME PASS, for the burning name (LORE_EMBERFALL §"The burning name") ──
//
// A pass holder's display name renders on fire on every surface the campus sees it, which means
// knowing, for SOMEONE ELSE, a single boolean: do they own this season's pass. forge_pass_state is
// own-rows-only under RLS, so other people's answer comes from get_pass_holders (0220) — a set of
// ids and nothing else, no XP, no claims, no purchase date.
//
// ── BATCHED HERE, NOT AT THE LIST ──
//
// use-public-loadouts asks every list to batch its ids at the top and pass the result down. That
// was the right call for loadouts, but it would mean re-plumbing a prop through fifteen call sites
// for one boolean. So the batching lives in the store instead: every name that mounts in the same
// frame queues its id, and ONE request resolves the lot. A 30-row board is one round trip either
// way, and no caller has to know.
//
// ── YOUR OWN ANSWER NEVER WAITS ON THE RPC ──
//
// Right after a purchase the server row lands a beat after the charge (the RevenueCat webhook), and
// the first thing a buyer does is go and look at their own name. So your own status is fed from the
// inventory read — the same one that already confirms the grant on /purchase-success — and it
// overrides whatever the batch said about you.
//
// ── IT FAILS COLD ──
//
// If the read fails (offline, or a build that reached prod before 0220 did), everyone renders as a
// plain name. The burning name is decoration; a dropped request must never be the thing that stops
// a leaderboard from drawing, and it must never set a name on fire that isn't paid for.

/** How long an answer about someone else stays good. A pass is bought once a season, so this only
 *  needs to be short enough that a friend who just bought shows up on your board the same session. */
const TTL_MS = 10 * 60 * 1000;

type Entry = { holder: boolean; at: number };

const cache = new Map<string, Entry>();
const pending = new Set<string>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** userId → owns the pass, as the inventory last said. Wins over the cache for that one id. */
let self: { userId: string; holder: boolean } | null = null;

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readVersion(): number {
  return version;
}

function fresh(id: string): boolean {
  const e = cache.get(id);
  return e !== undefined && Date.now() - e.at < TTL_MS;
}

async function flush() {
  flushTimer = null;
  const ids = [...pending].filter((id) => !inFlight.has(id));
  pending.clear();
  if (ids.length === 0) return;
  for (const id of ids) inFlight.add(id);

  try {
    const { data, error } = await supabase.rpc('get_pass_holders', { p_user_ids: ids });
    const holders = new Set<string>(error ? [] : (data ?? []));
    const at = Date.now();
    // Every id asked for gets an answer, including a failure's "no" — otherwise a missing RPC would
    // be re-requested by every row on every render. The TTL is what retries it.
    for (const id of ids) cache.set(id, { holder: holders.has(id), at });
  } finally {
    for (const id of ids) inFlight.delete(id);
    emit();
  }
}

function request(id: string) {
  if (fresh(id) || inFlight.has(id) || pending.has(id)) return;
  pending.add(id);
  // One frame is long enough for a list's whole first paint to queue its ids.
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 16);
}

/**
 * Fed by every inventory read (useInventory, LoadoutSync). This is the buyer's own name catching
 * fire the moment the webhook lands, rather than whenever the TTL next expires.
 */
export function setOwnPassHolder(userId: string, holder: boolean): void {
  if (self?.userId === userId && self.holder === holder) return;
  self = { userId, holder };
  emit();
}

/** Sign-out. Without it the next account on this device would inherit the last one's fire. */
export function clearPassHolders(): void {
  self = null;
  cache.clear();
  emit();
}

function read(id: string): boolean {
  if (self?.userId === id) return self.holder;
  return cache.get(id)?.holder ?? false;
}

/** Whether `userId`'s name should burn. `false` until known — a name never flickers ON by mistake. */
export function usePassHolder(userId: string | null | undefined): boolean {
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  // The version is a dep below so an answer that has aged past the TTL is re-asked the next time
  // anything in the store moves, rather than only when this row happens to remount.
  const v = useSyncExternalStore(subscribe, readVersion, readVersion);

  useEffect(() => {
    // Your own answer comes from the inventory, so there is nothing to ask the server for — unless
    // no inventory read has run yet this session, in which case the batch is the fastest answer.
    if (!userId || (userId === me && self?.userId === me)) return;
    request(userId);
  }, [userId, me, v]);

  return userId ? read(userId) : false;
}
