import { useEffect, useState } from 'react';

import { BUNDLED_SEASON_WINDOW, fetchSeasonWindow, phaseOf, type SeasonWindow } from '@/lib/api/season';
import type { SeasonPhase } from '@/lib/economy/forge-pass';

// The season window as the SERVER holds it, with the bundled copy as first paint. Anything that
// prints the season's dates or a countdown reads this rather than forge-pass.ts's constant, so a
// retuned window reaches installed builds without a release.

export type SeasonState = SeasonWindow & {
  phase: SeasonPhase;
  /** The clock the phase was computed against — callers derive countdowns from it, not Date.now(),
   *  so the phase and the "N days left" next to it can never disagree within a render. */
  now: number;
  source: 'server' | 'bundled';
};

// One read per session, shared across every surface. A failure clears it so the next mount retries
// rather than caching the outage.
let inFlight: Promise<SeasonWindow> | null = null;
let resolved: SeasonWindow | null = null;

function loadSeasonWindow(): Promise<SeasonWindow> {
  inFlight ??= fetchSeasonWindow()
    .then((w) => {
      resolved = w;
      return w;
    })
    .catch((e: unknown) => {
      inFlight = null;
      throw e;
    });
  return inFlight;
}

// A minute is finer than anything on screen (days, and the phase boundary), and coarse enough to
// cost nothing. It is what flips a splash to the claim window — or off — on a phone left open.
const TICK_MS = 60_000;

export function useSeason(): SeasonState {
  const [win, setWin] = useState<SeasonWindow | null>(resolved);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resolved) return;
    let cancelled = false;
    loadSeasonWindow()
      .then((w) => {
        if (!cancelled) setWin(w);
      })
      .catch(() => {
        // The bundled window stands in — a season banner is not worth an error state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const w = win ?? BUNDLED_SEASON_WINDOW;
  return {
    ...w,
    phase: phaseOf(w, now),
    now,
    source: win ? 'server' : 'bundled',
  };
}
