import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { useAuth } from '@/lib/auth/auth-context';

const DEV_MEMBER_OVERRIDE_KEY = 'philoi_dev_member_override';

/**
 * Thin stub: Philoi ships fully free during early access (no trial, no paywall)
 * while we collect traction data — see src/lib/analytics.ts — to decide pricing
 * later. isMember/devOverride stay wired so flipping on real billing afterward
 * doesn't require touching call sites. See MEMBERSHIP_PRICING in lib/billing.ts.
 */
export function useEntitlement() {
  const { profile } = useAuth();
  const [devOverride, setDevOverrideState] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(DEV_MEMBER_OVERRIDE_KEY).then((v) => setDevOverrideState(v === 'true'));
  }, []);

  const setDevOverride = useCallback(async (value: boolean) => {
    setDevOverrideState(value);
    await SecureStore.setItemAsync(DEV_MEMBER_OVERRIDE_KEY, String(value));
  }, []);

  const isMember = Boolean(profile?.is_pro) || (__DEV__ && devOverride);

  return { isMember, devOverride, setDevOverride };
}
