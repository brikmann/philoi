import { supabase } from '@/lib/supabase';
import type { GoalClaimResult } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE HONOR PATH — "I did it" (migration 0164, capped by 0221).
//
// A described feat — "learn a backflip" — has nothing the app can measure, so it completes by the
// owner SAYING it happened. That is why the verifiability discount exists: a self-reported claim
// pays a band down and can never reach a top box (goal_paid_band caps honour at The Furnace/Rare).
//
// ── BUILD 10 · VOUCHING REMOVED ────────────────────────────────────────────────────────────────
//
// Friend-vouching and the proof-clip flow are gone (migration 0221). A claim settles directly at
// the Unvouched (honour) tier — no proof upload, no friend picker, no 48h window. The only way to
// the full band is a sensor the app can read (verifiability 'auto'); a described feat cannot reach
// it. submitVouch / getVouchRequest / getClaimStatus and the camera-capture helper were removed
// with the flow. The single remaining call carries the intent; the server settles and pays once.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Mark an honour goal done. Settles at 'honor' server-side and fires the one payout — the client
 * cannot say what a claim is worth or set its verification level. `proofPath` / `voucherIds` are
 * accepted for signature stability with the RPC but are ignored now that vouching is removed.
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
