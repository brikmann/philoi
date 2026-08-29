import type { Ionicons } from '@expo/vector-icons';

import type { DisciplineIconName } from '@/components/ui/discipline-icon';
import type { Challenge, ChallengeType, GoalType } from '@/types/database';

export const GOAL_TYPE_META: Record<GoalType, { label: string; emoji: string }> = {
  gym: { label: 'Gym', emoji: '🏋️' },
  run: { label: 'Run', emoji: '🏃' },
  study: { label: 'Study', emoji: '📚' },
  job_applications: { label: 'Job apps', emoji: '📝' },
  read: { label: 'Read', emoji: '📖' },
  social_media: { label: 'Social media', emoji: '📵' },
  custom: { label: 'Custom', emoji: '🎯' },
};

// The lock-in goal picker's exact set + grid order (design-mocks/07-lockin-goal-picker.html:
// Gym, Study, Run, Job apps, Read, Custom) — social_media stays a legal historical GoalType
// (old rows) but isn't offered here.
export const GOAL_TYPES: GoalType[] = ['gym', 'study', 'run', 'job_applications', 'read', 'custom'];

// Vestigial now that goals aren't persisted per-user (no more cadence to hold a user to) —
// kept type-complete only because the retired goal/create.tsx screen still references it.
export const GOAL_CADENCE_PRESETS: Record<GoalType, string[]> = {
  gym: ['3x/week', '4x/week', '5x/week', 'Daily'],
  run: ['3x/week', '4x/week', '5x/week', 'Daily'],
  study: ['5 hrs/week', '10 hrs/week', '15 hrs/week', '20 hrs/week'],
  job_applications: ['3x/week', '5x/week', 'Daily'],
  read: ['3x/week', 'Daily'],
  social_media: ['Daily'],
  custom: ['3x/week', '4x/week', 'Daily', 'Weekly'],
};

// Fire is an intensity metaphor applied to an object related to the goal, not a generic
// campfire — the object is what's "on fire," not a fire pit. Hoisted here (was
// lock-in-flame.tsx's private FLAME_THEME) since both the in-session flame AND the lock-in
// goal picker's tile grid need the same emoji/label per goal type — real illustrated/Lottie
// per-theme assets (a flaming dumbbell, a flaming pen mid-scribble, etc.) are a design-asset
// need beyond what's buildable here; this registry is the swap-in point for them later.
export const GOAL_TYPE_FLAME_META: Record<GoalType, { emoji: string; label: string }> = {
  gym: { emoji: '🏋️', label: 'dumbbell' },
  run: { emoji: '👟', label: 'shoe' },
  study: { emoji: '✏️', label: 'pen' },
  job_applications: { emoji: '📝', label: 'application' },
  read: { emoji: '📖', label: 'book' },
  social_media: { emoji: '📵', label: 'phone' },
  custom: { emoji: '🎯', label: 'target' },
};

// Vector-icon equivalent of the above — used wherever the tool needs a real recolorable icon
// instead of a fixed-color emoji: the lock-in goal picker's tiles (design-mocks/07) and the
// "goal-as-fuel object" burning in the flame during a session (PHILOI_UI_SPEC.md §13,
// design-mocks/09 — "bright cream #FFF3DC, large, and legible against the flame").
export const GOAL_TYPE_ICON: Record<GoalType, keyof typeof Ionicons.glyphMap> = {
  gym: 'barbell',
  study: 'pencil',
  run: 'walk',
  job_applications: 'document-text',
  read: 'book',
  social_media: 'phone-portrait',
  custom: 'add',
};

// ── The mock-163 discipline set ────────────────────────────────────────────────────────────────
//
// The brand vectors that replace the raw emoji and the Ionicons fallbacks above — the swap-in
// point mock 163 asks for. A surface renders `<DisciplineIcon name={GOAL_TYPE_GLYPH[type]} />`
// instead of `<Ionicons name={GOAL_TYPE_ICON[type]} />` and gets one consistent 1.8-stroke glyph
// on the same 24 grid as the nav set.
//
// GOAL_TYPE_ICON is deliberately LEFT IN PLACE rather than retyped, on the same reasoning that
// applied to both maps while this was six branches: it is read from a dozen files, and changing
// its type forces an edit into every one at once. It stays as the Ionicons fallback for any
// surface not yet swapped, and goes away when the last call site does.
//
// CHALLENGE_TYPE_ICON already did: integration swapped its last four call sites (the create
// picker, the info hero, the challenge card and the completion card) onto CHALLENGE_TYPE_GLYPH,
// so the map went with them rather than sitting here as a second answer to the same question.

export const GOAL_TYPE_GLYPH: Record<GoalType, DisciplineIconName> = {
  gym: 'gym',
  study: 'study',
  run: 'run',
  job_applications: 'jobs',
  read: 'read',
  // No vector of its own — a phone with a slash is the one "goal" that is an absence, and
  // social_media isn't offered in the picker any more (see GOAL_TYPES). The bullseye is the
  // honest stand-in rather than inventing a glyph for a type nothing renders.
  social_media: 'custom',
  custom: 'custom',
};

export const CHALLENGE_TYPE_GLYPH: Record<ChallengeType, DisciplineIconName> = {
  steps: 'steps',
  run_distance: 'run',
  ride_distance: 'ride',
  gym_visits: 'gym',
  // "Study hrs — reuses Study" (mock 163's own caption).
  study_hours: 'study',
  custom: 'custom',
  workout_minutes: 'minutes',
  strain: 'strain',
  sleep_hours: 'sleep',
};

/**
 * A personal goal in its own words — "10,000 steps", "3× gym", "2h study".
 *
 * Lived privately inside challenge-card.tsx until the auto-sync reveal needed it too: a steps goal
 * that completes from Health Connect never touches the card, so the payout screen it opens has to
 * get its label from somewhere else, and two copies of this would eventually name the same goal
 * two different things on two screens.
 *
 * `label` wins whenever the user gave the goal one — it is the name they chose, and no derived
 * phrasing beats it.
 */
export function personalGoalTitle(challenge: Pick<Challenge, 'label' | 'type' | 'target' | 'unit'>): string {
  if (challenge.label) return challenge.label;
  switch (challenge.type) {
    case 'steps':
      return `${challenge.target.toLocaleString()} steps`;
    case 'gym_visits':
      return `${challenge.target}× gym`;
    case 'study_hours':
      return `${challenge.target}h study`;
    case 'run_distance':
      return `${challenge.target}km run`;
    case 'ride_distance':
      return `${challenge.target}km ride`;
    default:
      return `${challenge.target} ${challenge.unit}`;
  }
}
