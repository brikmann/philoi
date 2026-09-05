// The philoi.app launch-page waitlist.
//
// Before this existed the "Get notified" field on the marketing site composed a `mailto:` and
// handed the visitor's own mail client the job of telling us they were interested. That is not a
// waitlist: it needs the visitor to have a configured desktop mail client, to actually press send,
// and it produces no list anybody can count. Season 1 needs a number for preliminary demand, and a
// mailto produces no number.
//
// WHAT THIS IS THE ONLY COPY OF: the signup itself. A visitor's address reaches exactly one place —
// Resend — as (1) a contact, which is the countable, exportable list, and (2) an alert to the
// founder inbox, which is the durable second copy. There is deliberately NO database table here:
// `supabase migration list --linked` currently shows 0168–0172 local-only, and MIGRATIONS.md says
// to stop rather than add to an unreconciled pile. A waitlist does not justify pushing five other
// sessions' migrations to prod. When the ledger is level, a `waitlist_signups` table can be added
// behind this same endpoint without the site changing at all.
//
// PUBLIC ON PURPOSE, unlike every other function in this project. It is called by a static page
// from a browser with no Supabase session, so it is deployed `--no-verify-jwt` (pinned in
// config.toml). That makes the input entirely untrusted: everything below treats the body as
// hostile, and the only thing it will ever do with it is record one email address.
//
// Requires on the project:
//   supabase secrets set RESEND_API_KEY=...     # already set — shared with send_uni_code
//   supabase secrets set WAITLIST_ALERT_TO=...  # optional, defaults to nb@philoi.app
//   supabase secrets set UNI_CODE_FROM=...      # already set — the verified philoi.app sender

const FROM = Deno.env.get('WAITLIST_FROM') ?? Deno.env.get('UNI_CODE_FROM') ?? 'Philoi <noreply@philoi.app>';
const ALERT_TO = Deno.env.get('WAITLIST_ALERT_TO') ?? 'nb@philoi.app';

// A browser preflights this: the body is application/json, which is not a CORS-simple content
// type. The shared corsHeaders helper omits Allow-Methods because every other function in this
// project is called from React Native, where fetch does no preflight at all. Adding it there
// would change how nineteen deployed functions answer OPTIONS, so this one carries its own.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Deliberately not RFC 5322. It rejects what is obviously not an address and nothing more —
 *  a clever regex here costs real signups from addresses it has never heard of. */
const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[^\s@.]+(\.[^\s@.]+)+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    // Honeypot. A field the stylesheet hides and no human ever fills, so anything in it is a bot.
    // It gets `ok` rather than an error: telling a scraper which of its submissions were binned is
    // how it learns to stop filling the field.
    if (typeof body.company === 'string' && body.company.trim() !== '') {
      return json({ ok: true });
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL.test(email)) {
      return json({ ok: false, reason: 'bad_email' }, 400);
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      console.error('[waitlist] RESEND_API_KEY is unset — signup for', email, 'was DROPPED.');
      return json({ ok: false, reason: 'not_configured' }, 500);
    }

    // The domain is the demand signal. "34 signups" is a vanity number; "11 of them are
    // @uwaterloo.ca" is the thing that says which campus to open first.
    const campus = email.slice(email.indexOf('@') + 1);
    const referrer = str(body.ref, 200);
    const signedUpAt = new Date().toISOString();

    // Two independent records, on purpose. Either one alone is enough to not lose the person, so
    // they are raced rather than chained — a Resend contact-store hiccup must not also eat the
    // alert that would have told us it happened.
    const [contact, alert] = await Promise.all([
      addContact(apiKey, email, { source: 'philoi.app/waitlist', campus, referrer, signed_up_at: signedUpAt }),
      sendAlert(apiKey, email, campus, referrer, signedUpAt),
    ]);

    if (contact === false && !alert) {
      // Both records failed, so nothing anywhere knows this person exists. Say so — a page that
      // claims "you're on the list" over a dropped signup is worse than one that asks them to retry.
      console.error('[waitlist] BOTH the contact and the alert failed for', email, '— signup lost.');
      return json({ ok: false, reason: 'not_recorded' }, 502);
    }

    // The confirmation is the least important of the three sends: the person is already on the
    // list by now. It is awaited only so a hard failure shows up in the logs, never in the reply.
    const confirmed = await sendConfirmation(apiKey, email);
    if (!confirmed) console.error('[waitlist] recorded', email, 'but the confirmation email failed.');

    // `stored` and `alerted` are reported separately because they are separate records with
    // separate failure modes, and "did the countable list get it, or only the inbox?" is the
    // question anyone debugging a demand number will actually be asking.
    return json({ ok: true, stored: contact, alerted: alert, confirmed });
  } catch (e) {
    console.error('[waitlist] unexpected:', e);
    return json({ ok: false, reason: 'unexpected' }, 500);
  }
});

/**
 * The countable list. Resend deprecated per-audience contacts in favour of account-level ones with
 * custom `properties`, which is what carries the campus.
 *
 * Custom properties must be DECLARED before a contact can carry them, or the whole create fails
 * `422 One or more properties do not exist` — verified against the live API, not assumed. So the
 * first 422 declares them and retries; from the second signup onward that path is never taken.
 * Bootstrapping here rather than in a setup script is deliberate: a dashboard step nobody records
 * is a step that gets lost, and this one silently costs the campus column.
 *
 * The last resort drops properties entirely. Reports WHICH attempt landed, because the fallback
 * costs the campus breakdown — the whole reason for collecting any of this — and "it stored" is
 * not a useful enough answer when the demand number is the deliverable.
 */
async function addContact(
  apiKey: string,
  email: string,
  properties: Record<string, string>
): Promise<'full' | 'defined' | 'plain' | false> {
  const attempts = [
    { label: 'full' as const, payload: { email, unsubscribed: false, properties } },
    { label: 'defined' as const, payload: { email, unsubscribed: false, properties }, declareFirst: true },
    { label: 'plain' as const, payload: { email, unsubscribed: false } },
  ];
  for (const attempt of attempts) {
    const { label, payload } = attempt;
    if ('declareFirst' in attempt) await declareProperties(apiKey, Object.keys(properties));
    const res = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return label;
    const detail = await res.text();
    // A repeat signup is a success, not an error — somebody pressing the button twice is not a
    // problem to report back to them.
    if (res.status === 409 || /already exists/i.test(detail)) return label;
    console.error('[waitlist] contact create failed:', res.status, detail);
  }
  return false;
}

/**
 * Declares the custom property keys. Idempotent by tolerance rather than by check: a key that
 * already exists comes back as an error, and that error is the success case on every run after
 * the first. Failures are swallowed on purpose — the caller's next attempt drops properties and
 * still records the address, which matters more than the campus column.
 */
async function declareProperties(apiKey: string, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      fetch('https://api.resend.com/contact-properties', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        // Keys are alphanumeric+underscore, max 50 — all four below already comply.
        body: JSON.stringify({ key, type: 'string' }),
      }).catch(() => undefined)
    )
  );
}

/** The durable second copy, in an inbox that is read. */
async function sendAlert(
  apiKey: string,
  email: string,
  campus: string,
  referrer: string,
  signedUpAt: string
): Promise<boolean> {
  const text = [
    `${email} joined the Season 1 waitlist.`,
    '',
    `Campus:   ${campus}`,
    `Referrer: ${referrer || '—'}`,
    `At:       ${signedUpAt}`,
  ].join('\n');

  return send(apiKey, {
    from: FROM,
    to: [ALERT_TO],
    reply_to: email,
    subject: `Waitlist · ${email} (${campus})`,
    text,
  });
}

/** What the person actually asked for: one email, the day Emberfall opens. */
async function sendConfirmation(apiKey: string, email: string): Promise<boolean> {
  const text = [
    "You're on the list.",
    '',
    'Season 1: Emberfall opens October 1, 2026. We will email you once — the day it',
    'goes live on your campus — and not before.',
    '',
    'Turn your campus into your leaderboard.',
    '',
    '— Philoi · For the Best on Campus',
    'https://philoi.app',
    '',
    'Not you? Ignore this and you will hear nothing further.',
  ].join('\n');

  return send(apiKey, {
    from: FROM,
    to: [email],
    subject: "You're on the list — Season 1: Emberfall",
    text,
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#161320;color:#FFF6EC;padding:40px 28px;border-radius:14px;max-width:520px">` +
      `<p style="margin:0 0 6px;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#FFD27A">Season 1 · Emberfall</p>` +
      `<h1 style="margin:0 0 18px;font-size:30px;line-height:1.15;letter-spacing:-.02em">You&rsquo;re on the list.</h1>` +
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#A99CBD">Season 1 opens <b style="color:#FFD27A">October 1, 2026</b>. We&rsquo;ll email you once &mdash; the day it goes live on your campus &mdash; and not before.</p>` +
      `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#A99CBD">Turn your campus into your leaderboard.</p>` +
      `<p style="margin:0 0 4px;font-size:15px;font-weight:700">Philoi</p>` +
      `<p style="margin:0 0 20px;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#7C7194">For the Best on Campus</p>` +
      `<p style="margin:0;font-size:13px;color:#7C7194">Not you? Ignore this and you&rsquo;ll hear nothing further.</p>` +
      `</div>`,
  });
}

async function send(apiKey: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) return true;
  console.error('[waitlist] Resend rejected a send:', res.status, await res.text());
  return false;
}

/** Trim an untrusted string to a bounded, single-line value. */
function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
