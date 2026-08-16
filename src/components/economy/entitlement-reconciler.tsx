import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useInventory } from '@/hooks/use-inventory';
import { reconcileForgePass } from '@/hooks/use-purchase';
import { track } from '@/lib/analytics';
import { isBillingConfigured, storeSaysPassOwned } from '@/lib/billing';

// The safety net for "I paid and the app doesn't know it" (#71).
//
// The webhook is the source of truth, but webhooks get dropped: a Supabase cold start, a bad
// deploy, a RevenueCat outage. Without this, a user who paid $9.99 during that window would keep
// seeing the upgrade strip forever and have no recourse inside the app.
//
// The check is deliberately one-directional. If the STORE says the entitlement is active and OUR
// state says it isn't, ask the server to reconcile. The reverse — our state says owned, the store
// disagrees — is NOT acted on: refunds and expirations are a product decision nobody has made yet
// (see the note in the webhook), and silently revoking a pass someone is using would be far worse
// than briefly over-granting one they paid for.
//
// Renders nothing. Mounted once at the root beside LoadoutSync.

export function EntitlementReconciler() {
  const { pass, refetch } = useInventory();
  const ownsPremium = pass?.owns_premium ?? false;
  // Read through a ref so the AppState subscription below doesn't need re-subscribing every time
  // ownership changes — and, more importantly, so the listener always sees the CURRENT value
  // rather than the one captured when it was registered.
  //
  // Synced in an effect rather than assigned during render: a ref write during render is a real
  // hazard under concurrent rendering (the render can be discarded and re-run, leaving the ref
  // holding a value that was never committed).
  const ownsRef = useRef(ownsPremium);
  useEffect(() => {
    ownsRef.current = ownsPremium;
  }, [ownsPremium]);

  const checking = useRef(false);

  useEffect(() => {
    if (!isBillingConfigured()) return;

    async function check() {
      // A slow check overlapping the next foreground would fire the RPC twice for one discrepancy.
      if (checking.current || ownsRef.current) return;
      checking.current = true;
      try {
        if (!(await storeSaysPassOwned())) return;
        // The store says they own it and we don't agree — that's a missed grant.
        if (await reconcileForgePass()) {
          track('iap_reconciled', { entitlement: 'forge_pass' });
          await refetch();
        }
      } catch {
        // Best-effort by design. This is a repair path, not a feature; a failure here must never
        // surface as an error to someone who isn't even aware anything went wrong.
      } finally {
        checking.current = false;
      }
    }

    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [refetch]);

  return null;
}
