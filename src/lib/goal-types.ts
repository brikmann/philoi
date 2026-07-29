import type { Ionicons } from '@expo/vector-icons';

import type { GoalType } from '@/types/database';

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
