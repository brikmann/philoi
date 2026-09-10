import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  RelicUnlockRewardScreen,
  relicEarnedLine,
} from '@/components/economy/relic-unlock-reward-screen';
import { useRevealFloor } from '@/components/economy/reward-reveal';
import { UnlockShareCard } from '@/components/economy/unlock-share-card';
import { ScreenBackground } from '@/components/ui/screen-background';
import { useShareCardCapture } from '@/hooks/use-share-card-capture';
import { useShareRank } from '@/hooks/use-share-rank';
import { track } from '@/lib/analytics';
import {
  fetchUnseenRelicRungs,
  fetchUnseenRelicUnlocks,
  markRelicRungSeen,
  markRelicUnlockSeen,
} from '@/lib/api/relics';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem } from '@/lib/economy/catalog';
import { ladderRarity } from '@/lib/economy/relic-ladders';
import { getErrorMessage } from '@/lib/errors';
import type { UnseenRelicUnlock } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 🐛 A RELIC WAS EARNED AND THE APP SAID NOTHING — CODE_PROMPT_loop_signoff_meta.md §1, mig 0176.
//
// THE FIFTH WATCHER, and the same shape as the fourth for the same reason: something paid while
// nobody was looking. The four before it are rank-ups, settled challenges, finished personal goals
// and the daily drip. A discipline relic belonged to none of them, so nothing drew it.
//
// 🔴 WHY A WATCHER AND NOT A CALL AT THE GRANT SITE. There is no client at the grant site. Relics
// are granted by economy_evaluate_relics, which runs off TRIGGERS on check_ins and lock_in_sessions
// — and the rows that fire those triggers routinely arrive from somewhere the app is not: a Strava
// webhook, a Health Connect backfill, a step sync landing after the user has pocketed the phone.
// The moment is only ever recoverable on a later foreground, off a row the server stamped, which is
// exactly what 0176 added.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. get_unseen_relic_unlocks is a pure read and
// mark_relic_unlock_seen can only write a timestamp.
//
// FIRE-ONCE IS THE SERVER'S FLAG — `cosmetics_owned.reveal_seen_at`, not AsyncStorage. So a
// celebrated relic survives a reinstall, cannot re-fire on a second device, and a second account on
// this phone reads its own inbox because auth.uid() scopes both the read and the stamp. There is no
// local queue to clear on sign-out for that reason; the one remaining client-side window is a fetch
// still in flight when the session changes, and the queue below carries WHOSE it is so that lands
// as nothing rendered rather than as another account's relic on screen.
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * One queued celebration — an unlock (0176) or a rung climbed on a ladder already held (0179).
 *
 * FLATTENED ONTO THE PAYLOAD rather than wrapped, because the two are structurally interchangeable
 * by design and every consumer below reads the same `out_` fields off either. `rankUp` decides two
 * sentences of copy and which stamp spends it, and nothing else.
 */
type QueuedRelicReveal = UnseenRelicUnlock & { rankUp: boolean };

export function RelicUnlockWatcher() {
  const { session, profile } = useAuth();
  const [queue, setQueue] = useState<{ owner: string; rows: QueuedRelicReveal[] }>({
    owner: '',
    rows: [],
  });
  // One check at a time. Mount and foreground land together constantly — the app is foregrounded on
  // the same tick it mounts after a cold start — and two in-flight reads would both see the same
  // unstamped rows and queue every reveal twice. The same guard the other four carry.
  const checkingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const shareRank = useShareRank();
  // Mounted on the tap, not for the life of the watcher: this component is mounted in the ROOT
  // layout for the whole session, and a permanently-mounted story card would be a 360×640 gradient
  // + ray fan rendered behind every screen in the app forever. See use-share-card-capture.ts.
  const { cardRef, mounted: cardMounted, onCardLayout, capture } = useShareCardCapture();
  const userId = session?.user.id ?? null;

  const check = useCallback(async () => {
    if (!userId || checkingRef.current) return;
    checkingRef.current = true;
    try {
      // TWO INBOXES, ONE QUEUE (0179). In parallel because they are independent reads whose usual
      // answer is zero rows, and doing them in series would put a second round trip on every
      // foreground for nothing.
      const [unlocks, rungs] = await Promise.all([
        fetchUnseenRelicUnlocks(),
        fetchUnseenRelicRungs(),
      ]);

      const unseen: QueuedRelicReveal[] = [
        ...unlocks.map((r) => ({ ...r, rankUp: false })),
        // A rung row with no rung cannot be stamped — mark_relic_rung_seen would clamp it to a
        // no-op and the row would come straight back on the next foreground, forever. The server
        // cannot produce one (its WHERE clause forces tier >= 2), so this is a guard against a
        // future shape change rather than a case that fires, and dropping the row degrades to
        // "no reveal" instead of to a loop.
        ...rungs.filter((r) => r.out_rung != null).map((r) => ({ ...r, rankUp: true })),
      ]
        // 🔴 THE SAME RELIC CAN SIT IN BOTH INBOXES. It needs `reveal_seen_at` still null (the
        // unlock never played) while `revealed_tier` is already >= 1 — reachable only through
        // 0179 §1's carve-out, and measured at zero rows on prod the day it deployed. If it ever
        // happens the UNLOCK wins, and not arbitrarily: 0176's reveal already names the rung the
        // ladder stands at NOW, so it says everything the rank-up would, and dismissing it calls
        // mark_relic_unlock_seen, which advances the watermark past the rung too. Keeping both
        // would play one relic twice; keeping the rank-up alone would drop the unlock.
        .filter(
          (row, i, all) =>
            !row.rankUp ||
            !all.some((other) => !other.rankUp && other.out_relic_key === row.out_relic_key)
        )
        // Chronological across both, since each RPC only sorts its own. A relic unlocked and a
        // different ladder ranked up in the same lock-in should play in the order they happened.
        .sort(
          (a, b) => new Date(a.out_earned_at).getTime() - new Date(b.out_earned_at).getTime()
        );

      if (unseen.length === 0) return;
      // Replaced, not appended: the RPCs return the authoritative unseen set every time, and
      // anything already shown has been stamped and is therefore no longer in it. Appending would
      // duplicate a still-open reveal on the next foreground.
      setQueue({ owner: userId, rows: unseen });
      track('relic_unlock_revealed', {
        relic_key: unseen[0].out_relic_key,
        queued: unseen.length,
        // Which of the two paid out. The rung reveals are the ones 0179 added, and separating them
        // is what will say whether the ladders' later rungs are actually being reached — until now
        // nothing in the funnel could distinguish a 10h α from a 100h δ.
        kind: unseen[0].rankUp ? 'rank_up' : 'unlock',
        rung: unseen[0].out_rung ?? 0,
        // Days between the grant landing and anyone seeing it. The whole point of the inbox is that
        // this can be non-zero, and it is the one number that says whether the push half is doing
        // its job — a consistently large gap means people are not coming back for the notification.
        age_days: Math.round(
          (Date.now() - new Date(unseen[0].out_earned_at).getTime()) / 86_400_000
        ),
      });
    } catch {
      // Ambient, like the other four: a failed read means the celebration waits for the next
      // foreground. The relic is on the shelf either way — nothing about the grant depends on this.
    } finally {
      checkingRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  // 🔒 Signed out, or signed in as somebody else, shows nothing — see the header. Comparing the
  // owner closes the in-flight window without needing a cleanup effect.
  const current = (userId && queue.owner === userId ? queue.rows[0] : null) ?? null;

  /**
   * Stamp it shown and advance.
   *
   * The stamp goes out BEFORE the queue advances and is deliberately not awaited: if the app is
   * killed mid-celebration the reveal is still recorded as consumed, which is the trade all four
   * other watchers make. Stamping on success only would replay the whole thing on next launch.
   */
  const dismiss = useCallback((row: QueuedRelicReveal) => {
    // WHICHEVER BUDGET THIS ONE CAME OUT OF. Stamping the wrong one is not a cosmetic mistake: a
    // rank-up dismissed through mark_relic_unlock_seen writes a timestamp that is already set and
    // never touches `revealed_tier`, so the rung stays owed and replays on every foreground for
    // the rest of the install. The rung it PLAYED is passed rather than read server-side, so a
    // check-in that raised the ladder while this was on screen leaves the newer rung owed rather
    // than swallowed.
    const stamped = row.rankUp
      ? markRelicRungSeen(row.out_relic_key, row.out_rung ?? 0)
      : markRelicUnlockSeen(row.out_relic_key);
    stamped.catch(() => {});
    setQueue((q) => ({ ...q, rows: q.rows.slice(1) }));
  }, []);

  const onShare = useCallback(async () => {
    if (!current) return;
    setSharing(true);
    try {
      track('relic_unlock_shared', { relic_key: current.out_relic_key });
      await capture('Share your relic');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setSharing(false);
    }
  }, [capture, current]);

  // Held, not dropped: the queue keeps the unlock while another celebration has the floor, so a
  // relic crossed in the same lock-in that ranked the user up plays in its own lane rather than
  // being swallowed. 'relic_unlock' sits at priority 70 — behind the rank forge, ahead of the rest.
  const hasFloor = useRevealFloor('relic_unlock', current !== null);

  if (!current || !hasFloor) return null;

  const catalogItem = getItem(current.out_relic_key);
  // THE RUNG'S RARITY, for the same reason the reveal resolves it — see the note there. The card's
  // kick line, its tint and its glow all read `item.rarity`, so a card built off the raw catalog
  // entry would post "UNCOMMON UNLOCKED" for the Mythic rung the screen behind it just celebrated.
  // Overridden here rather than inside the card, which is shared with the box-open flow where the
  // catalog rarity IS the right one.
  const item = catalogItem
    ? {
        ...catalogItem,
        rarity: ladderRarity(current.out_relic_key, current.out_rung ?? 0) ?? catalogItem.rarity,
      }
    : undefined;

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={() => dismiss(current)}
      statusBarTranslucent>
      <ScreenBackground>
        <SafeAreaView style={styles.safe}>
          {/* Off-screen capture target, alive only while a share is in flight. */}
          {cardMounted && item ? (
            <View style={styles.offscreen} pointerEvents="none" onLayout={onCardLayout}>
              <UnlockShareCard
                ref={cardRef}
                item={item}
                // A relic has no drop table, so there is no probability to flex. What it cost is
                // the flex — the same sentence the reveal prints under the name.
                oddsPct={0}
                flex={relicEarnedLine(current)}
                handle={profile?.handle ?? null}
                tier={shareRank.tier}
                division={shareRank.division}
              />
            </View>
          ) : null}
          <RelicUnlockRewardScreen
            // Keyed by relic so two queued unlocks each get a fresh mount — otherwise the second
            // reuses the first's instance and its entrance, its sting and its build-in never fire
            // again. The same gotcha RankUpWatcher's presentToken exists for. The rung is in the
            // key too (0179): the same relic queued as an unlock and then as a rank-up is one key
            // otherwise, and the second would mount silently onto the first's spent animation.
            key={`${current.out_relic_key}:${current.rankUp ? current.out_rung : 'unlock'}`}
            relic={current}
            rankUp={current.rankUp}
            onClose={() => dismiss(current)}
            // No card to photograph if this build's catalog has never heard of the key — the reveal
            // still plays off the server's name, it just cannot offer a Share.
            onShare={item ? onShare : undefined}
            sharing={sharing}
          />
        </SafeAreaView>
      </ScreenBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  offscreen: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
});
