import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────── INTERESTS → GOALS → MATCHES (mock 323) ───────────────────────────
//
// The last leg of first run: after setup (and the house claim, for an account with a program) the
// root layout sends the account to /interests once. Modelled on lib/house/ceremony.ts:
//
// 🔴 OPT-IN BY SETUP, NOT BY ABSENCE. The flag is PENDING, written by setup-handle's final write —
// so only an account that actually ran setup on this build is sent here. An existing user upgrading
// is never yanked into a three-screen flow; they find it in Edit identity instead.
//
// 🔴 KEYED PER ACCOUNT, and IN-MEMORY FIRST: the screen clears the flag and replaces to Home in the
// same tick, and the layout's gate re-reads on that navigation — a storage-only flag would still
// read pending there and bounce straight back.
const PENDING_KEY_PREFIX = 'philoi_interests_pending_';

function pendingKey(userId: string): string {
  return `${PENDING_KEY_PREFIX}${userId}`;
}

const clearedThisSession = new Set<string>();

export async function isInterestsPending(userId: string | null | undefined): Promise<boolean> {
  if (!userId || clearedThisSession.has(userId)) return false;
  return (await AsyncStorage.getItem(pendingKey(userId))) === 'true';
}

export async function markInterestsPending(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  clearedThisSession.delete(userId);
  await AsyncStorage.setItem(pendingKey(userId), 'true');
}

/** Done, skipped, or explored-on-my-own — any exit from the flow clears it. */
export async function clearInterestsPending(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  clearedThisSession.add(userId);
  await AsyncStorage.removeItem(pendingKey(userId));
}
