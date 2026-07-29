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
