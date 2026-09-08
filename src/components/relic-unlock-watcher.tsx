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
import { fetchUnseenRelicUnlocks, markRelicUnlockSeen } from '@/lib/api/relics';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem } from '@/lib/economy/catalog';
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
export function RelicUnlockWatcher() {
  const { session, profile } = useAuth();
  const [queue, setQueue] = useState<{ owner: string; rows: UnseenRelicUnlock[] }>({
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
      const unseen = await fetchUnseenRelicUnlocks();
      if (unseen.length === 0) return;
      // Replaced, not appended: the RPC returns the authoritative unseen set every time, and
      // anything already shown has been stamped and is therefore no longer in it. Appending would
      // duplicate a still-open reveal on the next foreground.
      setQueue({ owner: userId, rows: unseen });
      track('relic_unlock_revealed', {
        relic_key: unseen[0].out_relic_key,
        queued: unseen.length,
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
  const dismiss = useCallback((relicKey: string) => {
    markRelicUnlockSeen(relicKey).catch(() => {});
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

  const item = getItem(current.out_relic_key);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={() => dismiss(current.out_relic_key)}
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
            // again. The same gotcha RankUpWatcher's presentToken exists for.
            key={current.out_relic_key}
            relic={current}
            onClose={() => dismiss(current.out_relic_key)}
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
