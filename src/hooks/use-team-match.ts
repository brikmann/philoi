import { useCallback, useEffect, useState } from 'react';

import { fetchTeamMatch, subscribeToTeamMatch } from '@/lib/api/team-match';
import { getErrorMessage } from '@/lib/errors';
import type { TeamMatch } from '@/types/database';

/**
 * One match, kept current.
 *
 * THE WHOLE POINT IS THE SUBSCRIPTION. Mock 177's live card and its scorekeeper screen are the
 * same score seen from two places, and "the ref taps +1 and everyone's card moves" is the feature.
 * `subscribeToTeamMatch` filters postgres_changes to this one row, so a match in a busy campfire
 * wakes on its own goals and not on every message that lands in the fire.
 *
 * A REFETCH RATHER THAN READING THE PAYLOAD. The realtime event carries the raw
 * `social_challenges` row, which is not what any surface renders — the roster, the sport's score
 * steps, `am_i_ref` and `my_team` are all derived server-side by get_team_match, and a client that
 * patched its state from the raw row would drift from the read every other surface uses. The event
 * is a doorbell, not a delivery.
 */
export function useTeamMatch(matchId: string | undefined) {
  const [match, setMatch] = useState<TeamMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!matchId) return;
    try {
      setMatch(await fetchTeamMatch(matchId));
      setError(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load that match.'));
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    // Not guarded by a `mounted` flag: this effect's only dependency is the match id, so the
    // cleanup runs when the id changes or on unmount — both of which are exactly when the
    // subscription should go. setState after unmount is a no-op in React 18+, and a flag here
    // would have to be reset on every dep change or it would freeze the screen on the second
    // match the same way the gym lock-in froze.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    void refetch();
    return subscribeToTeamMatch(matchId, () => {
      void refetch();
    });
  }, [matchId, refetch]);

  // DERIVED, not a setState in the no-id branch of the effect above. With no match id there is
  // nothing in flight, so "loading" is a fact about the arguments rather than a state to write —
  // and writing it synchronously inside the effect is the cascading-render pattern the lint rule
  // is there to catch.
  return { match, loading: matchId ? loading : false, error, refetch, setError };
}
