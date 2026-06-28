import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

import { useAuth } from '@/lib/auth/auth-context';

const DEV_PRO_OVERRIDE_KEY = 'philoi_dev_pro_override';

export function useEntitlement() {
  const { profile } = useAuth();
  const [devOverride, setDevOverrideState] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(DEV_PRO_OVERRIDE_KEY).then((v) => setDevOverrideState(v === 'true'));
  }, []);

  const setDevOverride = useCallback(async (value: boolean) => {
    setDevOverrideState(value);
    await SecureStore.setItemAsync(DEV_PRO_OVERRIDE_KEY, String(value));
  }, []);

  const isPro = Boolean(profile?.is_pro) || (__DEV__ && devOverride);

  return { isPro, devOverride, setDevOverride };
}
