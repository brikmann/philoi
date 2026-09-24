import { useState } from 'react';

import { useGatedInterval } from '@/hooks/use-motion-active';
import { creditedSeconds, type LockInClock } from '@/lib/lock-in-clock';

// Ticks once a second purely to force a re-render — the returned value is always recomputed
// fresh from the session's clock vs. Date.now(), never a running counter of its own, so it can't
// drift across backgrounding, remounts, or navigation the way a plain setInterval counter
// would (PHILOI_UI_SPEC.md §5/§13's mini-map + running-session requirement).
//
// CREDITED seconds, not wall-clock (0218): paused time is subtracted, so the timer, the flare tier
// and every "Nm elapsed" line read the same number the server will pay at Stop, and the clock
// freezes while paused.
export function useElapsedSeconds(clock: LockInClock | null): number {
  const [now, setNow] = useState(() => Date.now());

  // Gated, because the drift-proofing described above is exactly what makes pausing free: the
  // returned value is recomputed from `Date.now()` on every render, so a second that passes with
  // the timer stopped is a second the clock already knows about the instant it starts again. The
  // session screen stays mounted under anything pushed over it, and a once-a-second re-render of
  // a screen behind another screen is the definition of work nobody asked for.
  //
  // It keeps ticking while PAUSED, deliberately. The frozen value doesn't need it, but resume does:
  // with the tick stopped, `now` would be the last pre-pause second, and the first render after
  // resume would subtract the whole pause from it — the clock visibly jumping backwards for a beat.
  useGatedInterval(() => setNow(Date.now()), 1000, clock !== null);

  return clock ? creditedSeconds(clock, now) : 0;
}
