// Meme Monday (migration 0243) — the pure half: which drop is live, which is next, and how long is
// left. The schedule itself lives server-side in meme_drop_schedule and the server alone decides
// whether a buy is inside its window (buy_meme_drop). Nothing here gates a purchase; it only picks
// what the shop shows, so a phone with a wrong clock can mislabel a countdown but never buy early.

import { getItem, type CatalogItem } from '@/lib/economy/catalog';

export type MemeDropRow = { item_key: string; price_embers: number; unlocks_at: string; ends_at: string };

export type MemeDrop = {
  item: CatalogItem;
  price: number;
  unlocksAt: number;
  endsAt: number;
};

export type MemeDropPhase = 'upcoming' | 'live' | 'ended';

export function dropPhase(drop: Pick<MemeDrop, 'unlocksAt' | 'endsAt'>, now: number = Date.now()): MemeDropPhase {
  if (now < drop.unlocksAt) return 'upcoming';
  if (now < drop.endsAt) return 'live';
  return 'ended';
}

/**
 * Rows → drops this build can draw, soonest first. A row whose key this build doesn't know (a drop
 * scheduled after the build shipped) is dropped rather than shown as a blank tile.
 */
export function toDrops(rows: readonly MemeDropRow[]): MemeDrop[] {
  return rows
    .flatMap((r) => {
      const item = getItem(r.item_key);
      const unlocksAt = Date.parse(r.unlocks_at);
      const endsAt = Date.parse(r.ends_at);
      if (!item || Number.isNaN(unlocksAt) || Number.isNaN(endsAt)) return [];
      return [{ item, price: r.price_embers, unlocksAt, endsAt }];
    })
    .sort((a, b) => a.unlocksAt - b.unlocksAt);
}

/**
 * What the shop surfaces: this month's drop if one is live, otherwise the next one as a locked date.
 * `after` is the drop following the featured one, shown only as a date — never its art, so the
 * next reveal is still a reveal.
 */
export function featuredDrop(
  drops: readonly MemeDrop[],
  now: number = Date.now()
): { drop: MemeDrop; phase: 'live' | 'upcoming'; after: MemeDrop | null } | null {
  const live = drops.find((d) => dropPhase(d, now) === 'live');
  const upcoming = drops.filter((d) => dropPhase(d, now) === 'upcoming');
  if (live) return { drop: live, phase: 'live', after: upcoming[0] ?? null };
  if (upcoming[0]) return { drop: upcoming[0], phase: 'upcoming', after: upcoming[1] ?? null };
  return null;
}

/** "6d 4h" · "3h 12m" · "12m" — a countdown that reads the same in every timezone. */
export function countdownLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

/** "Mon, Nov 2" in the viewer's own locale and timezone. */
export function dropDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
