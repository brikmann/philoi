import { useEffect } from 'react';
import { Easing, cancelAnimation, makeMutable, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

// ── ONE DRIVER PER CADENCE, NOT ONE PER ROW ──
//
// The applied cosmetics (a flare's signature marks, a premium halo's spin, a card's hot layer) run
// on list rows: a leaderboard holds thirty avatars, the Agora a page of cards. Each of those running
// its own `withRepeat` would be thirty drivers for what is, per cadence, the same 0 -> 1 ramp. So a
// cadence gets ONE module-level clock, shared by every mount that asks for it, and each consumer
// derives its own motion from it on the UI thread (`(clock * mult + phase) % 1`). That is item-art's
// float clock generalised to more than one duration.
//
// The clock runs linear 0 -> 1 and snaps back. Every consumer multiplies it by a WHOLE number, so
// its own loop is at the same point at 0 and at 1 and the snap is invisible.
//
// It is cancelled when its last user unmounts or goes still, so a screen with no animated cosmetic
// is not paying for a timer. Consumers that are not animating must not even mount the hook's reader
// — see the static branches in public-identity / applied-art.

type Clock = { sv: SharedValue<number>; users: number };

const clocks = new Map<number, Clock>();

function clockFor(ms: number): Clock {
  let clock = clocks.get(ms);
  if (!clock) {
    clock = { sv: makeMutable(0), users: 0 };
    clocks.set(ms, clock);
  }
  return clock;
}

/** A shared 0 -> 1 linear loop of `ms` milliseconds, running while at least one `active` caller holds it. */
export function useCosmeticClock(ms: number, active: boolean): SharedValue<number> {
  const sv = clockFor(ms).sv;

  useEffect(() => {
    if (!active) return;
    const clock = clockFor(ms);
    clock.users += 1;
    if (clock.users === 1) {
      clock.sv.value = 0;
      clock.sv.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.linear }), -1, false);
    }
    return () => {
      clock.users -= 1;
      if (clock.users === 0) cancelAnimation(clock.sv);
    };
  }, [ms, active]);

  return sv;
}

/**
 * The lightning flash — 0% dark, 5% full, 11% almost out, 18% full again, 30% dark, then a long dark
 * tail. The same double strike FlarePerimeter's useFlash runs, as a pure curve so it can be read off
 * a shared clock instead of needing a driver of its own.
 */
export function flashCurve(t: number): number {
  'worklet';
  if (t < 0.05) return t / 0.05;
  if (t < 0.11) return 1 - (0.9 * (t - 0.05)) / 0.06;
  if (t < 0.18) return 0.1 + (0.85 * (t - 0.11)) / 0.07;
  if (t < 0.3) return 0.95 * (1 - (t - 0.18) / 0.12);
  return 0;
}
