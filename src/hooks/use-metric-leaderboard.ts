import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMetricCatalog, fetchMetricLeaderboard } from '@/lib/api/stats';
import { getErrorMessage } from '@/lib/errors';
import type { MetricCatalogRow, MetricLeaderboardRow, MetricScope, MetricWindow } from '@/types/house';

// One board on get_metric_leaderboard (0265) — the Fitness board, an exercise board, and the
// Leaderboard tab's "My program" house board all read through this. Every argument is part of the
// key: changing the metric, scope or filter re-ranks live.
//
// Pass `metric: null` to hold the fetch (the Fitness board waits for the catalog to name its
// default stat; the house board waits until the viewer has a program).
export function useMetricLeaderboard({
  metric,
  scope,
  window,
  limit = null,
  verifiedOnly = false,
  includeUnranked = false,
}: {
  metric: string | null;
  scope: MetricScope;
  window: MetricWindow;
  limit?: number | null;
  verifiedOnly?: boolean;
  /** 0276 — append everyone in scope with nothing logged (rank null). */
  includeUnranked?: boolean;
}) {
  const [rows, setRows] = useState<MetricLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(metric !== null);
  const [error, setError] = useState<string | null>(null);
  // Flipping scopes quickly fires overlapping requests; only the newest one may land, or a slow
  // Global answer would paint over the Friends board you switched to.
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    if (!metric) {
      setRows([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      setError(null);
      const next = await fetchMetricLeaderboard({ metric, scope, window, limit, verifiedOnly, includeUnranked });
      if (mine === seq.current) setRows(next);
    } catch (e) {
      if (mine === seq.current) {
        setRows([]);
        setError(getErrorMessage(e, 'Could not load this board.'));
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [metric, scope, window, limit, verifiedOnly, includeUnranked]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-change, no caching layer to defer to
    refetch();
  }, [refetch]);

  return { rows, loading, error, refetch };
}

// The 26-stat library rarely changes, so one read per process is plenty; every board screen shares it.
let catalogCache: MetricCatalogRow[] | null = null;

/** metric_catalog (0265), in display order. */
export function useMetricCatalog() {
  const [catalog, setCatalog] = useState<MetricCatalogRow[]>(catalogCache ?? []);
  const [loading, setLoading] = useState(catalogCache === null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchMetricCatalog();
      catalogCache = next;
      setCatalog(next);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the stat library.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (catalogCache) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, cached for the process after
    refetch();
  }, [refetch]);

  return { catalog, loading, error, refetch };
}
