import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAuditEventType } from '@/lib/types';

// Every admin content view and action lands in admin_audit — the "duty to keep records"
// requirement. Called from server components right after their initial fetch, and from
// mutation route handlers right after the mutation succeeds.
export async function logAdminEvent(
  supabase: SupabaseClient,
  adminId: string,
  eventType: AdminAuditEventType,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> = {}
) {
  await supabase.from('admin_audit').insert({
    admin_id: adminId,
    event_type: eventType,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
}
