import { useEffect, useState } from 'react';

// Ticks once a second purely to force a re-render — the returned value is always recomputed
// fresh from `startedAt` vs. Date.now(), never a running counter of its own, so it can't
// drift across backgrounding, remounts, or navigation the way a plain setInterval counter
// would (PHILOI_UI_SPEC.md §5/§13's mini-map + running-session requirement).
export function useElapsedSeconds(startedAt: Date | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return startedAt ? (now - startedAt.getTime()) / 1000 : 0;
}
