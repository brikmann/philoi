// Tests for the calendar window the AI coach reasons over (gcal.ts) — run with:
//
//   deno test --allow-env supabase/functions/_shared/gcal.test.ts
//
// No network and no database: Google and the Supabase client are both stubbed, so the whole
// normalize → drop → merge → derive → cache path runs in-process. Worth having because the two
// things most likely to go wrong here are silent: a busy/free derivation that is subtly off
// (the coach nudges someone mid-lecture) and a date that renders a day out (the coach tells
// someone their Friday midterm is on Thursday). Both were real, and both are pinned below.
import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';

import { formatCalendarWindowForPrompt, getCalendarWindow } from './gcal.ts';
import { decryptSecret, encryptSecret } from './token-crypto.ts';

Deno.env.set('GCAL_TOKEN_ENC_KEY', btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
Deno.env.set('GOOGLE_WEB_CLIENT_ID', 'web-id');
Deno.env.set('GOOGLE_WEB_CLIENT_SECRET', 'web-secret');

// Mid-lecture, so busyNow has something to be true about.
const NOW = new Date('2026-08-22T14:10:00Z');

// deno-lint-ignore no-explicit-any
type Any = any;

function makeAdmin(state: { connection: Any; cache: Any }) {
  function table(name: string) {
    const chain: Any = {
      select: () => chain,
      eq: () => chain,
      lt: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: name === 'google_calendar_connections' ? state.connection : state.cache }),
      upsert: (row: Any) => {
        if (name === 'google_calendar_window_cache') state.cache = row;
        return Promise.resolve({ error: null });
      },
      update: () => chain,
      delete: () => chain,
      then: (resolve: Any) => resolve({ error: null }),
    };
    return chain;
  }
  return { from: table } as Any;
}

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Any;
}

type Counters = { tokenRefreshes: number; eventFetches: number; refreshError: string | null };

function stubGoogle(counters: Counters) {
  globalThis.fetch = ((input: Any) => {
    const url = String(input);

    if (url.includes('oauth2.googleapis.com/token')) {
      counters.tokenRefreshes++;
      if (counters.refreshError) return Promise.resolve(json({ error: counters.refreshError }, 400));
      return Promise.resolve(json({ access_token: 'at-1', expires_in: 3599 }));
    }

    if (url.includes('/users/me/calendarList')) {
      return Promise.resolve(
        json({
          items: [
            { id: 'primary', summary: 'Noah', primary: true, timeZone: 'America/Toronto' },
            { id: 'bu111@group', summary: 'BU111', selected: true, timeZone: 'America/Toronto' },
            { id: 'muted@group', summary: 'Muted', selected: false },
            { id: 'gone@group', summary: 'Deleted', deleted: true },
          ],
        })
      );
    }

    if (url.includes('/events')) {
      counters.eventFetches++;
      if (url.includes('bu111%40group')) {
        return Promise.resolve(
          json({
            items: [
              // The midterm — an all-day DEADLINE, not an occupancy.
              { summary: 'BU111 Midterm', status: 'confirmed', start: { date: '2026-08-28' }, end: { date: '2026-08-29' } },
            ],
          })
        );
      }
      return Promise.resolve(
        json({
          items: [
            // Back-to-back, must merge into one 14:00-14:16 run.
            { summary: 'Lecture', start: { dateTime: '2026-08-22T14:00:00Z' }, end: { dateTime: '2026-08-22T14:12:00Z' } },
            { summary: 'Lab', start: { dateTime: '2026-08-22T14:12:00Z' }, end: { dateTime: '2026-08-22T14:16:00Z' } },
            // Marked "Free" in Google — present, but not busy.
            {
              summary: 'Gym (free)',
              transparency: 'transparent',
              start: { dateTime: '2026-08-22T16:00:00Z' },
              end: { dateTime: '2026-08-22T17:00:00Z' },
            },
            // Declined — dropped entirely; it is not a commitment.
            {
              summary: 'Party',
              attendees: [{ self: true, responseStatus: 'declined' }],
              start: { dateTime: '2026-08-22T18:00:00Z' },
              end: { dateTime: '2026-08-22T19:00:00Z' },
            },
            // Cancelled — dropped entirely.
            { summary: 'Ghost', status: 'cancelled', start: { dateTime: '2026-08-22T20:00:00Z' }, end: { dateTime: '2026-08-22T21:00:00Z' } },
            // Tomorrow's block — the next busy run after now.
            { summary: 'Seminar', start: { dateTime: '2026-08-23T09:00:00Z' }, end: { dateTime: '2026-08-23T10:00:00Z' } },
          ],
        })
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

Deno.test('the calendar window the coach sees', async (t) => {
  const realFetch = globalThis.fetch;
  const counters: Counters = { tokenRefreshes: 0, eventFetches: 0, refreshError: null };
  const state: { connection: Any; cache: Any } = { connection: null, cache: null };
  const admin = makeAdmin(state);
  stubGoogle(counters);

  let cipher = '';

  await t.step('the refresh token round-trips, versioned, with a fresh IV each time', async () => {
    cipher = await encryptSecret('1//refresh-token-value');
    assert(cipher.startsWith('v1.'));
    assert(!cipher.includes('refresh-token-value'));
    assertEquals(await decryptSecret(cipher), '1//refresh-token-value');
    assertNotEquals(cipher, await encryptSecret('1//refresh-token-value'));
  });

  await t.step('no connection reads as an empty window, and the prompt says so plainly', async () => {
    const w = await getCalendarWindow(admin, 'u1', { now: NOW });
    assertEquals(w.connected, false);
    assertEquals(w.reason, 'not_connected');
    assertEquals(w.busyNow, false);
    assertMatch(formatCalendarWindowForPrompt(w), /not connected/);
  });

  await t.step('a live fetch normalizes, drops and merges correctly', async () => {
    state.connection = {
      refresh_token_encrypted: cipher,
      scopes: 'https://www.googleapis.com/auth/calendar.readonly openid email',
      fetch_count: 0,
      fetch_window_started_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    };

    const w = await getCalendarWindow(admin, 'u1', { now: NOW });

    assertEquals(w.connected, true);
    assertEquals(w.reason, null);
    assertEquals(w.timeZone, 'America/Toronto', "the primary calendar's zone wins");
    assertEquals(counters.eventFetches, 2, 'unticked and deleted calendars are never fetched');

    assertEquals(
      w.events.map((e) => e.title),
      ['Lecture', 'Lab', 'Gym (free)', 'Seminar', 'BU111 Midterm'],
      'declined and cancelled dropped; sorted by start; both calendars merged'
    );

    const midterm = w.events.find((e) => e.title === 'BU111 Midterm')!;
    assertEquals(midterm.allDay, true);
    assertEquals(midterm.busy, false, 'an all-day deadline does not occupy the day');
    assertEquals(midterm.calendar, 'BU111', 'the source calendar carries the course tie');
    assertEquals(w.events.find((e) => e.title === 'Gym (free)')!.busy, false, 'Google "Free" is honored');

    assertEquals(w.busyNow, true, 'now is inside the lecture — the do-not-nudge signal');
    assertEquals(w.freeAt, '2026-08-22T14:16:00.000Z', 'lecture+lab merge, so free at 14:16 rather than 14:12');
    assertEquals(w.freeUntil, null);
    assertEquals(w.busy.length, 2);
    assertEquals(w.cached, false);
  });

  await t.step('a second call inside the TTL never touches Google', async () => {
    const before = { ...counters };
    const w = await getCalendarWindow(admin, 'u1', { now: NOW });
    assertEquals(w.cached, true);
    assertEquals(counters.tokenRefreshes, before.tokenRefreshes);
    assertEquals(counters.eventFetches, before.eventFetches);
  });

  await t.step('busyNow/freeAt/freeUntil are recomputed per call, never replayed from the cache', async () => {
    // Eight minutes on: still a cache hit, but the busy run has ended. A stale "in class" here
    // would silence the coach for no reason; a stale "free" would nudge someone mid-lecture.
    const w = await getCalendarWindow(admin, 'u1', { now: new Date('2026-08-22T14:18:00Z') });
    assertEquals(w.cached, true);
    assertEquals(w.busyNow, false);
    assertEquals(w.freeAt, null);
    assertEquals(w.freeUntil, '2026-08-23T09:00:00.000Z');
    assertMatch(formatCalendarWindowForPrompt(w), /RIGHT NOW: free until/);
  });

  await t.step('the prompt block renders dates the member would recognize', async () => {
    const prompt = formatCalendarWindowForPrompt(await getCalendarWindow(admin, 'u1', { now: NOW }));
    assertMatch(prompt, /America\/Toronto/);
    assertMatch(prompt, /BU111 Midterm \[BU111\]/);
    // The regression that matters: 2026-08-28 is a FRIDAY. Rendered in the member's own zone an
    // all-day date lands on Thursday for everyone west of UTC, and the coach would confidently
    // name the wrong day for the exam.
    assertMatch(prompt, /Fri 28 Aug \(all day\)/);
    assertMatch(prompt, /raw titles/, 'the model is told to interpret the titles, not us');
  });

  await t.step('a grant revoked at Google is forgotten on our side too', async () => {
    counters.refreshError = 'invalid_grant';
    state.cache = null;
    const w = await getCalendarWindow(admin, 'u1', { now: NOW, force: true });
    assertEquals(w.connected, false);
    assertEquals(w.reason, 'revoked');
    counters.refreshError = null;
  });

  await t.step('a rate-limited fetch serves the stale window rather than nothing', async () => {
    state.connection.fetch_count = 999;
    state.connection.fetch_window_started_at = NOW.toISOString();
    state.cache = {
      window_from: new Date(NOW.getTime() - 1000).toISOString(),
      window_to: new Date(NOW.getTime() + 40 * 24 * 3600 * 1000).toISOString(),
      payload: {
        events: [
          { title: 'Old exam', start: '2026-08-25T09:00:00Z', end: '2026-08-25T11:00:00Z', allDay: false, calendar: 'Noah', busy: true },
        ],
        timeZone: 'America/Toronto',
      },
      fetched_at: new Date(NOW.getTime() - 3600 * 1000).toISOString(),
      expires_at: new Date(NOW.getTime() - 1800 * 1000).toISOString(),
    };

    const w = await getCalendarWindow(admin, 'u1', { now: NOW });
    assertEquals(w.connected, true, 'stale but real beats an empty window');
    assertEquals(w.events[0].title, 'Old exam');
  });

  await t.step('a Google outage degrades quietly instead of throwing at the coach', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    state.cache = null;
    state.connection.fetch_count = 0;

    const w = await getCalendarWindow(admin, 'u1', { now: NOW, force: true });
    assertEquals(w.connected, false);
    assertEquals(w.reason, 'error');
  });

  globalThis.fetch = realFetch;
});
