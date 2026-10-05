import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { RankUpCelebration } from '@/components/rank-up-celebration';
import { RankUpShareCard } from '@/components/rank-up-share-card';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { Screen } from '@/components/ui/screen';
import { Colors } from '@/constants/theme';
import { fetchLastRankUpReward, fetchMyRanks, fetchRecentRankCrates } from '@/lib/api/goals';
import { equipCosmetic } from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';
import {
  deriveRankUpLevel,
  readLastSeenRank,
  requestRankRecheck,
  subscribeToRankRecheck,
  writeLastSeenRank,
  type RankUpEvent,
} from '@/lib/rank-watch';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR } from '@/lib/economy/rarity';
import { isRankUp, rankOrdinal } from '@/lib/rank-tiers';
import { shareCardImage } from '@/lib/share-card';
import { syncStepLadder } from '@/lib/step-ladder-sync';
import type { MyRank, RankCrate, RankTierName, RankUpReward } from '@/types/database';

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
  // What the rank-up paid, fetched alongside the presentation. Null until it lands (or forever, if
  // the read fails) — the celebration simply omits the line, which is what it always did.
  const [reward, setReward] = useState<RankUpReward | null>(null);
  // The crates this climb actually paid (0231) — every rung strictly above the rank last shown, up
  // to and including the one being celebrated, highest first. Empty until the read lands, and on an
  // older server, which falls back to `reward` above.
  const [crates, setCrates] = useState<RankCrate[]>([]);

  // Register this mount as the global presenter for showRankUp().
  useEffect(() => {
    present = (event) => {
      setPending(event);
      setPresentToken((n) => n + 1);
      // Cleared first so a second rank-up cannot show the previous one's payout for a frame.
      setReward(null);
      setCrates([]);
      fetchLastRankUpReward().then(setReward).catch(() => {});
      fetchRecentRankCrates()
        .then((all) => {
          const floor = rankOrdinal(event.fromTier, event.fromDivision);
          const ceiling = rankOrdinal(event.tier, event.division);
          setCrates(
            all.filter((c) => {
              const o = rankOrdinal(c.tier as RankTierName, c.division);
              return o > floor && o <= ceiling;
            })
          );
        })
        .catch(() => {});
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
  const userId = session?.user.id ?? null;

  const check = useCallback(async () => {
    if (!session || !userId || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const ranks = await fetchMyRanks();
      const current = ranks.find((r: MyRank) => r.scope === 'universal');
      if (!current) return;

      const now = { tier: current.tier, division: current.division };
      const lastSeen = await readLastSeenRank(userId);

      // No baseline yet — an existing user opening this build for the first time. Record where
      // they are and celebrate nothing; otherwise everyone gets a spurious forge on upgrade.
      if (!lastSeen) {
        await writeLastSeenRank(userId, now);
        return;
      }

      if (isRankUp(lastSeen, now)) {
        // Written BEFORE showing, not after Continue: if the app is killed mid-celebration the
        // rank is still recorded as seen, so it can't replay on next launch.
        await writeLastSeenRank(userId, now);
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
        await writeLastSeenRank(userId, now);
      }
    } catch {
      // Ambient — a failed rank check just means the celebration waits for the next trigger.
    } finally {
      checkingRef.current = false;
    }
  }, [session, userId]);

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

  // Walking -> the Movement relic ladder (migration 0119). Rides this watcher rather than taking
  // its own root mount: this is already the one component the root layout keeps alive purely to
  // watch economy state on mount and on foreground, which is exactly the cadence a daily step
  // total wants. It also keeps app/_layout.tsx untouched.
  //
  // Deliberately NOT folded into check() — a slow health-store read must not delay the rank
  // celebration, and syncStepLadder throttles itself and swallows its own failures.
  useEffect(() => {
    if (!userId) return undefined;
    void syncStepLadder(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncStepLadder(userId);
    });
    return () => sub.remove();
  }, [userId]);

  async function handleShare() {
    setSharing(true);
    try {
      await shareCardImage(cardRef, 'Share to your story');
    } finally {
      setSharing(false);
    }
  }

  // Takes its turn like every other reward presenter. Rank-up carries the HIGHEST priority in
  // REVEAL_TUNING, so when a lock-in lands a rank-up, a settled challenge and a claimed pass level
  // at once, the other two clear first and this is the one the user is left looking at. Holding the
  // event while waiting rather than dropping it: `pending` stays set, so nothing is lost — it just
  // does not draw yet.
  const hasFloor = useRevealFloor('rank_up', pending !== null);

  // One crate is the normal case; a single check-in that jumps two rungs pays two. The celebration
  // shows the TOP crate's box (named by the rank reached) and sums the currency — the other boxes
  // are already in the inventory, and the box row says so.
  const crateReward = useMemo(() => {
    const top = crates[0];
    if (!top) return null;
    return {
      embers: crates.reduce((n, c) => n + c.embers, 0),
      passXp: crates.reduce((n, c) => n + c.pass_xp, 0),
      boxKey: top.box_key,
      boxId: top.box_id,
      boxName: `${top.label} Box`,
      moreBoxes: crates.filter((c) => c.box_key).length - 1,
    };
  }, [crates]);

  // The rank-set flames — their own rows, with Equip, since the grant already minted them. A key
  // this build has no catalog entry for is skipped, like everywhere else an item is drawn.
  const crateCosmetics = useMemo(
    () =>
      crates.flatMap((c) => {
        const item = c.exclusive_item_key ? getItem(c.exclusive_item_key) : undefined;
        if (!item) return [];
        return [
          {
            key: item.id,
            name: item.name,
            accent: RARITY_COLOR[item.rarity],
            onEquip: () => {
              equipCosmetic(item).catch(() => {});
            },
          },
        ];
      }),
    [crates]
  );

  if (!pending || !hasFloor) return null;

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
          reward={crateReward ?? (reward ? { embers: reward.embers, boxKey: reward.box_key } : null)}
          cosmetics={crateCosmetics.length > 0 ? crateCosmetics : null}
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
            // The SAME read the celebration itself renders — 0142's get_my_last_rank_up_reward —
            // so the card and the screen it was shared from name the same prize. Null until that
            // read lands, which leaves the stamp off rather than guessing at one.
            boxKey={crateReward?.boxKey ?? reward?.box_key ?? null}
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
