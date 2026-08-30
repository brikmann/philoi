import type { Ionicons } from '@expo/vector-icons';

import { getItem } from '@/lib/economy/catalog';
import { RARITY_ORDER, type Rarity } from '@/lib/economy/rarity';
import type { DuelRecord, HallBadge, HallRelic, HallStats } from '@/types/database';

// §4 — the milestone badge grid, and the auto-featured strip above it.
//
// TWO KINDS OF BADGE, ONE GRID. Some are granted rows in owned_badges (First Flame, the challenge
// tiers); the rest — streaks, lock-in totals, hours — are DERIVED from numbers the profile already
// stores. Deriving them is deliberate: a granted row for "reached a 7-day streak" would be a second
// source of truth that could disagree with the streak on Home, and the grid has to show what is NOT
// yet earned anyway, which no grant table can answer.
//
// The grid is the collection-to-complete, so every badge is listed always; `earned` decides whether
// it renders lit or greyed.

export type MilestoneBadge = {
  key: string;
  label: string;
  /** What it takes, shown under a locked tile so the grid reads as a goal list. */
  requirement: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Ember-warm for the earned ones; the tile greys itself when locked. */
  tint: string;
};

type BadgeInputs = {
  stats: HallStats;
  record: DuelRecord | null;
  /** Granted rows, by badge_key. */
  granted: Set<string>;
};

/** Reached-ness for one badge. `progress` is 0..1 and drives nothing but the locked tile's hint. */
export type BadgeState = MilestoneBadge & { earned: boolean; count: number | null };

const AMBER = '#F2A33C';
const EMBER = '#FFD27A';
const GREEN = '#7FE0A0';

/**
 * Every badge in the grid, in the order it is shown. Streak first because it is the one people
 * chase daily, founder/verified last because they are unrepeatable facts rather than goals.
 */
const BADGES: (MilestoneBadge & { reached: (i: BadgeInputs) => boolean; stack?: (i: BadgeInputs) => number | null })[] = [
  {
    key: 'streak-7',
    label: 'Week One',
    requirement: '7-day streak',
    icon: 'flame',
    tint: AMBER,
    reached: (i) => i.stats.longest_streak >= 7,
  },
  {
    key: 'streak-30',
    label: 'Undying',
    requirement: '30-day streak',
    icon: 'flame',
    tint: AMBER,
    reached: (i) => i.stats.longest_streak >= 30,
  },
  {
    key: 'streak-100',
    label: 'Hundred Days',
    requirement: '100-day streak',
    icon: 'flame',
    tint: EMBER,
    reached: (i) => i.stats.longest_streak >= 100,
  },
  {
    key: 'lockins-100',
    label: 'Century',
    requirement: '100 lock-ins',
    icon: 'checkmark-done',
    tint: AMBER,
    reached: (i) => i.stats.lockin_count >= 100,
  },
  {
    key: 'lockins-500',
    label: 'Five Hundred',
    requirement: '500 lock-ins',
    icon: 'checkmark-done',
    tint: EMBER,
    reached: (i) => i.stats.lockin_count >= 500,
  },
  {
    key: 'hours-100',
    label: 'Hundred Hours',
    requirement: '100 hours locked in',
    icon: 'hourglass',
    tint: AMBER,
    reached: (i) => hours(i.stats) >= 100,
  },
  {
    key: 'hours-500',
    label: 'The Long Haul',
    requirement: '500 hours locked in',
    icon: 'hourglass',
    tint: EMBER,
    reached: (i) => hours(i.stats) >= 500,
  },
  {
    key: 'firestarter',
    label: 'Firestarter',
    requirement: 'Win 10 duels',
    icon: 'flash',
    tint: AMBER,
    // A hidden record means the viewer cannot see the wins, so the badge cannot claim them either.
    reached: (i) => (i.record?.won ?? 0) >= 10,
    stack: (i) => (i.record ? i.record.won : null),
  },
  {
    key: 'duelist-50',
    label: 'Duelist',
    requirement: 'Win 50 duels',
    icon: 'flash',
    tint: EMBER,
    reached: (i) => (i.record?.won ?? 0) >= 50,
  },
  {
    key: 'campus-verified',
    label: 'Campus Verified',
    requirement: 'Verify your school email',
    icon: 'shield-checkmark',
    tint: GREEN,
    reached: (i) => i.stats.campus_verified,
  },
  {
    key: 'first-flame',
    label: 'First Flame',
    requirement: 'Founding member',
    icon: 'sparkles',
    tint: EMBER,
    reached: (i) => i.granted.has('first-flame'),
  },
];

function hours(stats: HallStats): number {
  return stats.total_seconds / 3600;
}

/** The full grid — earned and locked, always in the same order. */
export function milestoneBadges(stats: HallStats, record: DuelRecord | null, granted: HallBadge[]): BadgeState[] {
  const inputs: BadgeInputs = { stats, record, granted: new Set(granted.map((b) => b.key)) };
  return BADGES.map((b) => ({
    key: b.key,
    label: b.label,
    requirement: b.requirement,
    icon: b.icon,
    tint: b.tint,
    earned: b.reached(inputs),
    count: b.stack?.(inputs) ?? null,
  }));
}

/**
 * Granted badges this build has no tile for — a badge minted by a newer server than the installed
 * app. Rendered after the grid rather than dropped, so a real earned thing never silently vanishes.
 */
export function extraGrantedBadges(granted: HallBadge[]): HallBadge[] {
  const known = new Set(BADGES.map((b) => b.key));
  return granted.filter((b) => !known.has(b.key));
}

export type FeaturedTrophy = HallRelic & {
  rarity: Rarity;
  /** The ribbon on the tile: the rarest one and the newest one are called out by name. */
  tag: 'rarest' | 'newest' | null;
};

/**
 * The collapsed profile's auto-featured strip: rarest + newest, then filled out by rarity (§4).
 *
 * NO MANUAL PICKER, by design — the spec's "always fresh, zero maintenance". Which means the
 * selection has to be stable and explainable, so ties break on recency and the two called-out tiles
 * are labelled rather than left for the viewer to infer.
 */
export function featuredTrophies(relics: HallRelic[], limit = 4): FeaturedTrophy[] {
  const withRarity = relics.flatMap((r) => {
    // A ladder below its first threshold is progress, not a trophy (migration 0143). It rides in
    // hall.relics so the profile can draw "3.3 / 10 h", and it must never reach this strip — the
    // hall is earned-only, and "rarest" applied to something nobody has earned is a false claim.
    if (r.in_progress) return [];
    const item = getItem(r.key);
    if (!item) return [];
    return [{ ...r, rarity: item.rarity, tag: null as FeaturedTrophy['tag'] }];
  });
  if (withRarity.length === 0) return [];

  const byRarity = [...withRarity].sort(
    (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || time(b) - time(a)
  );
  const byRecency = [...withRarity].sort((a, b) => time(b) - time(a));

  const picked: FeaturedTrophy[] = [];
  const take = (t: FeaturedTrophy | undefined, tag: FeaturedTrophy['tag']) => {
    if (!t || picked.some((p) => p.key === t.key)) return;
    picked.push({ ...t, tag });
  };

  take(byRarity[0], 'rarest');
  // Only label the newest when it isn't already the rarest — one tile wearing both ribbons reads
  // as a bug, and "rarest" is the stronger claim.
  take(byRecency[0], 'newest');
  for (const t of byRarity) {
    if (picked.length >= limit) break;
    take(t, null);
  }
  return picked.slice(0, limit);
}

function time(t: { acquired_at: string }): number {
  return new Date(t.acquired_at).getTime();
}

/** "#300 / 30,000 · Top 1%" — the season card's headline (§4). */
export function formatPlacement(placement: number, boardSize: number): string {
  const rank = `#${placement.toLocaleString()} / ${boardSize.toLocaleString()}`;
  if (boardSize <= 0) return rank;
  // Ceil so #300 of 30,000 reads "Top 1%" rather than "Top 1.0000%", and so nobody is ever rounded
  // INTO a better bracket than they finished in.
  const pct = Math.max(1, Math.ceil((placement / boardSize) * 100));
  return `${rank} · Top ${pct}%`;
}
