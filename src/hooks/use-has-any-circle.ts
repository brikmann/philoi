import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase';

export function useHasAnyCircle() {
  const { session } = useAuth();
  const [hasCircle, setHasCircle] = useState<boolean | null>(null);

  const refetch = useCallback(async () => {
    if (!session) {
      setHasCircle(null);
      return;
    }
    const { count, error } = await supabase
      .from('group_members')
      .select('group_id', { count: 'exact', head: true })
      .eq('user_id', session.user.id);
    if (error) {
      console.warn('[use-has-any-circle] failed to check membership:', error);
      return;
    }
    setHasCircle((count ?? 0) > 0);
  }, [session]);

  return { hasCircle, refetch };
}
