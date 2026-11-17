import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchGymBoard, type GymBoardRow, type GymBoardScope, type GymBoardWindow } from '@/lib/api/gym-spark';
import { msUntilReset } from '@/lib/time/week';

// THE BOARD's data (mock 402, CODE_PROMPT_gym_spark.md §3). One slot per scope × window, so flipping
// between Everyone / My Uni and This week / All-time shows the last good list instantly while it
// re-reads, and a slow response for one board can never land in another.
//
// Tabs are frozen on blur (freezeOnBlur) and stay mounted for the life of the app, so a mount-only
// read would show this morning's board all day. It re-reads on every focus instead — that is what
// makes a just-finished lock-in show up when you tap over to the Board.

type Slot = {
  /** null until the first read for this board answers. */
  rows: GymBoardRow[] | null;
  /** The most recent read failed. Rows (if any) are the last good ones. */
  failed: boolean;
};

type SlotKey = `${GymBoardScope}:${GymBoardWindow}`;

const NO_SLOT: Slot = { rows: null, failed: false };

export function useGymBoard(range: GymBoardWindow, scope: GymBoardScope) {
  const [slots, setSlots] = useState<Partial<Record<SlotKey, Slot>>>({});
  const [refreshing, setRefreshing] = useState(false);
  // Read with each answer rather than in render (Date.now() in render is impure), so the "resets in"
  // caption is as fresh as the board under it.
  const [resetInMs, setResetInMs] = useState(() => msUntilReset());

  const load = useCallback(async (s: GymBoardScope, w: GymBoardWindow) => {
    const key: SlotKey = `${s}:${w}`;
    try {
      const rows = await fetchGymBoard(w, s);
      setSlots((prev) => ({ ...prev, [key]: { rows, failed: false } }));
    } catch (e) {
      // Quiet: the screen keeps the last good rows and says so only when it has none.
      console.warn('[board] get_gym_board failed', e);
      setSlots((prev) => ({ ...prev, [key]: { rows: prev[key]?.rows ?? null, failed: true } }));
    }
    setResetInMs(msUntilReset());
  }, []);

  // Runs on focus, and again whenever the board changes while focused.
  useFocusEffect(
    useCallback(() => {
      void load(scope, range);
    }, [load, scope, range])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(scope, range);
    setRefreshing(false);
  }, [load, scope, range]);

  const slot = slots[`${scope}:${range}`] ?? NO_SLOT;
  return { rows: slot.rows, failed: slot.failed, refreshing, refresh, resetInMs };
}
