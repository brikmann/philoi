import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────── THE HOUSE CLAIM CEREMONY (Phase 3) ───────────────────────────
//
// ONBOARDING_FLOW_3phase.md: data → teach → claim. The ceremony (mocks 286 + 287) runs once, after
// the tour, for an account whose profile has a program_id — the patron it reveals is read from that
// program. Modelled on lib/tutorial.ts's per-account flag and for the same reasons:
//
// 🔴 THE FLAG MEANS "THIS ACCOUNT HAS BEEN SHOWN ITS HOUSE", set the moment the seal lands. There
// is no skip on the claim screen, but "Choose a different program" leaves it, and that path must
// come BACK to the claim rather than counting as done — so only the seal sets it.
//
// 🔴 KEYED PER ACCOUNT, NOT PER DEVICE. A second account on the same phone has its own house.
//
// AsyncStorage rather than a server column: the cost of a rare double-show (reinstall, a second
// device) is one ten-second ceremony, against a migration on a flow that has to work offline.
// An existing user who already had a program sees it once on first launch after upgrade — the
// spec accepts that; they are rare.
const CEREMONY_DONE_KEY_PREFIX = 'philoi_house_ceremony_done_';

function ceremonyDoneKey(userId: string): string {
  return `${CEREMONY_DONE_KEY_PREFIX}${userId}`;
}

// 🔴 IN-MEMORY FIRST, same as the tutorial flag. The seal marks itself done and replaces to Home in
// the same tick; the root layout's gate re-reads on that navigation, and a storage-only flag would
// still read false there and bounce the user straight back into the claim screen.
const doneThisSession = new Set<string>();

export async function isCeremonyDone(userId: string | null | undefined): Promise<boolean> {
  // No id → "done", so an edge read can never route someone into the ceremony.
  if (!userId) return true;
  if (doneThisSession.has(userId)) return true;
  return (await AsyncStorage.getItem(ceremonyDoneKey(userId))) === 'true';
}

export async function markCeremonyDone(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  doneThisSession.add(userId);
  await AsyncStorage.setItem(ceremonyDoneKey(userId), 'true');
}

/**
 * The claim screen couldn't read the house (offline, a pre-0264 server, a program since deleted).
 * Stands the gate down for THIS launch only — nothing persisted — so the screen's exit to Home can't
 * be bounced straight back into it, and the ceremony gets another chance on the next cold start.
 */
export function skipCeremonyThisSession(userId: string | null | undefined): void {
  if (userId) doneThisSession.add(userId);
}

/** Clears this account's flag so the claim can be seen again (a debug / replay hook). */
export async function resetCeremony(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  doneThisSession.delete(userId);
  await AsyncStorage.removeItem(ceremonyDoneKey(userId));
}
