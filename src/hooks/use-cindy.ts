import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { fetchCoachSettings, type CoachSettings } from '@/lib/api/coach';

/**
 * Cindy's consent + toggle state.
 *
 * `consented` gates EVERYTHING: no call to the coach may be made before the user has agreed,
 * because the very first thing the service does is read their whole history and send it to a
 * model. A missing row means no consent (fails closed), which is why `null` settings and
 * `enabled: false` collapse to the same answer here.
 */
export function useCindy() {
  const { session } = useAuth();
  const [settings, setSettings] = useState<CoachSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!session) return;
    try {
      setSettings(await fetchCoachSettings());
    } catch (e) {
      // Cindy is additive — a settings read that fails should leave the app exactly as it was
      // without her, never block Home from rendering.
      console.error('[useCindy] fetchCoachSettings failed:', e);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  return {
    settings,
    loading,
    consented: Boolean(settings?.consented_at && settings.enabled),
    bubbleEnabled: settings?.home_bubble_enabled !== false,
    voiceEnabled: settings?.voice_enabled !== false,
    refetch,
  };
}
