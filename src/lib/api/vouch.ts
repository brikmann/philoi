import * as ImagePicker from 'expo-image-picker';

import { uploadCampfireClip } from '@/lib/api/messages';
import { supabase } from '@/lib/supabase';
import type { ClaimStatus, GoalClaimResult, VouchRequest } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE HONOR PATH — "I did it", and the friend who says whether you did (migration 0164).
//
// CHALLENGE_CINDY_SCOPING.md §Verification, DIFFICULTY_SCOPING.md §Anti-cheese.
//
// A described feat — "learn a backflip" — has nothing the app can measure, so it completes by
// somebody SAYING it happened. That is the whole reason the verifiability discount exists: an
// unproven claim pays a band down and can never reach a top box.
//
// THERE IS EXACTLY ONE WAY OUT OF THE DISCOUNT: two friends. A clip does not buy it (0165) — the
// clip is a social signal shown to those friends so their yes means something, per mock 176. We
// cannot verify media and do not try to; the human who knows you is the check.
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
 * TWO outcomes, not three (migration 0165):
 *   · friends asked → 'pending_vouch' with a deadline. Nothing is paid yet, and the clip (if any)
 *     goes to them.
 *   · nobody asked  → resolved at 'honor' now, WITH OR WITHOUT a clip. One band down, and a
 *     legitimate choice.
 *
 * Attaching media never settles anything by itself. 0164 let it, which meant any video at all
 * bought a full box tier with no human in the loop; 0165 closed that.
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
 * Capture proof with the CAMERA and upload it, returning the storage path.
 *
 * 🔴 CAMERA ONLY — `launchCameraAsync`, never `launchImageLibraryAsync`. Mock 176 is explicit and
 * the reasoning is the whole point of the feature:
 *
 *     "proof is recorded live in the app (no gallery uploads)... which kills the 'upload a random
 *      backflip off YouTube' cheat"
 *
 * We cannot verify a video is authentic or of this person — media forensics and ID matching are a
 * liability and impractical, and the spec refuses that path outright. What we CAN do is make the
 * cheap cheat unavailable: a gallery picker accepts anything that ever landed on the device, a
 * camera does not. Swapping this back to the library would silently reopen it.
 *
 * The clip is still only a SIGNAL. It does not settle anything on its own (migration 0165) — it
 * goes to the friends being asked, so their yes is informed rather than blind.
 *
 * Reuses the campfire photo pipeline rather than standing up a "proof" bucket: it already writes
 * under the own-id prefix the RPC checks for and already has its storage policy. Returns null on
 * cancel, which is not an error.
 */
export async function captureAndUploadProof(userId: string): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Philoi needs the camera to record proof.');

  // `mediaTypes: ['videos']` — a CLIP, per §2 and mock 176 frame D, which draws a ▶ and a stamp.
  // A still of a landed backflip is barely evidence of anything; the motion is the whole signal a
  // friend is being asked to read. 15s is the mock's "short clip": long enough for a run-up and a
  // landing, short enough to keep the upload inside the bucket's ceiling.
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: PROOF_MAX_SECONDS,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets[0]) return null;

  return uploadCampfireClip(userId, await compressForUpload(result.assets[0].uri));
}

/** The mock's "short clip". Also the number the copy quotes, so it lives in one place. */
export const PROOF_MAX_SECONDS = 15;

/**
 * Shrink a capture before it goes up.
 *
 * A raw 15s camera capture can be tens of megabytes — well past the bucket's 25 MB ceiling, which
 * would fail the upload and lose a claim the user just recorded. react-native-compressor is a
 * native module, so it is required lazily at the call site rather than at module scope (the same
 * reasoning gym-clip-recorder.tsx documents: an older binary that never compiled it in must
 * degrade, not crash on bundle eval).
 *
 * On failure it returns the ORIGINAL uri rather than throwing. That is deliberate — the bucket also
 * accepts video/quicktime, so an uncompressed short clip usually still fits, and a claim that
 * uploads a big file beats a claim that cannot be made at all. If it is genuinely too large the
 * storage error surfaces at upload with a message the screen already renders.
 */
async function compressForUpload(uri: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import, see above
    const { Video } = require('react-native-compressor') as typeof import('react-native-compressor');
    return await Video.compress(uri, { compressionMethod: 'auto', maxSize: 720 });
  } catch {
    return uri;
  }
}

/**
 * The claimant's own view of a pending claim (mock 176 frame C) — who was asked, who has answered,
 * how long is left.
 *
 * Owner-only server-side. getVouchRequest is the voucher's half and is deliberately open to anyone
 * holding the notification link; this one names the roster, so it is not.
 */
export async function getClaimStatus(goalId: string): Promise<ClaimStatus> {
  const { data, error } = await supabase.rpc('get_claim_status', { p_goal_id: goalId });
  if (error) throw error;
  return data as ClaimStatus;
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
