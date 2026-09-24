import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useActiveSession } from '@/lib/active-session-context';
import { fetchInventory } from '@/lib/api/inventory';
import { useAuth } from '@/lib/auth/auth-context';
import { setSessionAudioChoice, startEquippedAmbient, stopEquippedAmbient } from '@/lib/economy/equipped-audio';
import { clearLoadout, setLoadoutFromInventory, useLoadout } from '@/lib/economy/loadout';

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

  // The ID, not the object. `activeSession` gets a fresh identity on every still-here tick, and the
  // audio effect below tears its loop down on each dep change — so keying on the object restarted
  // the ambient mix from zero every few minutes, defeating the per-id idempotency startAmbientLoop
  // has for exactly this reason. Nothing about the loop depends on anything else in the session.
  const sessionId = activeSession?.id ?? null;
  const equippedAudioId = useLoadout().audio?.id;

  // 🐛 EQUIPPING AN AUDIO COSMETIC MID-SESSION DID NOTHING (Noah). Two layers had to change and
  // this is the second one: even once the effect below reacts, `sessionAudioChoice` — written by
  // the start sheet — wins over the equipped item forever, by design. Going to the inventory and
  // putting on a different environment is about as explicit as intent gets, so it becomes the
  // session's choice.
  //
  // Only a known id → a DIFFERENT known id counts. The first inventory fetch after boot moves this
  // from `undefined` to an id, which is a load and not an equip — treating it as one would let a
  // relaunch quietly overwrite a choice. Unequipping (id → undefined) is likewise left alone: the
  // loop keeps playing rather than cutting out under someone mid-session.
  const lastEquippedAudio = useRef(equippedAudioId);
  useEffect(() => {
    const previous = lastEquippedAudio.current;
    lastEquippedAudio.current = equippedAudioId;
    if (sessionId && previous !== undefined && equippedAudioId !== undefined && equippedAudioId !== previous) {
      setSessionAudioChoice(equippedAudioId);
    }
    // Declared ABOVE the audio effect so it runs first: React fires effects in declaration order,
    // so the choice is already updated by the time the loop is restarted below.
  }, [sessionId, equippedAudioId]);

  // The equipped Audio environment is a loop that exists only while a lock-in is running. Driven
  // from here rather than the lock-in screen because the session survives navigation — the loop
  // should keep playing when you leave that screen and stop when the session actually ends.
  //
  // `equippedAudioId` is in the deps because a mid-session equip has to reach the sound layer: the
  // effect used to depend on the session alone, so `startEquippedAmbient()` was never called again
  // after a session began and a newly equipped environment stayed silent until the next one.
  useEffect(() => {
    if (sessionId) startEquippedAmbient();
    else stopEquippedAmbient();
    return () => stopEquippedAmbient();
  }, [sessionId, equippedAudioId]);

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
        // The owned rows travel with the slot map so the store can carry each item's placement
        // rarity and season stamp — that is what lets your own entry stand in for a public loadout
        // on every list without dropping "🌍 GLOBAL #1 · S1" off your title.
        if (!cancelled) setLoadoutFromInventory(inv.loadout, inv.cosmetics);
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
