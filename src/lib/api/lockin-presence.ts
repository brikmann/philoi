import { supabase } from '@/lib/supabase';
import type { LockInPresence, LockInPresenceCounts } from '@/types/database';

/**
 * The live "locked in with you" count (CODE_PROMPT_live_presence_counter.md, migration 0184).
 *
 * ── THE ONE THING TO KNOW BEFORE CHANGING ANYTHING HERE ────────────────────────────────────
 *
 * This client decides NOTHING about the number. Not the window, not the scope, not whether it is
 * shown at all. `get_active_lockin_counts` returns a fully-resolved answer — "1,204, today, at
 * your campus, show it" or "don't show a number, show the be-first line" — and the pill renders
 * exactly that.
 *
 * That is not ceremony. The number's whole value is that it is TRUE, and the two ways it stops
 * being true are (a) a client that widens the window without widening the label with it and
 * (b) a threshold that lives in a build and therefore cannot be moved on the day density
 * arrives. Keeping the brain server-side closes both. If you find yourself wanting a count here
 * to do arithmetic on, the thing to add is a field to the RPC.
 */

/** Fetched once the moment the pill mounts, then every ~45s while the screen is focused. */
export async function fetchLockInPresence(): Promise<LockInPresence> {
  const { data, error } = await supabase.rpc('get_active_lockin_counts');
  if (error) throw error;
  return data;
}

/**
 * "I am still here." Every ~45s while locked in AND foregrounded; the server reaps anything that
 * has not beaten in 90s.
 *
 * Takes the session id and nothing else on purpose — the server reads the category off the row
 * rather than believing the caller, so there is no shape of request this function could make that
 * would put someone in the wrong count.
 */
export async function beatLockInPresence(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('beat_lockin_presence', { p_session_id: sessionId });
  if (error) throw error;
}

/**
 * The goodbye, sent when the session ends or the screen goes away.
 *
 * Best-effort by design: the count does not depend on it arriving. The server's reaper is what
 * actually guarantees a leave, because a force-quit, a flat battery and a tunnel all look exactly
 * like this call never happening. This just turns "they stopped" into a decrement on the next
 * 30s tick instead of up to 90s later.
 */
export async function endLockInPresence(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('end_lockin_presence', { p_session_id: sessionId });
  if (error) throw error;
}

/**
 * The coalesced aggregate broadcast — ONE message per 30s wall-clock tick, to the whole channel,
 * only when the number changed.
 *
 * 🔴 This is deliberately not Realtime Presence. Presence fans a full roster diff out to every
 * subscriber on every join and leave, which at a few thousand concurrent lock-ins is hundreds of
 * millions of messages a month for a number that is four integers wide. Here the server keeps the
 * count and every subscriber receives the same single message at the same instant. Quiet periods
 * cost nothing at all.
 *
 * `topic` always comes from the RPC and is never built here: the campus topic is a hash, which is
 * what keeps the channel list from enumerating which universities are on Philoi.
 */
export function subscribeToLockInPresence(
  topic: string,
  onCounts: (counts: LockInPresenceCounts) => void
): () => void {
  const channel = supabase
    .channel(topic)
    .on('broadcast', { event: 'counts' }, ({ payload }) => {
      onCounts(payload as LockInPresenceCounts);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Which field of a broadcast this member's line is reading.
 *
 * The keys OVERLAP, and that is the honest part: 'gym' is strength only (the specific, relatable
 * room) while 'fitness' is cardio and strength together (the wider number, because there is no
 * truthful way to make a cardio-only count bigger than it is). Must stay in step with
 * `lockin_key_matches` in 0184 — a drift here shows a member the wrong room's number rather than
 * an error.
 */
export function presenceCountFor(key: LockInPresence['key'], counts: LockInPresenceCounts): number {
  if (key === 'study') return counts.study;
  if (key === 'gym') return counts.strength;
  return counts.fitness;
}
