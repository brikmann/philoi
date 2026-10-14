// Sends a 6-digit campus-verification code (UNI_VERIFICATION_SPEC.md §3).
//
// This is NOT Supabase Auth. supabase.auth.signInWithOtp would sign the user in AS the uni
// email — a different auth user — replacing the Google/Apple session that owns their profile.
// The uni email is a verified attribute on the EXISTING user, so the code lives in our own
// table and Auth is never involved.
//
// Requires on the project (not in the app):
//   supabase secrets set RESEND_API_KEY=...
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY come from the runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  CODE_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  domainOf,
  generateCode,
  hashCode,
  looksLikeEmail,
} from '../_shared/uni-code.ts';

// MUST be on a domain verified in Resend, or every send fails with a 502 (Resend 403s an
// unverified sender outright). Both getphiloi.com and philoi.app are verified in Resend, so
// either fallback would send; philoi.app is the live sender, set via the UNI_CODE_FROM secret.
// The fallback now matches it. It used to sit on getphiloi.com because that was the domain the
// privacy/terms URLs used — no longer true, those moved to philoi.app, so the old fallback would
// have put a stale domain in front of a student verifying their university email.
const FROM = Deno.env.get('UNI_CODE_FROM') ?? 'Philoi <noreply@philoi.app>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    // Always the caller's own token — the user id is never taken from the body, so nobody can
    // request a code onto someone else's account.
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!looksLikeEmail(email)) return json({ error: 'That doesn’t look like an email address.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('university, university_domain')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) return json({ error: 'Could not load your profile.' }, 500);
    if (!profile?.university_domain) {
      return json(
        { error: 'We don’t know an email domain for your school yet, so it can’t be verified.', reason: 'no_domain' },
        400
      );
    }

    // DOMAIN ONLY (§1b). The local part is never checked: conventions vary within a school and a
    // regex would falsely reject short surnames, collision suffixes, grad and staff accounts.
    // Receiving the code is what proves ownership.
    const expected = profile.university_domain.trim().toLowerCase();
    if (domainOf(email) !== expected) {
      return json({ error: `Use your @${expected} email.`, reason: 'wrong_domain', domain: expected }, 400);
    }

    // Cooldown, read from the stored row rather than trusted from the client — otherwise this
    // endpoint is a free mailer aimed at any address at the school.
    const { data: existing } = await admin
      .from('uni_verification_codes')
      .select('last_sent_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing?.last_sent_at) {
      const elapsed = (Date.now() - new Date(existing.last_sent_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        return json(
          { error: 'Hang on a moment before asking for another code.', reason: 'cooldown', retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) },
          429
        );
      }
    }

    const code = generateCode();
    const codeHash = await hashCode(code, user.id);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

    // Upsert on the pk: a new send REPLACES any previous code, so an old one can't stay live
    // alongside it, and attempts reset to 0 for the new code.
    const { error: upsertError } = await admin.from('uni_verification_codes').upsert(
      {
        user_id: user.id,
        email,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
        last_sent_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (upsertError) return json({ error: 'Could not start verification.' }, 500);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'Email sending isn’t configured yet.', reason: 'no_sender' }, 500);

    const school = profile.university ?? 'your campus';
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `${code} is your Philoi campus code`,
        text:
          `Your Philoi verification code is ${code}\n\n` +
          `It expires in ${CODE_TTL_MINUTES} minutes and confirms you study at ${school}.\n\n` +
          `This only verifies your campus — you still sign in with Google or Apple. ` +
          `We never post from this address or share it.\n\n` +
          `If you didn't ask for this, you can ignore it.`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#1b1726">` +
          `<p style="margin:0 0 16px">Your Philoi verification code is</p>` +
          `<p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 16px">${code}</p>` +
          `<p style="margin:0 0 16px">It expires in ${CODE_TTL_MINUTES} minutes and confirms you study at ${escapeHtml(school)}.</p>` +
          `<p style="margin:0 0 16px;color:#6b6480;font-size:13px">This only verifies your campus — you still sign in with Google or Apple. ` +
          `We never post from this address or share it.</p>` +
          `<p style="margin:0;color:#6b6480;font-size:13px">If you didn't ask for this, you can ignore it.</p>` +
          `</div>`,
      }),
    });

    if (!sendRes.ok) {
      const detail = await sendRes.text();
      console.error('[send_uni_code] Resend rejected the send:', sendRes.status, detail);
      // The row is left in place deliberately: the code may still have gone out on a partial
      // failure, and clearing it would invalidate a code sitting in someone's inbox.
      return json({ error: 'Could not send that code — try again in a moment.', reason: 'send_failed' }, 502);
    }

    // The code itself is NEVER returned. The only way to learn it is to read the mailbox, which
    // is the whole proof.
    return json({ ok: true, email, expiresInMinutes: CODE_TTL_MINUTES, cooldownSeconds: RESEND_COOLDOWN_SECONDS });
  } catch (e) {
    console.error('[send_uni_code] unexpected:', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
