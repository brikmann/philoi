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

// "18h left" / "2d left" — a challenge's time-remaining chip (social-challenge-card.tsx, the
// active-challenge marker, and the Watch spectator screen all show the same countdown).
export function formatTimeLeft(endsAt: string | null): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ending soon';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h left`;
  return `${Math.ceil(hours / 24)}d left`;
}
