import { invalidateIdentityBadge } from '@/lib/house/identity-badges';
import { supabase } from '@/lib/supabase';

/**
 * PATRON PERSONAS (Phase 9, mocks 338 / 340 / 341, migration 0293).
 *
 * A patron is a self-chosen persona — twelve recognizable Greek names, each with an official title
 * and one line of who it's for — not something a program grants. Program stays its own field (the
 * pride badge). The chosen key lives on profiles.patron_key; set it through set_my_patron.
 *
 * `represents` (Leader, Strength…) is SORT METADATA ONLY. Nothing may draw it — the picker's Sort
 * control uses it to order the grid, and that's all.
 */
export type Patron = {
  key: string;
  name: string;
  /** The official title: "King of the Gods". */
  title: string;
  /** "those who are born to lead the room" — drawn after "For:". */
  for_line: string;
  featured: boolean;
  roster_order: number;
  /** Never rendered. */
  represents: string;
};

let rosterCache: Patron[] | null = null;

/** The twelve, in roster order. Patrons are readable by everyone (0257's RLS). Cached for the session. */
export async function fetchPatronRoster(): Promise<Patron[]> {
  if (rosterCache) return rosterCache;
  const { data, error } = await supabase
    .from('patrons')
    .select('key, name, title, for_line, featured, roster_order, represents')
    .not('roster_order', 'is', null)
    .order('roster_order');
  if (error) throw error;
  rosterCache = (data ?? []) as Patron[];
  return rosterCache;
}

export async function setMyPatron(userId: string, key: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_patron', { p_key: key });
  if (error) throw error;
  // Your own seal + identity line read the batched badge; drop yours so the new patron shows.
  invalidateIdentityBadge(userId);
}

export type PatronSort = 'featured' | 'name' | 'vibe';

export const PATRON_SORTS: { key: PatronSort; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'name', label: 'A–Z' },
  { key: 'vibe', label: 'By vibe' },
];

/** The picker's order. 'vibe' groups by `represents` without ever showing it. */
export function sortPatrons(list: Patron[], sort: PatronSort): Patron[] {
  const out = [...list];
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'vibe') out.sort((a, b) => a.represents.localeCompare(b.represents) || a.roster_order - b.roster_order);
  else out.sort((a, b) => Number(b.featured) - Number(a.featured) || a.roster_order - b.roster_order);
  return out;
}

// ── the lockups (mocks 338 / 341) — patron is self-expression, program is the pride badge ──

/** Epic — profile hero + share cards: "Heracles of Kinesiology". Either half alone when that's all there is. */
export function epicLockup(patronName: string | null | undefined, programName: string | null | undefined): string | null {
  const p = patronName?.trim();
  const g = programName?.trim();
  if (p && g) return `${p} of ${g}`;
  return p || g || null;
}

/** Compact — feed rows, member lists, the Agora handle: "Heracles · Kin". */
export function compactLockup(patronName: string | null | undefined, programShort: string | null | undefined): string | null {
  const parts = [patronName?.trim(), programShort?.trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
