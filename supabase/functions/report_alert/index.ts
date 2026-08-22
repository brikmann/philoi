// Emails the safety inbox when someone files a moderation report
// (CAMPFIRE_REDESIGN_SPEC.md §Report: "on submit, send an automated email to the safety/admin
// inbox — '{reporter} reported {campfire name} for {reason}.'").
//
// Before this existed, a report was a row in `moderation_reports` and nothing else: no push, no
// mail, no dashboard alert. Somebody had to think to go and look. For ordinary spam that is merely
// slow; for a child-safety report it is the difference between "handled in minutes" and "handled
// whenever". That is what this closes.
//
// WHY AN EDGE FUNCTION AND NOT A CLIENT MAILER: the message is composed from the row the server
// reads back, never from strings the client hands over. A client that could dictate the reporter's
// name, the campfire, or the reason could forge safety alerts about anyone. The client's only
// input is a report id, and that id must belong to a report the CALLER filed.
//
// Requires on the project (not in the app):
//   supabase secrets set RESEND_API_KEY=...        # already set for uni verification
//   supabase secrets set SAFETY_ALERT_TO=you@...   # where reports land
//   supabase secrets set SAFETY_ALERT_FROM='Philoi Safety <safety@philoi.app>'   # optional
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// MUST be on a domain verified in Resend or every send 403s — same constraint as send_uni_code.
const FROM = Deno.env.get('SAFETY_ALERT_FROM') ?? 'Philoi Safety <noreply@philoi.app>';
const TO = Deno.env.get('SAFETY_ALERT_TO') ?? 'safety@philoi.app';

/** The one reason that is a legal-compliance escalation, not a moderation queue item. */
const CSAE_REASON = 'Child safety / CSAE';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const body = await req.json().catch(() => ({}));
    const reportId = typeof body.reportId === 'string' ? body.reportId : '';
    if (!reportId) return json({ error: 'Missing reportId.' }, 400);

    // Service role, because moderation_reports is insert-only to users — nobody can read a report
    // back, including the person who filed it. That is the right policy; this function is the one
    // place with a reason to look.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: report, error: reportError } = await admin
      .from('moderation_reports')
      .select('id, reporter_id, reported_group_id, reported_user_id, reported_check_in_id, reported_message_id, circle_id, reason, created_at')
      .eq('id', reportId)
      .maybeSingle();
    if (reportError) return json({ error: 'Could not load that report.' }, 500);
    if (!report) return json({ error: 'Report not found.' }, 404);

    // The whole authorization model: you may only trigger the alert for a report you filed.
    if (report.reporter_id !== user.id) return json({ error: 'Not your report.' }, 403);

    const [reporter, campfire, reportedUser] = await Promise.all([
      lookupProfile(admin, report.reporter_id),
      lookupGroup(admin, report.reported_group_id ?? report.circle_id),
      lookupProfile(admin, report.reported_user_id),
    ]);

    const reporterName = reporter ?? 'A Philoi user';
    // A campfire report names the campfire; a user/message/check-in report names the person, with
    // the campfire as context. Either way the subject line says WHO reported WHAT, for WHAT.
    const subjectTarget = report.reported_group_id ? (campfire ?? 'a campfire') : (reportedUser ?? campfire ?? 'content');
    const isCsae = report.reason === CSAE_REASON;

    const subject = `${isCsae ? '[URGENT · CHILD SAFETY] ' : ''}${reporterName} reported ${subjectTarget} for ${report.reason}.`;

    const lines = [
      `${reporterName} reported ${subjectTarget} for ${report.reason}.`,
      '',
      `Reason:        ${report.reason}`,
      `Campfire:      ${campfire ?? '—'}${report.reported_group_id ? ' (the campfire itself was reported)' : ''}`,
      `Campfire id:   ${report.reported_group_id ?? report.circle_id ?? '—'}`,
      `Reporter:      ${reporterName}`,
      `Reporter id:   ${report.reporter_id ?? '—'}`,
      `Reported user: ${reportedUser ?? '—'} (${report.reported_user_id ?? '—'})`,
      `Check-in id:   ${report.reported_check_in_id ?? '—'}`,
      `Message id:    ${report.reported_message_id ?? '—'}`,
      `Report id:     ${report.id}`,
      `Filed at:      ${report.created_at}`,
    ];
    if (isCsae) {
      lines.push(
        '',
        '⚠ CHILD-SAFETY / CSAE REPORT — ESCALATE IMMEDIATELY.',
        'Review now, preserve the evidence, and report to the relevant authority',
        '(Cybertip.ca in Canada, NCMEC in the US) as required. Do not let this sit in a queue.'
      );
    }
    const text = lines.join('\n');

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      // The REPORT ITSELF IS ALREADY SAVED — this function only carries the alert. A missing key
      // must never look like a failed report to the person who filed it.
      console.error('[report_alert] RESEND_API_KEY is unset; report', report.id, 'was filed but not emailed.');
      return json({ ok: false, reason: 'no_sender' }, 200);
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject,
        text,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1b1726">` +
          (isCsae
            ? `<p style="background:#fdecea;border-left:4px solid #c4342b;padding:10px 14px;margin:0 0 16px;font-weight:700">` +
              `⚠ Child-safety / CSAE report — escalate immediately.</p>`
            : '') +
          `<p style="margin:0 0 16px;font-size:16px"><b>${escapeHtml(reporterName)}</b> reported ` +
          `<b>${escapeHtml(subjectTarget)}</b> for <b>${escapeHtml(report.reason)}</b>.</p>` +
          `<pre style="background:#f5f3f8;padding:12px 14px;border-radius:8px;font-size:13px;white-space:pre-wrap">` +
          `${escapeHtml(text)}</pre>` +
          `</div>`,
      }),
    });

    if (!sendRes.ok) {
      const detail = await sendRes.text();
      console.error('[report_alert] Resend rejected the send:', sendRes.status, detail, 'report', report.id);
      return json({ ok: false, reason: 'send_failed' }, 200);
    }

    return json({ ok: true, escalated: isCsae });
  } catch (e) {
    console.error('[report_alert] unexpected:', e);
    // Still a 200: the report is saved either way, and the person who filed it should see
    // "report received", not an error that tempts them to file it again.
    return json({ ok: false, reason: 'unexpected' }, 200);
  }
});

async function lookupProfile(
  admin: ReturnType<typeof createClient>,
  userId: string | null
): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin.from('profiles').select('display_name, handle').eq('id', userId).maybeSingle();
  if (!data) return null;
  return data.handle ? `${data.display_name} (@${data.handle})` : data.display_name;
}

async function lookupGroup(admin: ReturnType<typeof createClient>, groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const { data } = await admin.from('groups').select('name').eq('id', groupId).maybeSingle();
  return data?.name ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
