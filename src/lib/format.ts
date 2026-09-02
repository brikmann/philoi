// "1 session" / "2 sessions" — count-aware label so singular counts never read "1 sessions".
// Defaults to the naive +s plural; pass an explicit plural for irregular words.
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function formatSessionDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Clock-style "12:04" / "1:05:23" — the running timer + done-screen's big duration number
// (design-mocks/09, design-mocks/18), distinct from formatSessionDuration's "1h 20m" prose form.
export function formatDurationClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// "5.2 km" — a synced Strava/device activity's distance stat (§17b's cross-integration card).
export function formatDistanceKm(distanceMeters: number): string {
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

// "5:12/km" — pace for a run/ride card stat row. Guards against a near-zero distance producing
// a meaningless (or infinite) pace.
export function formatPacePerKm(distanceMeters: number, durationSeconds: number): string | null {
  if (distanceMeters < 100) return null;
  const secondsPerKm = durationSeconds / (distanceMeters / 1000);
  const min = Math.floor(secondsPerKm / 60);
  const sec = Math.round(secondsPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}/km`;
}

/** "just now" / "14m ago" / "3h ago" / "2d ago". Hoisted out of challenge-completion-card,
 * which had a private copy — the bell feed needs the same shape and two implementations of
 * "how long ago" drift. */
export function formatRelativeTime(isoDate: string): string {
  const minutes = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * "18h left" / "2d left" / "ended" — a challenge's time-remaining chip.
 *
 * 🔴 THE PAST-TENSE BUG. This used to return "ending soon" once `ends_at` had passed, which is a
 * sentence about the future written on a race that is over. Noah's device: a duel whose own body
 * read "Final · this challenge has ended" still carried "Most lock-in time · ending soon" in its
 * header and "Duration 72h · ending soon" in its rules table, because both were built from this
 * one function and this one function had no past tense.
 *
 * "ended", not "ending soon", and not "settling". A challenge is over the moment its clock runs
 * out; the settle sweep that writes the result runs afterwards, and the gap between the two is an
 * implementation detail nobody watching should be asked to hold. Callers that know the challenge
 * has SETTLED should say what happened instead — "You won", "Final" — and use this only while the
 * verdict is genuinely not in yet.
 */
export function formatTimeLeft(endsAt: string | null): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h left`;
  return `${Math.ceil(hours / 24)}d left`;
}
