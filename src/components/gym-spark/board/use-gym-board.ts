import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchGymBoard, type GymBoardRow, type GymBoardWindow } from '@/lib/api/gym-spark';
import { msUntilReset } from '@/lib/time/week';

// THE BOARD's data (mock 402, CODE_PROMPT_gym_spark.md §3). One slot per tab, so flipping between
// This week and All-time shows the last good list instantly while it re-reads, and a slow response
// for one tab can never land in the other.
//
// Tabs are frozen on blur (freezeOnBlur) and stay mounted for the life of the app, so a mount-only
// read would show this morning's board all day. It re-reads on every focus instead — that is what
// makes a just-finished lock-in show up when you tap over to the Board.

type Slot = {
  /** null until the first read for this tab answers. */
  rows: GymBoardRow[] | null;
  /** The most recent read failed. Rows (if any) are the last good ones. */
  failed: boolean;
};

const EMPTY: Record<GymBoardWindow, Slot> = {
  week: { rows: null, failed: false },
  all: { rows: null, failed: false },
};

export function useGymBoard(range: GymBoardWindow) {
  const [slots, setSlots] = useState<Record<GymBoardWindow, Slot>>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);
  // Read with each answer rather than in render (Date.now() in render is impure), so the "resets in"
  // caption is as fresh as the board under it.
  const [resetInMs, setResetInMs] = useState(() => msUntilReset());

  const load = useCallback(async (w: GymBoardWindow) => {
    try {
      const rows = await fetchGymBoard(w);
      setSlots((prev) => ({ ...prev, [w]: { rows, failed: false } }));
    } catch (e) {
      // Quiet: the screen keeps the last good rows and says so only when it has none.
      console.warn('[board] get_gym_board failed', e);
      setSlots((prev) => ({ ...prev, [w]: { rows: prev[w].rows, failed: true } }));
    }
    setResetInMs(msUntilReset());
  }, []);

  // Runs on focus, and again whenever the tab changes while focused.
  useFocusEffect(
    useCallback(() => {
      void load(range);
    }, [load, range])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(range);
    setRefreshing(false);
  }, [load, range]);

  const slot = slots[range];
  return { rows: slot.rows, failed: slot.failed, refreshing, refresh, resetInMs };
}
