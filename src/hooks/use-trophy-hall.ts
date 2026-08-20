import { useEffect, useState } from 'react';

import { fetchTrophyHall } from '@/lib/api/trophy-hall';
import type { TrophyHall } from '@/types/database';

/**
 * One person's Trophy Hall. Takes a user id because the hall renders on other people's profiles
 * too — the server returns the visitor's view or the owner's view and says which via `is_owner`.
 *
 * Null while loading and on failure alike: every caller renders the hall as an optional section, so
 * a failed read leaves the profile intact around it rather than blocking it behind an error state.
 */
export function useTrophyHall(userId: string | null | undefined): TrophyHall | null {
  const [hall, setHall] = useState<TrophyHall | null>(null);

  useEffect(() => {
    if (!userId) {
      setHall(null);
      return;
    }
    // Guards the setState against a userId that changed mid-flight — the profile screen swaps this
    // when you navigate from one person's profile to another's, and the slower response must not
    // land on the newer person's screen.
    let current = true;
    setHall(null);
    fetchTrophyHall(userId)
      .then((h) => {
        if (current) setHall(h);
      })
      .catch(() => {
        if (current) setHall(null);
      });
    return () => {
      current = false;
    };
  }, [userId]);

  return hall;
}
