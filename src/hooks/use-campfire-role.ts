import { useCallback, useEffect, useState } from 'react';

import { fetchMyCampfireRole } from '@/lib/api/groups';
import type { MemberRole } from '@/types/database';

/**
 * THE campfire permission read (migration 0094, CAMPFIRE_REDESIGN_SPEC.md §Phase 2).
 *
 * Every gate in the campfire section — edit, invite, approve joins, delete, and (in the challenge
 * subsystem) start/manage a challenge — asks this hook, never `group.owner_id === session.user.id`.
 * That comparison is what made "owner" and "may manage" the same thing, which is exactly the
 * privilege model this replaces: a campfire can now have admins who are not the founder.
 *
 *   isAdmin  — owner OR admin. The answer to "may they manage this campfire?".
 *   isOwner  — the founder alone. Reserved for DELETE and for handing out the role itself.
 *   role     — null while loading, and also null for a non-member (the RPC yields no row).
 *
 * Optimistic-but-safe: `isAdmin` is false until the role lands, so admin-only UI fades in rather
 * than flashing for a member. The server gates the same calls independently — this only decides
 * what's drawn.
 */
export function useCampfireRole(groupId: string) {
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      setRole(await fetchMyCampfireRole(groupId));
    } catch {
      // A failed role read means "show them the member view" — never the admin one. Falling
      // open here would put a Delete row in front of somebody the server will just refuse.
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, no caching layer to defer to
    refetch();
  }, [refetch]);

  return {
    role,
    loading,
    isAdmin: role === 'owner' || role === 'admin',
    isOwner: role === 'owner',
    isMember: role != null,
    refetch,
  };
}
