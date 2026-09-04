import * as ImagePicker from 'expo-image-picker';

import { uploadCampfirePhoto } from '@/lib/api/messages';
import { supabase } from '@/lib/supabase';
import type { GoalClaimResult, VouchRequest } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE HONOR PATH — "I did it", and the friend who says whether you did (migration 0164).
//
// CHALLENGE_CINDY_SCOPING.md §Verification, DIFFICULTY_SCOPING.md §Anti-cheese.
//
// A described feat — "learn a backflip" — has nothing the app can measure, so it completes by
// somebody SAYING it happened. That is the whole reason the verifiability discount exists: an
// unproven claim pays a band down and can never reach a top box. This file is the surface where a
// claimer escapes that discount, and it can do so in exactly two ways:
//
//   · ATTACH PROOF — a photo or clip. Nothing reads it, server-side or otherwise; what it buys is
//     that the claim is now attached to something a human can look at and report.
//   · ASK FRIENDS — two distinct people say yes inside 48 hours.
//
// 🔒 NEITHER PATH GRANTS ANYTHING. The client cannot say what a claim is worth, cannot set the
// verification level, and cannot complete the goal: claim_goal_complete and submit_vouch decide,
// and the payout fires once, server-side, from the level they settle on. All this file does is
// carry an intent and an optional file path.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Mark an honour goal done.
 *
 * `proofPath` is a storage key already uploaded to the campfire-photos bucket — the RPC refuses a
 * path that is not under the caller's own id, the same rule the bucket policy enforces, because a
 * security-definer function cannot see the bucket's policy.
 *
 * Three outcomes, and the caller should render all three:
 *   · proof given            → resolved at 'vouched' immediately. Full band.
 *   · friends asked          → 'pending_vouch' with a deadline. Nothing is paid yet.
 *   · nothing given          → resolved at 'honor' now. One band down, and a legitimate choice.
 */
export async function claimGoalComplete(input: {
  goalId: string;
  proofPath?: string | null;
  voucherIds?: string[] | null;
}): Promise<GoalClaimResult> {
  const { data, error } = await supabase.rpc('claim_goal_complete', {
    p_goal_id: input.goalId,
    p_proof_path: input.proofPath ?? null,
    p_voucher_ids: input.voucherIds?.length ? input.voucherIds : null,
  });
  if (error) throw error;
  return data as GoalClaimResult;
}

/**
 * Pick and upload a proof image, returning the storage path to hand to claimGoalComplete.
 *
 * Reuses the campfire photo pipeline whole rather than standing up a "proof" bucket: it already
 * does the own-id path prefix the RPC checks for, already has its storage policy, and a second
 * bucket would be a second policy to keep in step with it. Returns null if the picker was
 * cancelled, which is not an error.
 */
export async function pickAndUploadProof(userId: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  if (result.canceled || !result.assets[0]) return null;
  return uploadCampfirePhoto(userId, result.assets[0].uri);
}

/** What the vouch prompt renders. Readable by anyone holding the link — submit_vouch is where
 *  authority lives, so this being open is deliberate (see the RPC's own comment). */
export async function getVouchRequest(goalId: string): Promise<VouchRequest> {
  const { data, error } = await supabase.rpc('get_vouch_request', { p_goal_id: goalId });
  if (error) throw error;
  return data as VouchRequest;
}

/**
 * Answer someone's claim.
 *
 * A "Nah" is recorded and is NOT a penalty — the spec is explicit that a reward can only fail to
 * go up, never come down. It exists so a friend who genuinely does not believe it has something
 * honest to tap other than closing the screen.
 *
 * `counted: false` comes back when an anti-collusion rule capped the vouch (same pair twice in 30
 * days, five a week from one giver). The vouch is still recorded; it just does not count toward
 * the two. Worth surfacing gently rather than silently — see the screen.
 */
export async function submitVouch(goalId: string, verdict: boolean): Promise<{
  counted: boolean;
  vouches: number;
  resolved: boolean;
}> {
  const { data, error } = await supabase.rpc('submit_vouch', { p_goal_id: goalId, p_verdict: verdict });
  if (error) throw error;
  return data as { counted: boolean; vouches: number; resolved: boolean };
}
