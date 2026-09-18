import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { useAuth } from '@/lib/auth/auth-context';

const DEV_MEMBER_OVERRIDE_KEY = 'philoi_dev_member_override';

/**
 * Thin stub for the FEATURE-GATING membership that never shipped: Philoi's app features are free
 * for everyone, so nothing here gates anything, and `is_pro` has no live writer.
 *
 * ⚠️ NOT the Flame Pass. The Pass is an entitlement (`forge_pass`) owned by RevenueCat and read
 * from `pass.owns_premium` on the inventory — see hooks/use-inventory.ts. This hook answers a
 * different question ("does this account hold a Philoi membership") that the product no longer
 * asks, and the flat-membership pricing it used to point at has been deleted from lib/billing.ts.
 * It survives only for the dev override in Settings; do not reach for it to decide whether someone
 * bought the season.
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
