import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchGroup } from '@/lib/api/groups';
import {
  fetchMyActiveLockInSession,
  pauseLockInSession,
  resumeLockInSession,
  startLockInSession,
} from '@/lib/api/lock-ins';
import { useAuth } from '@/lib/auth/auth-context';
import type { FitnessActivity, GoalType, LockInCategory, LockInSession } from '@/types/database';

// No dedicated gym-routine logger exists yet (the mini-map spec calls for tapping a gym
// lock-in to open one) — 'mode' is tracked here so that routing hook is already in place;
// today both modes resolve to the same running-session screen (see live-session-bar.tsx).
export type ActiveSessionMode = 'gym' | 'lockin';

export type ActiveSession = {
  id: string;
  goalType: GoalType;
  goalDetail: string | null;
  circleId: string | null;
  circleName: string | null;
  startedAt: Date;
  lastConfirmedAt: Date;
  /** When the current pause began (server clock), or null while running (0218). */
  pausedAt: Date | null;
  /** Seconds of completed pauses. With startedAt/pausedAt this is a LockInClock (lib/lock-in-clock). */
  accumulatedPausedSeconds: number;
  mode: ActiveSessionMode;
};

type ActiveSessionContextValue = {
  session: ActiveSession | null;
  /** True until the initial fetch-on-launch resolves — distinct from any single screen's own loading state. */
  loading: boolean;
  refresh: () => Promise<void>;
  start: (
    goalType: GoalType,
    goalDetail?: string | null,
    circleId?: string | null,
    /** The two-tap choice (0182). Optional so nothing that already calls start() breaks; when
     *  absent the server derives it from goalType, which is what installed builds rely on. */
    two?: { category: LockInCategory; activity?: FitnessActivity | null; courseId?: string | null }
  ) => Promise<ActiveSession>;
  /** Called right after a successful stop — the session is done server-side, so every
   * consumer (mini-map, home) should reflect "no active session" immediately rather than
   * waiting for the next refresh(). */
  clear: () => void;
  touchConfirmedAt: () => void;
  /** Pause / resume the running session (0218). The context flips first so the clock freezes on
   *  the tap, then settles on the server's row; a failed call puts the old state back and throws. */
  pause: () => Promise<void>;
  resume: () => Promise<void>;
};

const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(null);

function modeFor(goalType: GoalType): ActiveSessionMode {
  return goalType === 'gym' ? 'gym' : 'lockin';
}

function fromRow(row: LockInSession, circleName: string | null): ActiveSession {
  return {
    id: row.id,
    goalType: row.goal_type,
    goalDetail: row.goal_detail,
    circleId: row.circle_id,
    circleName,
    startedAt: new Date(row.started_at),
    lastConfirmedAt: new Date(row.last_confirmed_at),
    pausedAt: row.paused_at ? new Date(row.paused_at) : null,
    accumulatedPausedSeconds: row.accumulated_paused_seconds ?? 0,
    mode: modeFor(row.goal_type),
  };
}

/** Only the pause-owned fields move — the rest of the object (circleName above all, which is a
 *  separate fetch) stays as it was. */
function withPauseState(prev: ActiveSession, row: LockInSession): ActiveSession {
  return {
    ...prev,
    lastConfirmedAt: new Date(row.last_confirmed_at),
    pausedAt: row.paused_at ? new Date(row.paused_at) : null,
    accumulatedPausedSeconds: row.accumulated_paused_seconds ?? 0,
  };
}

async function resolveCircleName(circleId: string | null): Promise<string | null> {
  if (!circleId) return null;
  return fetchGroup(circleId)
    .then((g) => g.name)
    .catch(() => null);
}

// The single source of truth for "is a lock-in running right now, and what is it" —
// PHILOI_UI_SPEC.md §5/§13: the mini-map, the home tab, and the running-session screen all
// read from this one context instead of each independently fetching/tracking session state.
export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const { session: authSession } = useAuth();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!authSession) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const active = await fetchMyActiveLockInSession(authSession.user.id);
      if (!active) {
        setSession(null);
        return;
      }
      const circleName = await resolveCircleName(active.circle_id);
      // Pause state comes back with the row, so a kill-while-paused reopens still paused, on the
      // same accumulated total — the server row is the source of truth, not anything local.
      setSession(fromRow(active, circleName));
    } catch {
      // Ambient state — a failed fetch just leaves the mini-map/home in their default,
      // no-active-session look rather than surfacing an error.
    } finally {
      setLoading(false);
    }
  }, [authSession]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const start = useCallback(
    async (
      goalType: GoalType,
      goalDetail?: string | null,
      circleId?: string | null,
      two?: { category: LockInCategory; activity?: FitnessActivity | null; courseId?: string | null }
    ) => {
    const created = await startLockInSession(goalType, goalDetail, circleId, two);
    const circleName = await resolveCircleName(created.circle_id);
    const next = fromRow(created, circleName);
    setSession(next);
    return next;
  }, []);

  const clear = useCallback(() => setSession(null), []);

  const touchConfirmedAt = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, lastConfirmedAt: new Date() } : prev));
  }, []);

  // Optimistic on the way in: the tap has to freeze the clock on the second it lands, not ~200ms
  // later when the RPC answers. The server row then replaces the guess (its paused_at is on the
  // same clock as started_at), and a failure restores exactly what was there before.
  const setPaused = useCallback(async (paused: boolean) => {
    const current = session;
    if (!current || (current.pausedAt !== null) === paused) return;
    setSession((prev) =>
      prev && prev.id === current.id
        ? paused
          ? { ...prev, pausedAt: new Date() }
          : {
              ...prev,
              pausedAt: null,
              accumulatedPausedSeconds:
                prev.accumulatedPausedSeconds + Math.max(0, (Date.now() - (prev.pausedAt?.getTime() ?? Date.now())) / 1000),
            }
        : prev
    );
    try {
      const row = paused ? await pauseLockInSession(current.id) : await resumeLockInSession(current.id);
      setSession((prev) => (prev && prev.id === row.id ? withPauseState(prev, row) : prev));
    } catch (e) {
      setSession((prev) => (prev && prev.id === current.id ? current : prev));
      throw e;
    }
  }, [session]);

  const pause = useCallback(() => setPaused(true), [setPaused]);
  const resume = useCallback(() => setPaused(false), [setPaused]);

  const value = useMemo(
    () => ({ session, loading, refresh, start, clear, touchConfirmedAt, pause, resume }),
    [session, loading, refresh, start, clear, touchConfirmedAt, pause, resume]
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession() {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) throw new Error('useActiveSession must be used within an ActiveSessionProvider');
  return ctx;
}
