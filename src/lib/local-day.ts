// "Today" resets at LOCAL midnight (PHILOI_UI_SPEC.md §5) — the server has no way to know the
// caller's timezone, so every "since today" query is anchored off timestamps computed here on
// the device, not a server-side date function.

export function getLocalDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** 'YYYY-MM-DD' in the device's local calendar — NOT toISOString(), which converts to UTC. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
