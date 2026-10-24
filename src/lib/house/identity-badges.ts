import { useEffect, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import type { IdentityBadge } from '@/types/house';

// ── THE IDENTITY STACK, FOR SOMEONE ELSE (mock 288) ──
//
// "Heir to Heracles · Kin · Laurier" beside a name needs three things about another person: their
// house, their program's short label and their school. get_identity_badges (0264) answers that for
// up to 200 ids at once. Same shape as lib/economy/pass-holders: every row that mounts in a frame
// queues its id and ONE request resolves the lot, so no list has to re-plumb a prop.
//
// It fails cold. Before 0264 is live (or offline) a name simply renders with no stack under it.

const TTL_MS = 10 * 60 * 1000;
const BATCH_MAX = 200;

type Entry = { badge: IdentityBadge | null; at: number };

const cache = new Map<string, Entry>();
const pending = new Set<string>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

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
  const ids = [...pending].filter((id) => !inFlight.has(id)).slice(0, BATCH_MAX);
  for (const id of ids) pending.delete(id);
  if (pending.size > 0) flushTimer = setTimeout(() => void flush(), 16);
  if (ids.length === 0) return;
  for (const id of ids) inFlight.add(id);

  try {
    const { data, error } = await supabase.rpc('get_identity_badges', { p_user_ids: ids });
    const byId = new Map<string, IdentityBadge>((error ? [] : (data ?? [])).map((b) => [b.user_id, b]));
    const at = Date.now();
    // Every id gets an answer, a failure's included, so a missing RPC isn't re-asked every render.
    for (const id of ids) cache.set(id, { badge: byId.get(id) ?? null, at });
  } finally {
    for (const id of ids) inFlight.delete(id);
    emit();
  }
}

function request(id: string) {
  if (fresh(id) || inFlight.has(id) || pending.has(id)) return;
  pending.add(id);
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 16);
}

/** After you pick or change your own program, so your own stack updates without waiting the TTL. */
export function invalidateIdentityBadge(userId: string): void {
  cache.delete(userId);
  emit();
}

/** Sign-out. */
export function clearIdentityBadges(): void {
  cache.clear();
  emit();
}

/** `userId`'s house · program · school, or null until known (or when they have none). */
export function useIdentityBadge(userId: string | null | undefined): IdentityBadge | null {
  const v = useSyncExternalStore(subscribe, readVersion, readVersion);
  useEffect(() => {
    if (userId) request(userId);
  }, [userId, v]);
  return userId ? (cache.get(userId)?.badge ?? null) : null;
}
