import type { LockInSession } from '@/types/database';

// The one client-side definition of "how long has this lock-in run", mirroring the server's
// lock_in_credited_seconds (migration 0218) exactly:
//
//   credited = (now − started) − completed pauses − (paused ? now − paused_at : 0)
//
// Paused time is not focus. Every timer, flare tier, aura and "Nm in" line reads through here, so
// the clock on screen freezes on the same second the server stops crediting — and what the done
// screen shows is what the server paid, not a wall-clock that kept climbing through a break.

export type LockInClock = {
  startedAt: Date;
  /** When the current pause began, or null while running. */
  pausedAt: Date | null;
  accumulatedPausedSeconds: number;
};

export function creditedSeconds(clock: LockInClock, nowMs: number = Date.now()): number {
  const until = clock.pausedAt ? Math.min(nowMs, clock.pausedAt.getTime()) : nowMs;
  return Math.max(0, (until - clock.startedAt.getTime()) / 1000 - clock.accumulatedPausedSeconds);
}

/**
 * The instant a running clock would read 0:00 from — the session start pushed forward by every
 * completed pause. The out-of-app surfaces count up from this by themselves (the OS owns the tick),
 * so resuming moves the anchor rather than sending elapsed time.
 */
export function clockAnchorMs(clock: LockInClock): number {
  return clock.startedAt.getTime() + clock.accumulatedPausedSeconds * 1000;
}

/** For rows read straight off lock_in_sessions (another user's session in a body-double strip). */
export function clockFromRow(
  row: Pick<LockInSession, 'started_at' | 'paused_at' | 'accumulated_paused_seconds'>
): LockInClock {
  return {
    startedAt: new Date(row.started_at),
    pausedAt: row.paused_at ? new Date(row.paused_at) : null,
    // `?? 0` for a row cached from before 0218 existed — it reads as never paused, which it was.
    accumulatedPausedSeconds: row.accumulated_paused_seconds ?? 0,
  };
}
