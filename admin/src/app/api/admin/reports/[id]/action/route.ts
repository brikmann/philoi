import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logAdminEvent } from '@/lib/audit';
import type { ActionType } from '@/lib/types';

const ALLOWED: ActionType[] = [
  'removed_content',
  'warned',
  'disabled_account',
  'reported_to_authorities',
  'dismissed',
];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: reportId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const actionType = body.actionType as ActionType;
  if (!ALLOWED.includes(actionType)) {
    return NextResponse.json({ error: `Unsupported action: ${actionType}` }, { status: 400 });
  }

  // The RPC re-checks is_admin() itself (SECURITY DEFINER) — the checks above are a
  // fast-path rejection, not the real authorization boundary.
  const { error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_action_type: actionType,
    p_notes: body.notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const eventType = actionType === 'disabled_account' ? 'user_suspended' : 'report_action';
  await logAdminEvent(supabase, user.id, eventType, 'report', reportId, { actionType });

  return NextResponse.json({ ok: true });
}
