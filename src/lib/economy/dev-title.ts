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

// The starter title every account is seeded with (0073, `default_cosmetic_keys`). The dev title
// stands in for THIS — the default flex — and nothing else. So the moment the developer equips a
// real title they earned (a won campfire finisher, a box title), it is shown as itself instead of
// being overwritten. Before this gate, withDevTitle clobbered EVERY equipped title, which is why a
// won "Run Club Champion" could never be displayed on a dev account.
const DEV_TITLE_BASE_KEY = 'title-base-kindling';

/**
 * The equipped title with its words swapped. `labelIsStamp` off and the stamp cleared so a
 * placement title ("Goat Champion · S1") doesn't print its stamp in place of, or after, the name.
 */
export function withDevTitle<T extends { name: string; labelIsStamp?: boolean; seasonStamp?: string | null }>(title: T): T {
  return { ...title, name: DEV_TITLE_TEXT, labelIsStamp: false, seasonStamp: null };
}

/**
 * Apply the dev title ONLY for a dev account that is wearing the default starter title. Any other
 * equipped title (an earned/won one) is returned untouched so it shows as itself. Centralised so the
 * own-view (loadout-bits) and the public map (use-public-loadouts) can never disagree.
 */
export function devTitleFor<T extends { id?: string; name: string; labelIsStamp?: boolean; seasonStamp?: string | null }>(
  userId: string | null | undefined,
  title: T,
): T {
  if (!hasDevTitle(userId) || title.id !== DEV_TITLE_BASE_KEY) return title;
  return withDevTitle(title);
}
