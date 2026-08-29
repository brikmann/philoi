// Checks a 6-digit campus code and, on success, marks the EXISTING OAuth user as campus-verified
// (UNI_VERIFICATION_SPEC.md §3). Supabase Auth is never touched — see send_uni_code's header for
// why signInWithOtp/verifyOtp would be actively wrong here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { MAX_ATTEMPTS, hashCode, timingSafeEqual } from '../_shared/uni-code.ts';

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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!email || !/^\d{6}$/.test(code)) {
      return json({ error: 'Enter the 6-digit code.', reason: 'malformed' }, 400);
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: row, error: rowError } = await admin
      .from('uni_verification_codes')
      .select('email, code_hash, expires_at, attempts')
      .eq('user_id', user.id)
      .maybeSingle();
    if (rowError) return json({ error: 'Could not check that code.' }, 500);
    if (!row) return json({ error: 'Ask for a new code to get started.', reason: 'no_code' }, 400);

    // Attempts are checked BEFORE the hash comparison, so a caller who has burned the cap can't
    // keep guessing — and can't use the response timing to tell a wrong code from a locked one.
    if (row.attempts >= MAX_ATTEMPTS) {
      return json({ error: 'Too many tries — send yourself a fresh code.', reason: 'too_many_attempts' }, 429);
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: 'That code has expired — send a new one.', reason: 'expired' }, 400);
    }
    // The email is pinned to the code: changing address mid-flow has to mean a new send, or a
    // code mailed to one address could verify a different one.
    if (row.email !== email) {
      return json({ error: 'That code was sent to a different address.', reason: 'email_mismatch' }, 400);
    }

    const candidate = await hashCode(code, user.id);
    if (!timingSafeEqual(candidate, row.code_hash)) {
      const attempts = row.attempts + 1;
      await admin.from('uni_verification_codes').update({ attempts }).eq('user_id', user.id);
      const left = Math.max(0, MAX_ATTEMPTS - attempts);
      return json(
        {
          error: left > 0 ? `That code isn’t right — ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many tries — send yourself a fresh code.',
          reason: left > 0 ? 'wrong_code' : 'too_many_attempts',
          attemptsLeft: left,
        },
        400
      );
    }

    // Re-read the domain at verification time rather than trusting what it was when the code was
    // sent — if the user changed school in another tab mid-flow, this stops a code for the old
    // campus from verifying them at the new one.
    const { data: profile } = await admin
      .from('profiles')
      .select('university, university_domain')
      .eq('id', user.id)
      .maybeSingle();
    const expected = profile?.university_domain?.trim().toLowerCase() ?? '';
    if (!expected || email.split('@')[1] !== expected) {
      return json({ error: 'Your school changed — start verification again.', reason: 'school_changed' }, 409);
    }

    // ONE ACCOUNT PER CAMPUS EMAIL (migration 0136). Without this the code check above proves only
    // that the caller can read that inbox — not that the inbox is unspent — so a single working
    // @school.ca verified an unlimited number of accounts, one after another.
    //
    // `ilike` rather than `eq`: `email` is already lowercased (line 25), but the column is plain
    // text and nothing forced older rows to be, so an exact match would miss a stored Brik8334@.
    // Same folding the unique index uses.
    const { data: taken } = await admin
      .from('profiles')
      .select('id')
      .eq('university_email_verified', true)
      .ilike('university_email', email)
      .neq('id', user.id)
      .maybeSingle();
    if (taken) {
      return json(
        { error: 'This school email is already linked to another Philoi account.', reason: 'email_taken' },
        409
      );
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({ university_email: email, university_email_verified: true })
      .eq('id', user.id);
    if (updateError) {
      // The pre-check above is a read followed by a write, so two devices verifying the same
      // address in the same second both pass it and the SECOND one lands here on the unique index.
      // That is the same situation the user is in either way — the address is spoken for — so it
      // gets the same 409 and the same sentence, not a generic 500 that reads like our fault.
      if (updateError.code === '23505') {
        return json(
          { error: 'This school email is already linked to another Philoi account.', reason: 'email_taken' },
          409
        );
      }
      return json({ error: 'Could not save your verification.' }, 500);
    }

    // Single-use: the row goes as soon as it has done its job.
    await admin.from('uni_verification_codes').delete().eq('user_id', user.id);

    return json({ ok: true, email, university: profile?.university ?? null });
  } catch (e) {
    console.error('[verify_uni_code] unexpected:', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
