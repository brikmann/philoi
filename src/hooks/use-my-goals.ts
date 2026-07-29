import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchMyGoals } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Goal } from '@/types/database';

export type MyGoal = Goal & { checked_in_today: boolean };

export function useMyGoals() {
  const { session } = useAuth();
  const [goals, setGoals] = useState<MyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const rawGoals = await fetchMyGoals(session.user.id);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data: todaysCheckIns, error: checkInsError } = await supabase
        .from('check_ins')
        .select('goal_id')
        .eq('user_id', session.user.id)
        .gte('created_at', startOfDay.toISOString());
      if (checkInsError) throw checkInsError;

      const checkedInGoalIds = new Set((todaysCheckIns ?? []).map((c) => c.goal_id));
      setGoals(rawGoals.map((g) => ({ ...g, checked_in_today: checkedInGoalIds.has(g.id) })));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your goals.'));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return { goals, loading, error, refetch };
}
