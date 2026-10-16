import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';
import { fetchMemeDropSchedule } from '@/lib/api/meme-drops';
import { featuredDrop, toDrops, type MemeDrop, type MemeDropRow } from '@/lib/economy/meme-drops';

/**
 * The Meme Monday schedule (0243) as the shop needs it: every drop this build can draw, the one to
 * feature right now, and a `now` that ticks every 30s so a countdown — and the flip from "locked"
 * to "live" — happens without a refetch. Refetched on focus; a failed read leaves the section out
 * rather than showing a broken one.
 */
export function useMemeDrops() {
  const [rows, setRows] = useState<MemeDropRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchMemeDropSchedule()
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch(() => {
          if (!cancelled) setRows((prev) => prev ?? []);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useGatedInterval(() => setNow(Date.now()), 30_000, rows !== null && rows.length > 0);

  const drops: MemeDrop[] = useMemo(() => toDrops(rows ?? []), [rows]);
  const featured = useMemo(() => featuredDrop(drops, now), [drops, now]);
  const byKey = useMemo(() => new Map(drops.map((d) => [d.item.id, d])), [drops]);

  return { loaded: rows !== null, drops, featured, byKey, now };
}
