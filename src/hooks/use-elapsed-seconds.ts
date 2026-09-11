import { useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';

// Ticks once a second purely to force a re-render — the returned value is always recomputed
// fresh from `startedAt` vs. Date.now(), never a running counter of its own, so it can't
// drift across backgrounding, remounts, or navigation the way a plain setInterval counter
// would (PHILOI_UI_SPEC.md §5/§13's mini-map + running-session requirement).
export function useElapsedSeconds(startedAt: Date | null): number {
  const [now, setNow] = useState(() => Date.now());

  // Gated, because the drift-proofing described above is exactly what makes pausing free: the
  // returned value is recomputed from `Date.now()` on every render, so a second that passes with
  // the timer stopped is a second the clock already knows about the instant it starts again. The
  // session screen stays mounted under anything pushed over it, and a once-a-second re-render of
  // a screen behind another screen is the definition of work nobody asked for.
  useGatedInterval(() => setNow(Date.now()), 1000, startedAt !== null);

  return startedAt ? (now - startedAt.getTime()) / 1000 : 0;
}
