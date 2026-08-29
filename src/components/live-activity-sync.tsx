import { useEffect } from 'react';

import { useRankProjection } from '@/hooks/use-rank-projection';
import { useActiveSession } from '@/lib/active-session-context';
import { useEquipped } from '@/lib/economy/loadout';
import { formatProjection } from '@/lib/api/xp-rate';
import { GOAL_TYPE_META } from '@/lib/goal-types';
import { endLiveActivity, startLiveActivity, updateLiveActivity } from '@/lib/live-activity';
import { formatRankTier, nextRank, xpProgressRatio } from '@/lib/rank-tiers';

// Renders nothing. Drives the out-of-app live surfaces (#87) — the iOS Live Activity and the
// Android ongoing notification — off the one active-session store.
//
// Mounted in _layout rather than on the lock-in screen, for the same reason LoadoutSync is: the
// session outlives that screen. You can minimize the lock-in, wander to the valley, and background
// the app entirely, and the Lock Screen card has to keep counting through all of it. Anchoring this
// to a screen would tear the card down the moment you navigated away.

export function LiveActivitySync() {
  const { session, loading } = useActiveSession();
  // Only fetches while something is actually running. Rank can't move mid-session (it moves when a
  // check-in POSTS, which ends the session), so this resolves once per session rather than polling.
  const rankProjection = useRankProjection(!!session);
  // The flare is a lock-in cosmetic now (punchlist 15.2), so the session's out-of-app surfaces are
  // the only place the flex is visible to anyone but the owner. null for the empty slot, which is
  // most users, and which leaves both surfaces on their default styling.
  const flareHex = useEquipped('flare')?.flare?.colour ?? null;

  const sessionId = session?.id ?? null;
  // Prefer the user's own detail over the generic goal label — "Push day" is a better thing to read
  // on a lock screen than "Gym". Falls back to the label, then to nothing at all.
  const sessionName = session ? session.goalDetail?.trim() || GOAL_TYPE_META[session.goalType]?.label || '' : '';
  const startedAtMs = session ? session.startedAt.getTime() : 0;

  // START / END. Keyed on the session's IDENTITY, not the session object — the context replaces that
  // object on every touchConfirmedAt() tick, and restarting the activity each time would reset the
  // Lock Screen card (and its timer) every few minutes.
  useEffect(() => {
    // The initial fetch hasn't resolved yet, so `null` here means "don't know", not "nothing
    // running". Acting on it would end and immediately re-create the card on every cold start.
    if (loading) return;

    if (!sessionId) {
      // Deliberately unconditional, and deliberately NOT in a cleanup function. This is the cold-
      // start reconciliation: an activity that outlived its session is the worst failure this
      // feature has — a lock screen insisting you're locked in, with a timer climbing through hours
      // you never did. So every resolution to "no session" sweeps the surface, whether that's a
      // Stop, a sign-out, or a launch that found nothing running.
      endLiveActivity();
      return;
    }

    // No rank yet on the first paint — the card goes up immediately with the wordmark and clock
    // (the parts that matter), and the effect below fills the bar in when the read lands. Waiting
    // for the network here would mean a lock screen with no timer on it for a second or two.
    startLiveActivity({
      sessionName,
      startedAtMs,
      tier: rankProjection?.rank.tier ?? 'bronze',
      rankRatio: 0,
      rankLabel: '',
      projection: null,
      flareHex,
    });

    // NO cleanup teardown on purpose. Cleanup runs on every dep change, not just unmount, so
    // ending the activity there would kill the card whenever `sessionName` resolved a moment late —
    // the same class of bug as the `mounted` flag that froze the gym lock-in. Teardown is the
    // `!sessionId` branch above, which is reached when the session actually ends.
    //
    // `flareHex` is deliberately NOT a dep: the loadout store hydrates a beat after launch, and
    // re-running this on it would restart the activity and reset the Lock Screen clock. The update
    // effect below repaints the tint instead, which is what update() is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sessionId, sessionName, startedAtMs]);

  // UPDATE. The two things the OS can't derive by itself: the rank bar and the flare tint. One or
  // two pushes per session in practice — when the rank read resolves, and when the loadout does.
  useEffect(() => {
    if (!sessionId || !rankProjection) return;
    const { rank, hoursToNext } = rankProjection;
    const atMax = rank.xp_for_next_tier <= 0;

    updateLiveActivity({
      sessionName,
      startedAtMs,
      tier: rank.tier,
      // Pinned full at the apex, which has no next division — the raw ratio would be 0 there and
      // read as an empty bar, i.e. as a bug. Same rule as rank-projection-bar.tsx.
      rankRatio: atMax ? 1 : xpProgressRatio(rank.xp_into_tier, rank.xp_for_next_tier),
      // Native renders this as "X% to {rankLabel}" (LockInLiveActivity.swift / the Android module),
      // so it must be the NEXT division, not the current one — same off-by-one the in-app bar had
      // (it read "to Gold III" while you were reaching Gold II). Advance with nextRank(), matching
      // rank-projection-bar.tsx. At the apex nextRank() is null; keep the CURRENT label (non-empty)
      // there so native's hasRank stays true and it still renders "Max rank" rather than hiding the
      // whole block.
      rankLabel: (() => {
        const next = nextRank(rank.tier, rank.division);
        return next ? formatRankTier(next.tier, next.division) : formatRankTier(rank.tier, rank.division);
      })(),
      // No rate to project from (a new user), or nothing left to chase — either way the cue is
      // hidden rather than estimated.
      projection: atMax || hoursToNext === null ? null : formatProjection(hoursToNext),
      flareHex,
    });
  }, [sessionId, sessionName, startedAtMs, rankProjection, flareHex]);

  return null;
}
