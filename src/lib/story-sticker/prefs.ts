import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// The story sticker's opt-in flexes (mock 279 panel 2) and the backdrop choice (the cosmetic
// revision). Local prefs, not profile columns: they only ever shape an image this device renders,
// and a migration would be paying the ledger's coordination cost for four booleans nobody else reads.

/** "photo" = the glass card on a transparent canvas, dropped over the person's own photo in
 *  Instagram. "cosmetic" = the equipped card cosmetic fills the card instead — no photo needed. */
export type StickerBackdrop = 'photo' | 'cosmetic';

export type StickerPrefs = {
  showRank: boolean;
  showStreak: boolean;
  showCampus: boolean;
  /** Gym only — the exercise list with PR flags. Ignored for any other session. */
  showExercises: boolean;
  backdrop: StickerBackdrop;
};

/** Every flex OFF by default — momentum, not a flex. The people who earned one switch it on. */
export const DEFAULT_STICKER_PREFS: StickerPrefs = {
  showRank: false,
  showStreak: false,
  showCampus: false,
  showExercises: false,
  backdrop: 'photo',
};

const KEY = 'philoi.storySticker.prefs.v1';

async function loadStickerPrefs(): Promise<StickerPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_STICKER_PREFS;
    const parsed = JSON.parse(raw) as Partial<StickerPrefs>;
    return {
      showRank: parsed.showRank === true,
      showStreak: parsed.showStreak === true,
      showCampus: parsed.showCampus === true,
      showExercises: parsed.showExercises === true,
      backdrop: parsed.backdrop === 'cosmetic' ? 'cosmetic' : 'photo',
    };
  } catch {
    return DEFAULT_STICKER_PREFS;
  }
}

export function useStickerPrefs(): [StickerPrefs, (patch: Partial<StickerPrefs>) => void] {
  const [prefs, setPrefs] = useState<StickerPrefs>(DEFAULT_STICKER_PREFS);

  useEffect(() => {
    let cancelled = false;
    void loadStickerPrefs().then((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<StickerPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return [prefs, update];
}
