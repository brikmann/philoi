import type { LiftStoryStat } from '@/components/story-sticker/lift-story-sheet';
import type { AgoraAttachSnapshot, AgoraItem } from '@/types/database';

// A gym post -> the lift sticker's stat (Gym Spark §6). Facts come off the post's FROZEN
// attachments, in order of how much the server vouches for them:
//
//   1. a 'pr' attachment — create_agora_post re-read personal_records and froze exercise / weight
//      (lb) / reps. This is what the lift-import path attaches, so it is the verified lift.
//   2. a 'lockin' attachment whose strength half (0192) has a set flagged is_pr with a weight —
//      the heaviest such set. Still server-frozen, still verified.
//   3. neither, but the post is flagged is_pr (the composer's "Attach PR" chip) — the caption
//      becomes the headline and NO numbers are printed. A number on a story is a claim; one that
//      never came off a logged set would be the app inventing it.
//
// Null when the post is none of those — the share action is not offered.

type PostLike = Pick<AgoraItem, 'attachments' | 'body' | 'handle'> & { is_pr?: boolean | null };

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fromPrSnapshot(s: AgoraAttachSnapshot): Omit<LiftStoryStat, 'handle'> | null {
  const weight = num(s.weight);
  if (!s.exercise || weight == null) return null;
  return { exercise: s.exercise, weight, reps: num(s.reps) ?? 1, isPr: true, verified: true };
}

function fromLockinSnapshot(s: AgoraAttachSnapshot): Omit<LiftStoryStat, 'handle'> | null {
  let best: Omit<LiftStoryStat, 'handle'> | null = null;
  for (const set of s.sets ?? []) {
    const weight = num(set.weight);
    if (!set.is_pr || weight == null) continue;
    if (!best || weight > (best.weight ?? 0)) {
      best = { exercise: set.exercise, weight, reps: num(set.reps) ?? 1, isPr: true, verified: true };
    }
  }
  return best;
}

export function liftStatFromPost(item: PostLike): LiftStoryStat | null {
  const handle = item.handle ?? null;
  const attachments = item.attachments ?? [];

  for (const a of attachments) {
    if (a.kind !== 'pr') continue;
    const stat = fromPrSnapshot(a.snapshot ?? {});
    if (stat) return { ...stat, handle };
  }
  for (const a of attachments) {
    if (a.kind !== 'lockin') continue;
    const stat = fromLockinSnapshot(a.snapshot ?? {});
    if (stat) return { ...stat, handle };
  }
  if (item.is_pr === true) {
    return { exercise: '', weight: null, reps: null, isPr: true, handle, caption: item.body, verified: false };
  }
  return null;
}
