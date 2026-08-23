// ══════════════════════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR as coach context — GCAL_INTEGRATION_SPEC.md.
//
// 🔌 THIS IS THE SEAM, NOT THE INTEGRATION. The OAuth connect flow, the Connected Apps card, and
// the encrypted refresh-token store are a SEPARATE build (CODE_PROMPT_gcal.md). This module is
// the half the coach owns: fetch the relevant window at message time, hand it to the model.
//
// Everything here is written so the coach works **exactly as well as it can** with whatever
// exists. No table? No connection? Expired token? Google down? → returns null, the prompt simply
// omits the calendar block, and Cindy reasons without it (less precise, never broken). That is
// GCAL_INTEGRATION_SPEC's "works-without-it fallback" as a hard structural guarantee rather than
// a try/catch someone remembered to add.
//
// 🔒 PRIVACY (spec: "calendar is sensitive"). Read-only. A rolling forward window only — never
// the past, never the whole calendar. Nothing is written back to our database: the events are
// used to build one prompt and then dropped. We never surface calendar contents socially.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

/** How far ahead to look. Long enough to see next week's midterm, short enough to stay relevant. */
const WINDOW_DAYS = 21;

/** Cap the events we forward — a packed class schedule would otherwise dominate the prompt. */
const MAX_EVENTS = 40;

export type CalendarEvent = {
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
};

/**
 * The upcoming window for this user, or null when the calendar is unavailable for any reason.
 *
 * Deliberately does NOT parse titles for "midterm"/"exam"/"due". GCAL_INTEGRATION_SPEC is
 * explicit that Sonnet should interpret the raw events rather than brittle keyword matching —
 * the model maps "BU111 Midterm Fri 9am" onto a real deadline and a course tie far better than a
 * regex, and a regex would silently miss "BU111 MT2".
 */
export async function fetchCalendarWindow(
  admin: SupabaseClient,
  userId: string
): Promise<CalendarEvent[] | null> {
  try {
    const token = await accessTokenFor(admin, userId);
    if (!token) return null;

    const now = new Date();
    const timeMax = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeMax', timeMax.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(MAX_EVENTS));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;

    const body = await res.json();
    const items: unknown[] = Array.isArray(body.items) ? body.items : [];

    return items
      .map((raw): CalendarEvent | null => {
        const e = raw as Record<string, any>;
        const start = e.start?.dateTime ?? e.start?.date;
        if (!start || typeof e.summary !== 'string') return null;
        return {
          title: e.summary,
          start,
          end: e.end?.dateTime ?? e.end?.date ?? null,
          all_day: !e.start?.dateTime,
        };
      })
      .filter((e): e is CalendarEvent => e !== null);
  } catch {
    // Never let a calendar problem take the coach down — an unreachable Google means a slightly
    // less precise Cindy, not a failed message.
    return null;
  }
}

/**
 * A valid access token for this user, refreshing if needed — or null if they have not connected.
 *
 * Reads the table the GCal build owns (`google_calendar_connections`). Until that build lands the
 * table does not exist, the query errors, and we return null: the coach is calendar-blind but
 * fully functional, which is the intended pre-integration state.
 */
async function accessTokenFor(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('google_calendar_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  // 60s of slack so a token that expires mid-flight is refreshed rather than used and rejected.
  if (data.access_token && expiresAt > Date.now() + 60_000) return data.access_token;
  if (!data.refresh_token) return null;

  // GOOGLE_WEB_*, matching gcal-oauth-exchange. These read GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
  // until 2026-08-23, which is the SAME Google credential under a second name — so the project had
  // GOOGLE_WEB_CLIENT_SECRET set, the exchange worked, and this refresh silently returned null the
  // moment the first access token expired about an hour later. One credential, one name.
  //
  // The null is deliberate (a calendar that cannot be read is not an error worth failing a coach
  // turn over) which is exactly why the misnaming was invisible: nothing logs, nothing 500s,
  // Cindy just stops mentioning your deadlines.
  const clientId = Deno.env.get('GOOGLE_WEB_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_WEB_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;

  const refreshed = await res.json();
  if (typeof refreshed.access_token !== 'string') return null;

  await admin
    .from('google_calendar_connections')
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
    })
    .eq('user_id', userId);

  return refreshed.access_token;
}
