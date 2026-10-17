import { useEffect } from 'react';

import { useAppActive } from '@/hooks/use-motion-active';
import { touchPresence } from '@/lib/api/presence';
import { useAuth } from '@/lib/auth/auth-context';

// Renders nothing. Stamps last_seen_at (0245) on every foreground and every 60s while the app stays
// foregrounded, which is what "Online" (seen in the last 3 min) and "Active 7m ago" read.
//
// Mounted once in _layout: being online is a property of the app, not of any one screen. Nothing
// fires while backgrounded, so a phone in a pocket ages out of "Online" on its own.

const BEAT_MS = 60_000;

export function PresenceHeartbeat() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const appActive = useAppActive();

  useEffect(() => {
    if (!userId || !appActive) return;
    // Best-effort: a dropped beat only means "Online" lapses a minute early.
    const beat = () => touchPresence().catch(() => {});
    beat();
    const t = setInterval(beat, BEAT_MS);
    return () => clearInterval(t);
  }, [userId, appActive]);

  return null;
}
