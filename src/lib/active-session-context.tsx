import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchGroup } from '@/lib/api/groups';
import { fetchMyActiveLockInSession, startLockInSession } from '@/lib/api/lock-ins';
import { useAuth } from '@/lib/auth/auth-context';
import type { GoalType } from '@/types/database';

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
  mode: ActiveSessionMode;
};

type ActiveSessionContextValue = {
  session: ActiveSession | null;
  /** True until the initial fetch-on-launch resolves — distinct from any single screen's own loading state. */
  loading: boolean;
  refresh: () => Promise<void>;
  start: (goalType: GoalType, goalDetail?: string | null, circleId?: string | null) => Promise<ActiveSession>;
  /** Called right after a successful stop — the session is done server-side, so every
   * consumer (mini-map, home) should reflect "no active session" immediately rather than
   * waiting for the next refresh(). */
  clear: () => void;
  touchConfirmedAt: () => void;
};

const ActiveSessionContext = createContext<ActiveSessionContextValue | null>(null);

function modeFor(goalType: GoalType): ActiveSessionMode {
  return goalType === 'gym' ? 'gym' : 'lockin';
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
      setSession({
        id: active.id,
        goalType: active.goal_type,
        goalDetail: active.goal_detail,
        circleId: active.circle_id,
        circleName,
        startedAt: new Date(active.started_at),
        lastConfirmedAt: new Date(active.last_confirmed_at),
        mode: modeFor(active.goal_type),
      });
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

  const start = useCallback(async (goalType: GoalType, goalDetail?: string | null, circleId?: string | null) => {
    const created = await startLockInSession(goalType, goalDetail, circleId);
    const circleName = await resolveCircleName(created.circle_id);
    const next: ActiveSession = {
      id: created.id,
      goalType: created.goal_type,
      goalDetail: created.goal_detail,
      circleId: created.circle_id,
      circleName,
      startedAt: new Date(created.started_at),
      lastConfirmedAt: new Date(created.last_confirmed_at),
      mode: modeFor(created.goal_type),
    };
    setSession(next);
    return next;
  }, []);

  const clear = useCallback(() => setSession(null), []);

  const touchConfirmedAt = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, lastConfirmedAt: new Date() } : prev));
  }, []);

  const value = useMemo(
    () => ({ session, loading, refresh, start, clear, touchConfirmedAt }),
    [session, loading, refresh, start, clear, touchConfirmedAt]
  );

  return <ActiveSessionContext.Provider value={value}>{children}</ActiveSessionContext.Provider>;
}

export function useActiveSession() {
  const ctx = useContext(ActiveSessionContext);
  if (!ctx) throw new Error('useActiveSession must be used within an ActiveSessionProvider');
  return ctx;
}
