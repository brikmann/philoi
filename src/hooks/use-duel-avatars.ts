import { useEffect, useState } from 'react';

import { fetchProfileById } from '@/lib/api/profile';

/**
 * The opponent's profile picture, for the duel share card's DEFEATED strip.
 *
 * WHY THIS IS A CLIENT FETCH. `get_my_unseen_challenge_rewards` (0137) already left-joins
 * `profiles opp` and returns `opponent_id` and `opponent_name` — but not `opponent avatar_url`.
 * Adding the column is a one-line change to that RPC and would be the tidier answer; the share-card
 * pass is explicitly client/OTA only, and a migration cannot ship in it. Profiles are readable by
 * anyone ("profiles: read any" RLS, see fetchProfileById), so one extra read gets the same pixel.
 *
 * Cheap by construction: it only runs when a duel reveal is actually on screen — `id` is null for
 * every board race and for every screen that is not showing a settled duel — and it is one row by
 * primary key.
 *
 * Failure is silent and returns null, which the card renders as the opponent's initial. A share
 * that degrades to a letter is fine; a celebration that throws because someone's avatar 404'd is
 * not.
 */
export function useOpponentAvatar(id: string | null | undefined): string | null {
  // KEYED BY THE ID IT WAS FETCHED FOR, rather than a bare url + a reset. Two things fall out of
  // that, and the second is the one that matters:
  //
  //   · no synchronous setState in the effect body to clear a stale value (react-hooks rejects it,
  //     and rightly — it is a cascading render to express something that is really just derived);
  //   · a second duel settling while the first read is in flight can never paint the wrong face on
  //     the card, because the render below only trusts a result whose id still matches.
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchProfileById(id)
      .then((p) => {
        // Per-effect-run, not per-mount: cleanup fires on every dep change, which is exactly the
        // `mounted`-flag trap that caused the gym lock-in freeze.
        if (alive) setFetched({ id, url: p.avatar_url ?? null });
      })
      .catch(() => {
        if (alive) setFetched({ id, url: null });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return id && fetched?.id === id ? fetched.url : null;
}
