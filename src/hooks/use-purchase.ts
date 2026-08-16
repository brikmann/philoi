import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { fetchProductPrices, isBillingConfigured, purchaseProduct } from '@/lib/billing';
import { supabase } from '@/lib/supabase';

/**
 * Live, localized store prices keyed by product id.
 *
 * Returns `{}` until the offering loads (and forever, in a build with no SDK keys). Callers must
 * render a placeholder for a missing id rather than falling back to a hardcoded string: a stale
 * literal that disagrees with the real charge is worse than briefly showing nothing, and it is
 * exactly the failure this replaced.
 */
export function useProductPrices(): Record<string, string> {
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isBillingConfigured()) return;
    let cancelled = false;
    fetchProductPrices()
      .then((p) => {
        if (!cancelled) setPrices(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return prices;
}

/**
 * One place every paywall goes through (#71), so the Forge Pass strip and the Buy-Embers row can't
 * drift on how they handle a cancel, a pending purchase, or a build with no keys.
 *
 * The rule this enforces: NOTHING is granted on the client. A successful return here means the
 * store charged the user — the embers and the entitlement are written by the RevenueCat webhook.
 * On success we route to the success screen, which is honest about that timing rather than
 * asserting a balance it hasn't seen yet.
 */
export function usePurchase() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const buy = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!isBillingConfigured()) {
        Alert.alert(
          'Not available yet',
          'Real-money purchases need the next native build. Everything you can earn with embers works today.'
        );
        return false;
      }

      setBusy(true);
      try {
        const outcome = await purchaseProduct(productId);
        switch (outcome.status) {
          case 'granted':
            router.push({ pathname: '/purchase-success', params: { product: productId } });
            return true;
          case 'cancelled':
            // Silent on purpose. The user chose to back out; an "are you sure?" popup after a
            // deliberate cancel is the most annoying pattern in mobile commerce.
            return false;
          case 'already-owned':
            Alert.alert('Already yours', 'You already own this. Try Restore Purchases if it isn’t showing up.');
            return false;
          case 'pending':
            Alert.alert(
              'Waiting on approval',
              'Your purchase is pending — this usually means Ask to Buy or an extra bank check. It’ll land as soon as it clears.'
            );
            return false;
          case 'unavailable':
            Alert.alert('Couldn’t complete that', outcome.message);
            return false;
        }
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  return { buy, busy };
}

/**
 * The "I paid and the app doesn't know it" repair, called on app focus when the STORE says the pass
 * is owned but our own state disagrees.
 *
 * Grants nothing by itself — reconcile_my_forge_pass (0077) refuses unless a webhook receipt for
 * this user and season is already on file, so this can only ever re-apply a grant we were genuinely
 * paid for. Returns whether anything changed.
 */
export async function reconcileForgePass(): Promise<boolean> {
  const { data, error } = await supabase.rpc('reconcile_my_forge_pass');
  if (error) return false;
  return Boolean((data as { changed?: boolean } | null)?.changed);
}
