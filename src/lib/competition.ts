import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-context';
import { getDeviceTimeZone } from '@/lib/notification-prefs';
import { supabase } from '@/lib/supabase';
import type { NotificationPrefs, Profile } from '@/types/database';

// THE ONE COMPETITION SWITCH (connection-first, mocks 331–333).
//
// Philoi is community-first with opt-in competition: ranking is something you choose to walk into,
// never implied. "Show me global standings" is that choice, and it is OFF until you turn it on —
// from onboarding or Settings.
//
//   off → Standings (You → Standings) opens on Friends and offers nothing wider; no placement push
//         ever sends (notify_event drops it server-side, 0289).
//   on  → Standings gains Program · My Uni · Global, and the nightly placement push goes out —
//         positive-only: a climb, never a drop, never "defend it".
//
// It lives in profiles.notification_prefs as `competition` because the server has to read it to gate
// pushes, and that blob is the one place both sides already share. Absent = off.

export function competitionOptedIn(profile: Pick<Profile, 'notification_prefs'> | null | undefined): boolean {
  const prefs = profile?.notification_prefs as NotificationPrefs | null | undefined;
  return prefs?.competition === true;
}

/**
 * Write the switch. set_my_notification_prefs replaces the whole blob, so this starts from the RAW
 * stored prefs — every type_/cat_ key the user set survives — and changes only `competition`.
 */
export async function setCompetitionOptIn(
  current: NotificationPrefs | null | undefined,
  on: boolean
): Promise<void> {
  const payload: NotificationPrefs = { ...(current ?? {}), competition: on, timezone: getDeviceTimeZone() };
  const { error } = await supabase.rpc('set_my_notification_prefs', { p_prefs: payload });
  if (error) throw error;
}

export function useCompetition() {
  const { profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const on = competitionOptedIn(profile);

  const setOn = useCallback(
    async (next: boolean) => {
      setSaving(true);
      try {
        await setCompetitionOptIn(profile?.notification_prefs as NotificationPrefs | null | undefined, next);
        await refreshProfile();
      } finally {
        setSaving(false);
      }
    },
    [profile?.notification_prefs, refreshProfile]
  );

  return { on, saving, setOn };
}
