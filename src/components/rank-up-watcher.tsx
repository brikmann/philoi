import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { RankUpCelebration } from '@/components/rank-up-celebration';
import { RankUpShareCard } from '@/components/rank-up-share-card';
import { Screen } from '@/components/ui/screen';
import { Colors } from '@/constants/theme';
import { fetchMyRanks } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import {
  deriveRankUpLevel,
  readLastSeenRank,
  requestRankRecheck,
  subscribeToRankRecheck,
  writeLastSeenRank,
  type RankUpEvent,
} from '@/lib/rank-watch';
import { isRankUp } from '@/lib/rank-tiers';
import { shareCardImage } from '@/lib/share-card';
import type { MyRank } from '@/types/database';

// Imperative presenter, set by the mounted RankUpWatcher. Dev-tools and the watcher itself both
// go through showRankUp() so there is exactly ONE path into the celebration (RANKUP_SPEC §7b) —
// a dev trigger runs the same escalation, audio and haptics a real rank-up would.
let present: ((event: RankUpEvent) => void) | null = null;

/** Present the rank-up celebration from anywhere — the global watcher on a real increase, or
 * dev-tools on demand. No-ops if the watcher isn't mounted (e.g. before sign-in). */
export function showRankUp(event: RankUpEvent): void {
  present?.(event);
}

// Global rank watcher (punchlist 5.6) — mounted once in the root layout. The forge previously
// fired only from the lock-in done screen, so a rank earned from SERVER-side XP (a Strava or
// Whoop activity arriving by webhook/backfill, a challenge payout) passed silently. This compares
// the user's live rank against the last one they were actually shown and plays the same
// celebration for any source.
//
// Checks on: mount, app foreground, and any requestRankRecheck() (fired right after a sync that
// imported something). De-duped by persisting the shown rank — see lib/rank-watch.ts.
export function RankUpWatcher() {
  const { session, profile } = useAuth();
  const [pending, setPending] = useState<RankUpEvent | null>(null);
  // Bumped on every presentation and used as the celebration's key. Without it React reuses the
  // same RankUpCelebration instance across two showRankUp() calls: its hasFiredCueRef would still
  // be true from the previous one, so the second event would play NO audio or haptic at all, and
  // the 5s timeline would never restart. Most visible from the dev-tools tester, where two events
  // land back to back.
  const [presentToken, setPresentToken] = useState(0);

  // Register this mount as the global presenter for showRankUp().
  useEffect(() => {
    present = (event) => {
      setPending(event);
      setPresentToken((n) => n + 1);
    };
    return () => {
      present = null;
    };
  }, []);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);
  // One check at a time: foreground + a post-sync recheck can land together, and two in-flight
  // checks would both see the same stale baseline and could queue the celebration twice.
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (!session || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const ranks = await fetchMyRanks();
      const current = ranks.find((r: MyRank) => r.scope === 'universal');
      if (!current) return;

      const now = { tier: current.tier, division: current.division };
      const lastSeen = await readLastSeenRank();

      // No baseline yet — an existing user opening this build for the first time. Record where
      // they are and celebrate nothing; otherwise everyone gets a spurious forge on upgrade.
      if (!lastSeen) {
        await writeLastSeenRank(now);
        return;
      }

      if (isRankUp(lastSeen, now)) {
        // Written BEFORE showing, not after Continue: if the app is killed mid-celebration the
        // rank is still recorded as seen, so it can't replay on next launch.
        await writeLastSeenRank(now);
        showRankUp({
          tier: now.tier,
          division: now.division,
          fromTier: lastSeen.tier,
          fromDivision: lastSeen.division,
          ...deriveRankUpLevel(lastSeen, now),
        });
      } else if (lastSeen.tier !== now.tier || lastSeen.division !== now.division) {
        // Moved DOWN (or sideways) — a decay or correction. Re-baseline silently so the next
        // genuine climb still reads as an increase.
        await writeLastSeenRank(now);
      }
    } catch {
      // Ambient — a failed rank check just means the celebration waits for the next trigger.
    } finally {
      checkingRef.current = false;
    }
  }, [session]);

  useEffect(() => {
    // Baseline read on mount. check() is async — every setState in it lands after an await.
    check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  useEffect(() => subscribeToRankRecheck(check), [check]);

  async function handleShare() {
    setSharing(true);
    try {
      await shareCardImage(cardRef, 'Share to your story');
    } finally {
      setSharing(false);
    }
  }

  if (!pending) return null;

  return (
    <View style={styles.overlay}>
      <Screen backgroundColor={Colors.forgeBg} padded={false}>
        <RankUpCelebration
          key={presentToken}
          tier={pending.tier}
          division={pending.division}
          fromTier={pending.fromTier}
          fromDivision={pending.fromDivision}
          streakDays={profile?.current_streak ?? 0}
          handle={profile?.handle ?? null}
          isBandCrossing={pending.isBandCrossing}
          onContinue={() => setPending(null)}
          onShare={handleShare}
          sharing={sharing}
        />
        <View style={styles.offscreenCard} pointerEvents="none">
          <RankUpShareCard
            ref={cardRef}
            handle={profile?.handle ?? null}
            tier={pending.tier}
            division={pending.division}
            isDivisionBump={pending.isDivisionBump}
          />
        </View>
      </Screen>
    </View>
  );
}

// Re-exported so callers that just moved XP server-side don't need to import from two places.
export { requestRankRecheck };

const styles = StyleSheet.create({
  // Covers whatever screen the user happened to be on when the rank landed — this can fire from
  // anywhere, unlike the done screen's version which owns its own route.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  offscreenCard: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
});
