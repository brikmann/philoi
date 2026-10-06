// PHILOI_UI_SPEC.md §23's locked quota tiers — free 10 clips/720p/30fps/30s, paid
// unlimited/1080p/60fps/30s (duration bumped from 10s/18s to 30s for both so a full PR set
// fits for leaderboard verification; paid still differentiates on count + resolution/fps).
// 1080p is the ceiling (no 4K, see §23's cost reasoning), so
// "paid" here is the app's own top tier, not a literal device/codec limit.
export type GymClipTier = 'free' | 'paid';

export const GYM_CLIP_TIER_CONFIG: Record<GymClipTier, { maxDurationS: number; maxSizePx: number; resolution: string }> = {
  free: { maxDurationS: 30, maxSizePx: 1280, resolution: '720p' },
  paid: { maxDurationS: 30, maxSizePx: 1920, resolution: '1080p' },
};
