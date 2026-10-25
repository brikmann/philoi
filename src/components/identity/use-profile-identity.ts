import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchDisciplineMix, fetchProfileIdentity } from '@/lib/api/identity';
import type { DisciplineMixRow, ProfileIdentity } from '@/types/social';

/**
 * The identity layer's one read for a profile (0272): header fields + momentum strip, and the
 * computed discipline mix beside it.
 *
 * On FOCUS, not mount — /edit-identity is pushed over the profile, and coming back from a save has
 * to show the new headline without a pull-to-refresh.
 *
 * FAILS SOFT, ALWAYS. Every section that reads this renders nothing for a null identity or an
 * empty mix, so an RPC that errors (0272 not yet applied, offline, a viewer the dial keeps out)
 * leaves the profile exactly as it read before the identity layer existed — never a crash, never
 * a spinner holding the rest of the page.
 */
export function useProfileIdentity(userId: string | null | undefined): {
  identity: ProfileIdentity | null;
  mix: DisciplineMixRow[];
} {
  const [identity, setIdentity] = useState<ProfileIdentity | null>(null);
  const [mix, setMix] = useState<DisciplineMixRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let live = true;
      fetchProfileIdentity(userId)
        .then((row) => {
          if (live) setIdentity(row);
        })
        .catch(() => {
          if (live) setIdentity(null);
        });
      fetchDisciplineMix(userId, 'season')
        .then((rows) => {
          // A zero-time bucket is a row the bar has no width to draw.
          if (live) setMix(rows.filter((r) => r.pct > 0));
        })
        .catch(() => {
          if (live) setMix([]);
        });
      return () => {
        live = false;
      };
    }, [userId])
  );

  return { identity, mix };
}
