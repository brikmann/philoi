import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAgoraFeed } from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem, AgoraScope } from '@/types/database';

// The square's data. One scope at a time, keyset-paginated.
//
// Deliberately NOT cached across scopes. Switching Friends → Global and back re-fetches, because
// the alternative is showing a stale page while the live one loads underneath it, and the whole
// promise of a feed is that what you are looking at is what is there now.

const PAGE = 20;

/** One stable empty array, so "no rows yet" isn't a new identity on every render. */
const NO_ITEMS: AgoraItem[] = [];

/**
 * What is loaded, TAGGED WITH THE SCOPE IT BELONGS TO — including the error, if the load failed.
 *
 * Everything this hook exposes is then derived from whether that tag matches the scope being
 * asked for. Carrying the scope in the state rather than clearing the list from an effect is what
 * keeps the switch honest: "these rows are Friends' rows" is a fact about the data, so a scope
 * change makes them stale by derivation — no reset to run, and no frame where the previous
 * scope's posts sit on screen under the new scope's chip.
 *
 * It also means nothing is assigned before the fetch resolves — no reset, no "loading" flag set on
 * the way in. (The rule's disable below is the codebase's standard fetch-on-mount one; the lint
 * cannot see that every setState in loadFirstPage sits after an await.) Clearing state
 * synchronously from an effect is the cascading-render pattern that rule exists to catch, and in
 * this codebase it is the shape of the bug that froze the gym lock-in.
 */
type Page = { scope: AgoraScope; items: AgoraItem[]; exhausted: boolean; error: string | null };

export function useAgoraFeed(scope: AgoraScope) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [page, setPage] = useState<Page | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // A page tagged with a different scope is not this scope's data — it is nothing yet.
  const current = page && page.scope === scope ? page : null;
  const items = current?.items ?? NO_ITEMS;
  const exhausted = current?.exhausted ?? false;
  const error = current?.error ?? null;
  const loading = current === null;

  /**
   * Which fetch is allowed to write state.
   *
   * A scope switch mid-flight is the common case here — the chips are one tap apart and the
   * network is not instant. Without this, tapping Friends → Global → Friends can land Global's
   * page into Friends' list, and the feed shows posts the current filter says are not in it.
   */
  const runId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    if (!userId) return;
    const run = (runId.current += 1);
    try {
      const rows = await fetchAgoraFeed(scope, null, PAGE);
      if (run !== runId.current) return;
      setPage({ scope, items: rows, exhausted: rows.length < PAGE, error: null });
    } catch (e) {
      if (run !== runId.current) return;
      // The failure is tagged with its scope too. An untagged error would leave the list reading
      // as permanently loading, since `loading` is "no page for this scope yet".
      setPage({
        scope,
        items: [],
        exhausted: true,
        error: getErrorMessage(e, 'Could not load the Agora.'),
      });
    }
  }, [scope, userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    void loadFirstPage();
  }, [loadFirstPage]);

  /** Pull-to-refresh. Called from a handler, so the spinner may be set up front. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!userId || loading || loadingMore || exhausted || items.length === 0) return;
    const run = runId.current;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const rows = await fetchAgoraFeed(scope, { created_at: last.created_at, id: last.id }, PAGE);
      if (run !== runId.current) return;
      setPage((prev) => {
        // The scope may have changed between the request and its answer; appending then would
        // splice Friends' page 2 onto Global's page 1.
        if (!prev || prev.scope !== scope) return prev;
        // De-duped on append. The cursor is strict, so this should never fire — but a post landing
        // exactly on the boundary is the one case where it would, and a duplicate key in a
        // FlatList is a rendering bug rather than a cosmetic one.
        const seen = new Set(prev.items.map((i) => `${i.item_type}:${i.id}`));
        return {
          ...prev,
          items: [...prev.items, ...rows.filter((i) => !seen.has(`${i.item_type}:${i.id}`))],
          exhausted: rows.length < PAGE,
        };
      });
    } catch {
      // Ambient: a failed NEXT page leaves the pages you already have. Surfacing an error banner
      // over a working feed because page 3 timed out is worse than the feed just ending.
      setPage((prev) => (prev && prev.scope === scope ? { ...prev, exhausted: true } : prev));
    } finally {
      if (run === runId.current) setLoadingMore(false);
    }
  }, [exhausted, items, loading, loadingMore, scope, userId]);

  /** Cheer/comment counts change on one card; re-fetching the page to show it would lose scroll. */
  const patchItem = useCallback((id: string, patch: Partial<AgoraItem>) => {
    setPage((prev) =>
      prev ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : prev
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setPage((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));
  }, []);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    exhausted,
    error,
    refresh,
    loadMore,
    patchItem,
    removeItem,
  };
}
