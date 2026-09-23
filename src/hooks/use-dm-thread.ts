import { useCallback, useEffect, useState } from 'react';

import {
  fetchDmMessages,
  markDmRead,
  openDmThread,
  subscribeToDmThread,
  type DmThreadMessage,
} from '@/lib/api/dm';
import { getErrorMessage } from '@/lib/errors';

/** What a resolve produced, TAGGED WITH THE FRIEND IT WAS FOR — see the note in the hook. */
type Resolved =
  | { friendId: string; threadId: string; error: null }
  | { friendId: string; threadId: null; error: string };

/**
 * The 1:1 thread with one friend — useChat's twin, with the one extra step a DM needs.
 *
 * useChat is handed a groupId and can query immediately. A DM is keyed on a thread the server has
 * to resolve from the friend pair, and that id is also what the realtime subscription filters on —
 * so this hook is two phases: resolve, then the same fetch/subscribe/refetch loop.
 *
 * The resolve is where the guardrails surface. `dm_open_thread` throws for a non-friend, a blocked
 * pair or yourself, and that message is the screen's whole content in those cases — a DM you are
 * not allowed to have should say so, not render an empty thread with a dead composer.
 *
 * ── Why the resolve is stored tagged with its friendId ──
 *
 * The obvious shape is `useState<string | null>(threadId)` reset at the top of the effect. That
 * reset is a synchronous setState inside an effect, which is both a lint error here and a real
 * cascading render — but the deeper problem is that it only LOOKS like it prevents a stale read.
 * Between the friendId changing and the reset committing there is a render in which the old
 * thread's id is paired with the new friend's name, and that render is enough to fire a subscribe
 * and a mark-read against the wrong conversation.
 *
 * Storing `{ friendId, threadId }` together and comparing on read makes a stale pairing
 * unrepresentable rather than merely unlikely: a resolve for the previous friend can never be
 * mistaken for this one's, so nothing needs to be cleared on the way in.
 */
export function useDmThread(friendId: string | undefined) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [messages, setMessages] = useState<DmThreadMessage[]>([]);
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Only ever this friend's resolve. Anything else reads as "not resolved yet".
  const current = resolved && resolved.friendId === friendId ? resolved : null;
  const threadId = current?.threadId ?? null;

  useEffect(() => {
    if (!friendId) return;
    // `cancelled` is scoped to THIS effect run, so the cleanup that fires when friendId changes
    // only ever disarms its own in-flight resolve. A ref shared across runs is the bug that froze
    // the gym lock-in: cleanup runs on every dep change, not just unmount.
    let cancelled = false;
    openDmThread(friendId)
      .then((id) => {
        if (!cancelled) setResolved({ friendId, threadId: id, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setResolved({ friendId, threadId: null, error: getErrorMessage(e, 'Could not open this conversation.') });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [friendId]);

  const refetch = useCallback(async () => {
    if (!threadId) return;
    try {
      setFetchError(null);
      setMessages(await fetchDmMessages(threadId));
    } catch (e) {
      setFetchError(getErrorMessage(e, 'Could not load this conversation.'));
    } finally {
      setLoadedThreadId(threadId);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to (same as use-chat)
    refetch();
    // Reading is what re-arms the other side's notification: dm_send rings the bell only when
    // there is no unread dm_received row for this thread already waiting.
    markDmRead(threadId).catch(() => {});
  }, [threadId, refetch]);

  useEffect(() => {
    if (!threadId) return;
    return subscribeToDmThread(threadId, () => {
      refetch();
      // Again on every arrival, not just on open — a thread left in the foreground would otherwise
      // go permanently silent for the sender after the first unread message.
      markDmRead(threadId).catch(() => {});
    });
  }, [threadId, refetch]);

  return {
    threadId,
    messages: loadedThreadId === threadId ? messages : [],
    // Loading until this friend's thread has both resolved AND had its first fetch land. Derived
    // rather than stored, so it cannot disagree with what the screen is actually showing.
    loading: current === null || (threadId !== null && loadedThreadId !== threadId),
    error: current?.error ?? fetchError,
    refetch,
  };
}
