// The soft "alike" number (0275's score) — similarity, never status.
//
// NOAH'S OPEN DECISION (CODE_PROMPT_matchmaking.md): keep the quiet "92 alike" or go chips-only.
// Flip this to false and the shelf and the detail screen both drop the number; the reason chips
// carry the match on their own. One line, on purpose.
export const SHOW_ALIKE_SCORE = true;

/** The mix buckets 0275 computes, in the order the detail screen draws them. */
export const MIX_BUCKETS = [
  { key: 'study', label: 'Study' },
  { key: 'deep_work', label: 'Deep work' },
  { key: 'gym', label: 'Gym' },
  { key: 'run', label: 'Run' },
] as const;
