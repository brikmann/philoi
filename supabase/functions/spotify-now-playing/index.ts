// The member's currently-playing Spotify track, for the lock-in music chip — a thin HTTP wrapper
// over _shared/spotify.ts's getNowPlaying() (CODE_PROMPT_spotify_backend.md §3).
//
// OWNER ONLY. Unlike gcal-window there is deliberately no service-role `userId` path: what someone
// is listening to goes into their own lock-in UI and nowhere else — not the coach, not the Agora.
//
// NEVER BLOCKS THE UI. Every failure after authentication is a 200 with `connected: false` and a
// `reason`, including a throw this wrapper didn't anticipate. Only a missing/invalid session is a
// 401, because that is a signed-out client, not a Spotify problem.
//
// The client should poll no faster than every 30s while a lock-in is on screen — see
// MAX_FETCHES_PER_HOUR. Returns { connected, reason, isPlaying, track, artist, albumArt, trackId };
// never a token.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { getNowPlaying, type NowPlaying } from '../_shared/spotify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

  try {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    return json(await getNowPlaying(serviceClient, user.id));
  } catch (e) {
    console.error('[spotify-now-playing]', e instanceof Error ? e.message : e);
    const degraded: NowPlaying = {
      connected: false,
      reason: 'error',
      isPlaying: false,
      track: null,
      artist: null,
      albumArt: null,
      trackId: null,
    };
    return json(degraded);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
