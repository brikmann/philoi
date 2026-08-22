// Google Calendar → AI coach (GCAL_INTEGRATION_SPEC.md, consumed by APP_BLOCKER_SPEC §C/§C2 and
// CINDY_SPEC.md §3). THIS MODULE IS THE INTEGRATION'S PUBLIC SURFACE: the coach service calls
// getCalendarWindow() at message time and gets back a normalized window it can hand to Sonnet.
//
// The contract, in one line:
//
//   getCalendarWindow(admin, userId, { from, to }) -> CalendarWindow
//
// It NEVER throws and NEVER blocks a coach message. A member with no calendar connected, a
// revoked grant, a rate-limited fetch and a Google outage all come back the same way — a
// CalendarWindow with `connected: false`, a `reason`, and nothing else to handle. That is
// deliberate: the spec's hard requirement is that the coach still runs without a calendar, just
// less precisely, so the failure path has to be the boring path.
//
// WHAT IT DOES NOT DO: warehouse anything. There is no events table. Each fetch pulls only the
// upcoming window, normalizes it to {title,start,end,allDay}, uses it, and keeps it in a
// minutes-long cache purely so one lock-in session doesn't hammer Google (migration 0105).
// Descriptions, locations, attendees, conferencing links and event ids are never requested.
//
// WHY THE TITLES COME THROUGH RAW: the spec is explicit that Sonnet interprets events, not us.
// "BU111 Midterm Fri 9am" becoming a deadline tied to a course is a job for the model; keyword
// matching on "midterm"/"due"/"exam" would be brittle and would quietly mis-handle every member
// whose calendar doesn't read like the one we tested against.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { decryptSecret } from './token-crypto.ts';

/** Read-only, and the narrowest scope that returns event titles. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Default lookahead. The spec asks for "next 2-4 weeks" — three weeks covers a midterm block
 * without dragging in a whole term of noise the model has to read past. */
export const DEFAULT_WINDOW_DAYS = 21;

/** How long a fetched window stays reusable. Long enough that a lock-in session (nudge at start,
 * a chat turn, a re-engagement check) costs Google one fetch; short enough that an event added
 * this morning shows up in this afternoon's coaching. */
const CACHE_TTL_MINUTES = 10;

/** Hard ceiling per member per rolling hour, on top of the cache. The cache is the real rate
 * limiter; this is the backstop for a caller that passes force. */
const MAX_FETCHES_PER_HOUR = 20;

/** A student may subscribe to a dozen course calendars. Read the primary plus the most relevant
 * few rather than fanning out over all of them. */
const MAX_CALENDARS = 5;

/** Cap what reaches the prompt. Three weeks of a busy timetable can be hundreds of blocks; past
 * this the model gains nothing and the context bill grows. */
const MAX_EVENTS = 120;

export type CalendarEvent = {
  /** Raw event title, straight from Google — Sonnet does the interpreting (see header). */
  title: string;
  /** ISO 8601. For all-day events this is the date at midnight in the calendar's own zone. */
  start: string;
  end: string;
  allDay: boolean;
  /** Which calendar it came from ("Personal", "BU111"), which is often the course tie. */
  calendar: string;
  /** Whether this event actually occupies the member — an all-day "Essay due" does not make the
   * whole day busy, and an event marked Free in Google does not either. */
  busy: boolean;
};

export type BusyBlock = { start: string; end: string };

export type CalendarWindowReason = 'not_connected' | 'revoked' | 'rate_limited' | 'error' | null;

export type CalendarWindow = {
  /** False whenever the coach should reason without calendar context. */
  connected: boolean;
  /** Why it is unusable, when it is. Null on a good window. */
  reason: CalendarWindowReason;
  /** The member's calendar time zone (IANA), e.g. "America/Toronto" — the coach needs this to say
   * "Friday" and mean the member's Friday. Null when unknown. */
  timeZone: string | null;
  from: string;
  to: string;
  /** The instant every derived field below was computed against. */
  now: string;
  events: CalendarEvent[];
  /** Merged, non-overlapping busy intervals inside the window. */
  busy: BusyBlock[];
  /** True if the member is in a busy block RIGHT NOW — the "don't nudge during class" signal
   * (APP_BLOCKER_SPEC §C2). */
  busyNow: boolean;
  /** When the current busy run ends. Null when they're free now. */
  freeAt: string | null;
  /** When the next busy block starts. Null when they're free for the rest of the window —
   * this is the "you're free till 2pm" signal. */
  freeUntil: string | null;
  fetchedAt: string;
  /** True when served from the brief window cache rather than a live Google fetch. */
  cached: boolean;
};

type GetCalendarWindowOptions = {
  /** Window start. Defaults to now. */
  from?: string | Date;
  /** Window end. Defaults to from + DEFAULT_WINDOW_DAYS. */
  to?: string | Date;
  /** The instant to evaluate busyNow/freeAt/freeUntil against. Defaults to now. */
  now?: string | Date;
  /** Skip the cache. Still subject to MAX_FETCHES_PER_HOUR. */
  force?: boolean;
};

/**
 * The one call the AI coach service makes. `admin` must be a service-role client — this reads a
 * table with no RLS policies by design (migration 0105).
 */
export async function getCalendarWindow(
  admin: SupabaseClient,
  userId: string,
  options: GetCalendarWindowOptions = {}
): Promise<CalendarWindow> {
  const now = toDate(options.now) ?? new Date();
  const from = toDate(options.from) ?? now;
  const to = toDate(options.to) ?? new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    return await loadWindow(admin, userId, from, to, now, options.force === true);
  } catch (e) {
    // Nothing about a calendar is worth failing a coach message over.
    console.error('[gcal] window failed', userId, e instanceof Error ? e.message : e);
    return emptyWindow(from, to, now, 'error');
  }
}

async function loadWindow(
  admin: SupabaseClient,
  userId: string,
  from: Date,
  to: Date,
  now: Date,
  force: boolean
): Promise<CalendarWindow> {
  const { data: connection } = await admin
    .from('google_calendar_connections')
    .select('refresh_token_encrypted, scopes, fetch_count, fetch_window_started_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!connection) return emptyWindow(from, to, now, 'not_connected');

  // A grant that predates a scope change (or was narrowed on Google's side) can't serve events —
  // treat it as not connected rather than firing a request Google would 403.
  if (connection.scopes && !connection.scopes.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
    return emptyWindow(from, to, now, 'not_connected');
  }

  const cached = force ? null : await readCache(admin, userId, from, to, now);
  if (cached) return cached;

  if (!withinRateLimit(connection, now)) {
    // Prefer stale-but-real over nothing: an expired cache still describes this week's exams
    // better than an empty window does.
    const stale = await readCache(admin, userId, from, to, now, { ignoreExpiry: true });
    return stale ?? emptyWindow(from, to, now, 'rate_limited');
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(await decryptSecret(connection.refresh_token_encrypted));
  } catch (e) {
    if (e instanceof GoogleGrantRevokedError) {
      // Google-side revocation, honored (spec: "respects Google-side revocation"). The member
      // revoked Philoi in their Google account, or the grant expired — forget it on our side too,
      // so Connected Apps stops claiming a connection that no longer exists.
      await forgetConnection(admin, userId);
      return emptyWindow(from, to, now, 'revoked');
    }
    throw e;
  }

  // Fetch and cache a window that runs CACHE_TTL_MINUTES PAST the one that was asked for, and
  // this is load-bearing rather than a rounding nicety. `from`/`to` default to "now" and
  // "now + 21 days", so every later call asks for a window shifted a few minutes further out —
  // and readCache only reuses a cached window that fully CONTAINS the requested one. Without the
  // overhang, a cache entry would be stale-by-shift the instant it was written and the TTL would
  // never once be reached. The overhang is exactly the TTL, so any call the cache is still alive
  // for is a call it covers. The caller still gets only what it asked for: buildWindow filters
  // back down to [from, to].
  const fetchTo = new Date(to.getTime() + CACHE_TTL_MINUTES * 60 * 1000);
  const { events, timeZone } = await fetchWindow(accessToken, from, fetchTo);
  await writeCache(admin, userId, from, fetchTo, events, timeZone, now);
  await recordFetch(admin, userId, connection, now);

  return buildWindow(events, timeZone, from, to, now, now, false);
}

// ── Google API ──────────────────────────────────────────────────────────────────────────────

class GoogleGrantRevokedError extends Error {}

/** Access tokens are minted per fetch and never stored — one less secret at rest, and Google's
 * refresh endpoint is the cheapest call in this whole path. */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_WEB_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_WEB_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant is Google's answer for revoked-by-user, expired, and password-reset — every
    // one of which means this refresh token is dead for good, not retryable.
    if (body?.error === 'invalid_grant') throw new GoogleGrantRevokedError('Google grant is no longer valid.');
    throw new Error(`Google token refresh failed (${res.status}): ${body?.error ?? 'unknown'}`);
  }
  if (typeof body.access_token !== 'string') throw new Error('Google returned no access token.');
  return body.access_token;
}

/** Best-effort revocation at Google (gcal-disconnect). Returns whether Google accepted it —
 * a false here must never stop us deleting our own row. */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    });
    // 400 with error=invalid_token means it was already revoked — the end state we wanted.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

type RawEvent = {
  summary?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

async function fetchWindow(
  accessToken: string,
  from: Date,
  to: Date
): Promise<{ events: CalendarEvent[]; timeZone: string | null }> {
  const calendars = await listCalendars(accessToken);
  const timeZone = calendars.find((c) => c.primary)?.timeZone ?? calendars[0]?.timeZone ?? null;

  // allSettled, not all: a single subscribed calendar that 403s (a shared course calendar whose
  // owner changed its sharing) must not cost the member their whole window.
  const results = await Promise.allSettled(calendars.map((c) => listEvents(accessToken, c, from, to)));

  const events = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_EVENTS);

  return { events, timeZone };
}

type CalendarRef = { id: string; name: string; primary: boolean; timeZone: string | null };

async function listCalendars(accessToken: string): Promise<CalendarRef[]> {
  const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  url.searchParams.set('minAccessRole', 'reader');
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('fields', 'items(id,summary,primary,selected,deleted,timeZone)');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google calendarList failed (${res.status}).`);
  const body = await res.json();

  const items: {
    id: string;
    summary?: string;
    primary?: boolean;
    selected?: boolean;
    deleted?: boolean;
    timeZone?: string;
  }[] = body.items ?? [];

  const usable = items
    .filter((i) => i.id && !i.deleted)
    // `selected` is the member's own "show this calendar" toggle — an unticked calendar is one
    // they have chosen not to look at, so we don't coach off it either. Absent means selected.
    .filter((i) => i.selected !== false)
    .map((i) => ({ id: i.id, name: i.summary ?? 'Calendar', primary: i.primary === true, timeZone: i.timeZone ?? null }));

  // Primary first, so the MAX_CALENDARS cut never drops the calendar that matters most.
  const primary = usable.filter((c) => c.primary);
  const rest = usable.filter((c) => !c.primary);
  return [...primary, ...rest].slice(0, MAX_CALENDARS);
}

async function listEvents(accessToken: string, calendar: CalendarRef, from: Date, to: Date): Promise<CalendarEvent[]> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events`);
  url.searchParams.set('timeMin', from.toISOString());
  url.searchParams.set('timeMax', to.toISOString());
  // Recurring events expanded into real instances — "Tuesday 10am lecture" has to be a set of
  // dated blocks before it can mean anything to free/busy reasoning.
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '100');
  // MINIMIZATION, enforced at the wire: this fields mask is why descriptions, locations,
  // attendee identities, conferencing links and event ids never even reach this process.
  url.searchParams.set('fields', 'items(summary,status,transparency,start,end,attendees(self,responseStatus))');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google events failed for ${calendar.name} (${res.status}).`);
  const body = await res.json();

  return ((body.items ?? []) as RawEvent[]).flatMap((raw) => normalizeEvent(raw, calendar) ?? []);
}

function normalizeEvent(raw: RawEvent, calendar: CalendarRef): CalendarEvent | null {
  if (raw.status === 'cancelled') return null;

  const startRaw = raw.start?.dateTime ?? raw.start?.date;
  const endRaw = raw.end?.dateTime ?? raw.end?.date;
  if (!startRaw || !endRaw) return null;

  // An invite they turned down isn't a commitment, and coaching around it would be wrong twice
  // over — it would block a genuinely free window AND read as a deadline.
  const declined = raw.attendees?.some((a) => a.self && a.responseStatus === 'declined');
  if (declined) return null;

  const allDay = !raw.start?.dateTime;

  return {
    title: (raw.summary ?? '(no title)').slice(0, 200),
    start: startRaw,
    end: endRaw,
    allDay,
    calendar: calendar.name,
    // An all-day event is a DEADLINE, not an occupancy — "Essay due" all day Friday must not make
    // Friday look like a day the member is in class and can't be nudged. Google's own
    // transparency flag ("Free"/"Busy") is honored for timed events.
    busy: !allDay && raw.transparency !== 'transparent',
  };
}

// ── Derived free/busy ───────────────────────────────────────────────────────────────────────

function buildWindow(
  events: CalendarEvent[],
  timeZone: string | null,
  from: Date,
  to: Date,
  now: Date,
  fetchedAt: Date,
  cached: boolean
): CalendarWindow {
  const inWindow = events.filter((e) => {
    const start = Date.parse(e.start);
    const end = Date.parse(e.end);
    return Number.isFinite(start) && Number.isFinite(end) && end >= from.getTime() && start <= to.getTime();
  });

  const busy = mergeBusy(inWindow);
  const nowMs = now.getTime();
  const current = busy.find((b) => Date.parse(b.start) <= nowMs && Date.parse(b.end) > nowMs) ?? null;
  const next = busy.find((b) => Date.parse(b.start) > nowMs) ?? null;

  return {
    connected: true,
    reason: null,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    now: now.toISOString(),
    events: inWindow,
    busy,
    busyNow: current !== null,
    freeAt: current?.end ?? null,
    freeUntil: current ? null : (next?.start ?? null),
    fetchedAt: fetchedAt.toISOString(),
    cached,
  };
}

/** Overlapping and back-to-back blocks collapse into one, so "9-10 lecture, 10-11 lab" reads as a
 * single busy run and freeAt lands at 11 rather than at 10. */
function mergeBusy(events: CalendarEvent[]): BusyBlock[] {
  const intervals = events
    .filter((e) => e.busy)
    .map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((i) => ({ start: new Date(i.start).toISOString(), end: new Date(i.end).toISOString() }));
}

function emptyWindow(from: Date, to: Date, now: Date, reason: CalendarWindowReason): CalendarWindow {
  return {
    connected: false,
    reason,
    timeZone: null,
    from: from.toISOString(),
    to: to.toISOString(),
    now: now.toISOString(),
    events: [],
    busy: [],
    busyNow: false,
    freeAt: null,
    freeUntil: null,
    fetchedAt: now.toISOString(),
    cached: false,
  };
}

// ── Cache + rate limit ──────────────────────────────────────────────────────────────────────

async function readCache(
  admin: SupabaseClient,
  userId: string,
  from: Date,
  to: Date,
  now: Date,
  opts: { ignoreExpiry?: boolean } = {}
): Promise<CalendarWindow | null> {
  const { data } = await admin
    .from('google_calendar_window_cache')
    .select('window_from, window_to, payload, fetched_at, expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;
  if (!opts.ignoreExpiry && Date.parse(data.expires_at) <= now.getTime()) return null;
  // Only reusable if the cached window actually CONTAINS the asked-for one.
  if (Date.parse(data.window_from) > from.getTime() || Date.parse(data.window_to) < to.getTime()) return null;

  const payload = data.payload as { events?: CalendarEvent[]; timeZone?: string | null };
  // busyNow/freeAt/freeUntil are recomputed against the caller's `now`, never replayed from the
  // cache — a ten-minute-old "not in class" would be exactly the wrong thing to nudge on.
  return buildWindow(payload.events ?? [], payload.timeZone ?? null, from, to, now, new Date(data.fetched_at), true);
}

async function writeCache(
  admin: SupabaseClient,
  userId: string,
  from: Date,
  to: Date,
  events: CalendarEvent[],
  timeZone: string | null,
  now: Date
): Promise<void> {
  await admin.from('google_calendar_window_cache').upsert({
    user_id: userId,
    window_from: from.toISOString(),
    window_to: to.toISOString(),
    payload: { events, timeZone },
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MINUTES * 60 * 1000).toISOString(),
  });

  // Opportunistic sweep — no cron in this project, and a cached calendar window is the last thing
  // that should outlive its usefulness sitting in a table. Cheap: one indexed delete per fetch.
  // An hour's grace past expiry keeps the stale-cache fallback above usable.
  await admin
    .from('google_calendar_window_cache')
    .delete()
    .lt('expires_at', new Date(now.getTime() - 60 * 60 * 1000).toISOString());
}

type RateLimitRow = { fetch_count: number; fetch_window_started_at: string };

function withinRateLimit(connection: RateLimitRow, now: Date): boolean {
  const windowStarted = Date.parse(connection.fetch_window_started_at);
  const hourElapsed = !Number.isFinite(windowStarted) || now.getTime() - windowStarted >= 60 * 60 * 1000;
  return hourElapsed || connection.fetch_count < MAX_FETCHES_PER_HOUR;
}

async function recordFetch(admin: SupabaseClient, userId: string, connection: RateLimitRow, now: Date): Promise<void> {
  const windowStarted = Date.parse(connection.fetch_window_started_at);
  const hourElapsed = !Number.isFinite(windowStarted) || now.getTime() - windowStarted >= 60 * 60 * 1000;

  await admin
    .from('google_calendar_connections')
    .update({
      last_fetched_at: now.toISOString(),
      fetch_count: hourElapsed ? 1 : connection.fetch_count + 1,
      fetch_window_started_at: hourElapsed ? now.toISOString() : connection.fetch_window_started_at,
    })
    .eq('user_id', userId);
}

/** Drops the grant and the cached window together. Used by the revoked-at-Google path above and
 * by gcal-disconnect. */
export async function forgetConnection(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('google_calendar_window_cache').delete().eq('user_id', userId);
  await admin.from('google_calendar_connections').delete().eq('user_id', userId);
}

// ── Prompt shaping ──────────────────────────────────────────────────────────────────────────

/**
 * Turns a window into the block the coach drops into Sonnet's context. Shared rather than left to
 * each caller so the Focus Nudge, the re-engagement check and Cindy all describe the same calendar
 * the same way — and so "what exactly did the model see?" has one answer.
 *
 * Deliberately plain text, dates written out in the member's own zone: the model reads
 * "Fri 21 Nov 09:00-11:00 - BU111 Midterm" far more reliably than it reads an ISO soup, and it
 * removes any chance of it doing timezone arithmetic itself.
 */
export function formatCalendarWindowForPrompt(window: CalendarWindow): string {
  if (!window.connected) {
    return [
      'CALENDAR: not connected.',
      'You cannot see this person’s real deadlines. Never invent one and never imply you can see their schedule — coach from their Philoi activity alone.',
    ].join(' ');
  }
  if (window.events.length === 0) {
    return [
      'CALENDAR: connected, nothing scheduled in the next few weeks.',
      'Treat their time as open. Do not claim a deadline exists.',
    ].join(' ');
  }

  const zone = window.timeZone ?? 'UTC';
  const lines: string[] = [];

  lines.push(`CALENDAR (read-only, ${zone}, now ${formatDateTime(window.now, zone)}):`);
  lines.push(
    window.busyNow
      ? `- RIGHT NOW: busy until ${formatDateTime(window.freeAt, zone)}. They are in something — do not push them to start a session now.`
      : window.freeUntil
        ? `- RIGHT NOW: free until ${formatDateTime(window.freeUntil, zone)}.`
        : '- RIGHT NOW: free, nothing else scheduled in this window.'
  );
  lines.push('- Upcoming:');

  for (const event of window.events) {
    lines.push(`  - ${formatEventWhen(event, zone)} — ${event.title} [${event.calendar}]`);
  }

  lines.push(
    'These are the raw titles from their calendar. Read them yourself: work out which are exams, deadlines, classes or personal commitments, and which course each belongs to. Only mention something if the title genuinely says so.'
  );
  return lines.join('\n');
}

function formatEventWhen(event: CalendarEvent, zone: string): string {
  // All-day events arrive as a bare "2026-08-28" — a CALENDAR DATE with no time zone, which
  // Date.parse reads as UTC midnight. Rendering that in the member's own zone shifts it a day
  // backwards for everyone west of UTC, so a Friday midterm would be handed to the model as
  // Thursday. Formatting in UTC keeps the date the one Google actually wrote.
  if (event.allDay) return `${formatDate(event.start, 'UTC')} (all day)`;
  return `${formatDateTime(event.start, zone)}-${formatTime(event.end, zone)}`;
}

function formatDateTime(iso: string | null, zone: string): string {
  if (!iso) return 'unknown';
  return `${formatDate(iso, zone)} ${formatTime(iso, zone)}`;
}

function formatDate(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone }).format(date);
}

function formatTime(iso: string, zone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone }).format(date);
}

// ── Small helpers ───────────────────────────────────────────────────────────────────────────

function toDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set on this Supabase project.`);
  return value;
}
