// The developer's title. Whatever Title Noah has equipped keeps its own art, rarity and glow; only
// the words change, so it reads as his title, not a new cosmetic.
//
// Gated on USER ID, not profiles.is_dev: other people's rows come from get_public_loadouts, which
// returns equipped keys only, and widening it to carry is_dev would be a migration for one line of
// text. These two ids are exactly the profiles with is_dev = true (both Noah's accounts, checked
// 2026-10-06) — a new dev account needs adding here to get the title.
export const DEV_TITLE_TEXT = 'Prometheus, Developer of Philoi';

const DEV_TITLE_USER_IDS: ReadonlySet<string> = new Set([
  '0dafcd2b-8766-4052-83be-59de4a87fd92', // @brikmnn
  '2bb0ff4f-7292-4ca5-b746-bdfe8528cf0f', // @brkmnn
]);

export function hasDevTitle(userId: string | null | undefined): boolean {
  return userId != null && DEV_TITLE_USER_IDS.has(userId);
}

/**
 * The equipped title with its words swapped. `labelIsStamp` off and the stamp cleared so a
 * placement title ("Goat Champion · S1") doesn't print its stamp in place of, or after, the name.
 */
export function withDevTitle<T extends { name: string; labelIsStamp?: boolean; seasonStamp?: string | null }>(title: T): T {
  return { ...title, name: DEV_TITLE_TEXT, labelIsStamp: false, seasonStamp: null };
}
