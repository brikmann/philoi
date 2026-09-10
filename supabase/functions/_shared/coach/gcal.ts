// ══════════════════════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR as coach context — GCAL_INTEGRATION_SPEC.md.
//
// 🔌 THIS IS THE SEAM, NOT THE INTEGRATION. The integration lives in `../gcal.ts`: OAuth token
// refresh, the Google fetch, normalization, free/busy merging, the minutes-long window cache and
// the per-member rate limit. This module is only the coach's side of the join — call it at the
// moment we write to the member, hand the result to the model.
//
// ⚠️ THIS FILE USED TO BE A SECOND, RIVAL IMPLEMENTATION, and it was silently broken. It selected
// `access_token, refresh_token, expires_at` from `google_calendar_connections` — columns that have
// never existed. Migration 0105 stores `refresh_token_encrypted` (AES-256-GCM, key held in an Edge
// Function secret) and deliberately stores no access token at all. So the select errored on every
// single call, the `catch` below turned that into `null`, and the coach was permanently
// calendar-blind in a way that logged nothing and failed nothing. A member could connect their
// calendar, see "Connected", and never once be coached on a real deadline.
//
// That is the failure mode this file's own header warned about and then walked into: "the null is
// deliberate, which is exactly why the misnaming was invisible". Two implementations of one
// integration is how it happened, so there is now one. Everything below delegates.
//
// 🔒 PRIVACY (spec: "calendar is sensitive"). Read-only. A rolling forward window only — never the
// past, never the whole calendar. Nothing is written back: the events build one prompt and are
// dropped. Never surfaced socially — this goes into the member's own prompt and nowhere else.
// ══════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { formatCalendarWindowForPrompt, getCalendarWindow, type CalendarWindow } from '../gcal.ts';

export type { CalendarWindow };

/**
 * The upcoming window for this member, at the moment we are writing to them.
 *
 * Never throws and never blocks a coach message: no connection, a grant revoked at Google, a
 * rate-limited fetch and a Google outage all arrive as a window with `connected: false` and a
 * `reason`. The caller handles exactly one case — no calendar context — which is
 * GCAL_INTEGRATION_SPEC's "works-without-it fallback" as a structural guarantee rather than a
 * try/catch someone remembered to add.
 *
 * Deliberately does NOT parse titles for "midterm"/"exam"/"due". The spec is explicit that Sonnet
 * interprets the raw events: the model maps "BU111 Midterm Fri 9am" onto a deadline and a course
 * tie far better than a regex, and a regex would silently miss "BU111 MT2".
 */
export async function fetchCalendarWindow(admin: SupabaseClient, userId: string): Promise<CalendarWindow> {
  return await getCalendarWindow(admin, userId);
}

/**
 * The calendar block for the prompt, in the one shape every coach surface uses.
 *
 * Shared rather than per-caller on purpose: nudge, re-engagement and chat describing the calendar
 * three different ways makes "what did the model actually see?" a question with three answers. It
 * also writes dates in the member's own zone so the model never does timezone arithmetic.
 */
export function calendarPromptBlock(window: CalendarWindow): string {
  return `<calendar>\n${formatCalendarWindowForPrompt(window)}\n</calendar>`;
}
