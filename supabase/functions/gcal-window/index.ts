// The calendar window over HTTP — the same contract as _shared/gcal.ts's getCalendarWindow(),
// for callers that can't just import it.
//
// A coach that IS a Deno Edge Function in this project should import the module directly (one
// less hop, one less round trip):
//
//   import { getCalendarWindow, formatCalendarWindowForPrompt } from '../_shared/gcal.ts';
//   const window = await getCalendarWindow(serviceClient, userId);
//   context.push(formatCalendarWindowForPrompt(window));
//
// This function exists for the other two cases: a coach running somewhere else, and looking at
// what the model would actually see while debugging a nudge that referenced the wrong day.
//
// Two ways in, and the difference matters:
//   • A MEMBER's JWT   -> their own window, no userId accepted. This is the app's path.
//   • The SERVICE ROLE key -> may name any `userId`. This is the coach service's path, and it is
//     gated on the bearer being byte-for-byte the service role key, so an anon-key caller can
//     never reach another member's calendar by passing an id.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { formatCalendarWindowForPrompt, getCalendarWindow } from '../_shared/gcal.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const body = await req.json().catch(() => ({}));
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isServiceRole = bearer === serviceRoleKey;

    let userId: string;
    if (isServiceRole) {
      if (typeof body.userId !== 'string' || !body.userId) return json({ error: 'Missing userId.' }, 400);
      userId = body.userId;
    } else {
      const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();
      if (userError || !user) return json({ error: 'Not authenticated.' }, 401);
      userId = user.id;
    }

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey);
    const window = await getCalendarWindow(serviceClient, userId, {
      from: typeof body.from === 'string' ? body.from : undefined,
      to: typeof body.to === 'string' ? body.to : undefined,
      now: typeof body.now === 'string' ? body.now : undefined,
      force: body.force === true,
    });

    // The prompt block is opt-in rather than always-on: a caller assembling its own context
    // shouldn't pay for a string it will throw away.
    return json(body.includePrompt === true ? { ...window, prompt: formatCalendarWindowForPrompt(window) } : window);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
