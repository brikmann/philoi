// One definition of "this week" for the whole app (punchlist 8 §5).
//
// Before this, every weekly reset landed on a different day because each one rolled its own math:
// the shop floored `Date.now() / WEEK_MS`, which is anchored to the Unix epoch — a THURSDAY; the
// server used `date_trunc('week', …)`, which is ISO and therefore MONDAY; and the Forge Pass
// counted weeks from the season start, so it rolled on whatever weekday the season happened to
// begin. Three "weekly" timers, three different weekdays, one very confused user.
//
// The anchor is Sunday 00:00 **UTC**, and the UTC part is load-bearing rather than lazy. Weekly
// challenges are shared between friends who may sit in different timezones; if the window closed at
// local midnight, a shared challenge would end at a different instant for each member and the
// standings would depend on who you asked. A countdown ("6d 4h") reads the same everywhere
// regardless of the anchor's timezone, so nothing is lost by fixing it to UTC.
//
// The SQL side of this lives in migration 0071 (`week_start()`, `week_index()`, `week_key()`) and
// MUST stay in agreement with the four functions below — they are the same boundary expressed
// twice, and a weekly achievement credited on both sides depends on them producing the same key.

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sun 4 Jan 1970 00:00 UTC — the first Sunday after the epoch, which fell on a Thursday. Shifting
 * by three days before dividing is what moves the week boundary off Thursday and onto Sunday.
 */
export const SUNDAY_ANCHOR_MS = 3 * 24 * 60 * 60 * 1000;

/** Weeks elapsed since the anchor Sunday. Stable for seven days, then increments by one. */
export const weekIndex = (now: number = Date.now()): number => Math.floor((now - SUNDAY_ANCHOR_MS) / WEEK_MS);

/** Epoch ms of the Sunday 00:00 UTC that opened the week containing `now`. */
export const weekStart = (now: number = Date.now()): number => SUNDAY_ANCHOR_MS + weekIndex(now) * WEEK_MS;

/** Epoch ms of the next Sunday 00:00 UTC — when everything weekly rolls over. */
export const nextWeekReset = (now: number = Date.now()): number => weekStart(now) + WEEK_MS;

/** Milliseconds left in the current week. Drive countdowns off this. */
export const msUntilReset = (now: number = Date.now()): number => nextWeekReset(now) - now;

/**
 * The dedupe key for anything that may happen once per week ("W2953").
 *
 * Never displayed — it exists to be compared, and its only hard requirement is that the SQL
 * `week_key()` in migration 0071 produces the identical string for the same instant. The old client
 * version counted `(now - Jan 1) / 7 days` while the server used ISO `to_char(now(), 'IYYY-"W"IW')`,
 * so the two disagreed on both the boundary and the format. Deriving it from `weekIndex` leaves one
 * number to agree on.
 */
export const weekKey = (now: number = Date.now()): string => `W${weekIndex(now)}`;

/**
 * "3d 4h 12m" — how long is left in the week, for countdown labels. Units that have run out are
 * dropped from the left so a Saturday reads "4h 12m" rather than "0d 4h 12m".
 */
export function formatWeekCountdown(msLeft: number): string {
  if (msLeft <= 0) return '0m';
  const d = Math.floor(msLeft / 86_400_000);
  const h = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  return [d > 0 ? `${d}d` : null, d > 0 || h > 0 ? `${h}h` : null, `${m}m`].filter(Boolean).join(' ');
}
