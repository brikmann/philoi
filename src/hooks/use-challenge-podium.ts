import { useEffect, useState } from 'react';

import { prefetchAvatars } from '@/components/economy/king-statue';
import { fetchGroupChallengeWatch } from '@/lib/api/leaderboard-social';
import { fetchChallengeResults } from '@/lib/api/social-challenges';
import { supabase } from '@/lib/supabase';

// THE FIELD BEHIND A SETTLED RACE — who stood on the podium, for mock 267.
//
// The reveal and the share card both draw the same three pillars, and both are mounted at once (the
// card sits off-screen so captureRef has something laid out the instant Share is tapped). One
// promise per challenge, cached at module level, so the two read one fetch rather than racing two.
//
// 🔒 A READ OF THE SETTLED STANDINGS, never a re-ranking. get_challenge_results (0111) is what the
// settlement wrote; placing people here from live progress would let the podium disagree with the
// placement the server paid out on.
//
// Avatars are a second read off `profiles` (readable by anyone — see fetchProfileById) because the
// results RPC carries names, not faces; the client-only pass this rides cannot add a column to it.
// An ANONYMOUS racer gets no face fetched at all: 0170 §3 withholds who they are, and painting their
// profile picture onto a public share card would undo it.

export type PodiumRacer = {
  id: string;
  name: string;
  /** Null for an anonymous racer — their place is withheld (0170 §3). */
  place: number | null;
  score: number | null;
  avatarUrl: string | null;
  anonymous: boolean;
};

export type ChallengePodium = {
  /** Ranked racers first in settled order, anonymous ones after — the RPC's own ordering. */
  racers: PodiumRacer[];
  /** The campfire the race ran in, or null when it could not be read. */
  campfire: string | null;
};

const cache = new Map<string, Promise<ChallengePodium>>();

async function load(challengeId: string): Promise<ChallengePodium> {
  const [rows, watch] = await Promise.all([
    fetchChallengeResults(challengeId),
    // Only for the campfire's name, which the settlement watcher's row does not carry. A failure
    // costs the subtitle its second half, never the podium.
    fetchGroupChallengeWatch(challengeId).catch(() => []),
  ]);

  const named = rows.filter((r) => !r.is_anonymous).map((r) => r.member_id);
  const faces = new Map<string, string | null>();
  if (named.length > 0) {
    const { data } = await supabase.from('profiles').select('id, avatar_url').in('id', named);
    for (const p of data ?? []) faces.set(p.id, p.avatar_url ?? null);
  }

  const racers: PodiumRacer[] = rows
    .map((r) => ({
      id: r.member_id,
      name: r.member_name || 'Racer',
      place: r.is_anonymous ? null : r.place,
      score: r.is_anonymous ? null : r.score_value,
      avatarUrl: r.is_anonymous ? null : faces.get(r.member_id) ?? null,
      anonymous: r.is_anonymous,
    }))
    // Places first, ascending; the withheld after. The RPC already sorts this way — restated so a
    // podium can never be built from the anonymous tail if that ordering ever moves.
    .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));

  // Warmed here rather than at Share time only: the podium's three faces are what the card is, and
  // captureRef photographs a still-loading <Image> as an empty circle.
  await prefetchAvatars(...racers.slice(0, 3).map((r) => r.avatarUrl));

  return { racers, campfire: watch[0]?.circle_name ?? null };
}

/**
 * The settled field for a board race, or null while it loads / when it cannot be read.
 *
 * `enabled` false (a duel, a solo goal) skips the fetch entirely — those keep their own heroes.
 * `failed` lets a caller fall back to the pre-podium reveal rather than wait on a spinner forever.
 */
export function useChallengePodium(
  challengeId: string | null | undefined,
  enabled: boolean
): { podium: ChallengePodium | null; failed: boolean } {
  const [state, setState] = useState<{ id: string; podium: ChallengePodium | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!challengeId || !enabled) return;
    let alive = true;
    let pending = cache.get(challengeId);
    if (!pending) {
      pending = load(challengeId);
      cache.set(challengeId, pending);
      // A failed read is not cached — the next mount (or the other door onto this reveal) retries.
      pending.catch(() => cache.delete(challengeId));
    }
    pending
      .then((podium) => alive && setState({ id: challengeId, podium, failed: false }))
      .catch(() => alive && setState({ id: challengeId, podium: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [challengeId, enabled]);

  // Keyed by the id it was fetched for, so a second queued settlement never paints the first's field.
  if (!challengeId || !enabled || state?.id !== challengeId) return { podium: null, failed: false };
  return { podium: state.podium, failed: state.failed };
}
