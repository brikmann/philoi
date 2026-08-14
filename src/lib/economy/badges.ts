// Badge keys → display names.
//
// Badges are NOT catalog cosmetics: they have no equip slot, no rarity-scaled art, and no drop
// pool. They're prestige markers granted by grant_reward at challenge/season close and by the Pass
// capstone, so they live here rather than being forced into CATALOG.
//
// Anything not listed falls back to a humanised key — a badge granted by a newer server build than
// the installed app must still render as words rather than `s1-completionist`.

const BADGE_NAMES: Record<string, string> = {
  's1-completionist': 'S1 Completionist',
  'first-flame': 'First Flame',
  'season-participant': 'Season Participant',
  'challenge-apex': 'Apex Challenger',
  'challenge-elite': 'Elite Challenger',
};

export function badgeLabel(key: string): string {
  const known = BADGE_NAMES[key];
  if (known) return known;
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
