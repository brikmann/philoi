import { posthog } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import type { AnalyticsEventName } from '@/types/database';

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

/**
 * Fire-and-forget event logging — dual-writes to PostHog (the system of record for
 * funnels/retention/dashboards) and our own Supabase `events` table (keeps the
 * analytics_* SQL views in supabase/schema.sql working as a free backup/cross-check).
 * Never throws: analytics must never break the product.
 */
export async function track(name: AnalyticsEventName, properties: AnalyticsProperties = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;

    posthog?.capture(name, properties);
    await supabase.from('events').insert({ user_id: userId, name, properties });
  } catch (e) {
    console.warn('[analytics] failed to track event:', name, e);
  }
}

export function identify(userId: string, traits: AnalyticsProperties = {}) {
  posthog?.identify(userId, traits);
}
