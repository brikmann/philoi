import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { useActiveSession } from '@/lib/active-session-context';
import { fetchInventory } from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';
import { startEquippedAmbient, stopEquippedAmbient } from '@/lib/economy/equipped-audio';
import { clearLoadout, setLoadoutFromInventory } from '@/lib/economy/loadout';

// Renders nothing. Its whole job is to keep the module-level loadout store fed, so the live flame,
// the profile card, and the sound layer can all read the equipped set without each of them opening
// its own subscription.
//
// Mounted once in _layout above the navigator — the flame appears on screens all over the app, so
// this can't live inside any one of them.
export function LoadoutSync() {
  const { session } = useAuth();
  const { session: activeSession } = useActiveSession();
  const pathname = usePathname();

  // The equipped Audio environment is a loop that exists only while a lock-in is running. Driven
  // from here rather than the lock-in screen because the session survives navigation — the loop
  // should keep playing when you leave that screen and stop when the session actually ends.
  //
  // No-ops entirely until Noah's ambient mixes land (see AMBIENT_SOURCES in sound.ts).
  useEffect(() => {
    if (activeSession) startEquippedAmbient();
    else stopEquippedAmbient();
    return () => stopEquippedAmbient();
  }, [activeSession]);

  useEffect(() => {
    if (!session) {
      // Sign-out must drop the previous account's cosmetics immediately. Leaving them would paint
      // the next user's flame in the last user's colourway — the same class of bug as the stale
      // "verified at {school}" panel that survived sign-out.
      clearLoadout();
      return;
    }

    let cancelled = false;
    fetchInventory()
      .then((inv) => {
        if (!cancelled) setLoadoutFromInventory(inv.loadout);
      })
      // Cosmetics are decoration. A failed read must leave the base look in place, never surface an
      // error or block a screen.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // Re-reads on navigation because equipping happens on the inventory screen and the flame that
    // has to change is on a different one. setLoadoutFromInventory bails when nothing actually
    // changed, so the common case costs one query and zero renders.
  }, [session, pathname]);

  return null;
}
